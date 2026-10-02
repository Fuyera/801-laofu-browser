import { VERSION, BUILD, API_VERSION } from "./version.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import net from "node:net";
import WebSocket from "ws";
import { Readable } from "node:stream";
import { Store } from "./store.js";
import { BrowserAdapter, type BrowserConfig } from "./browser.js";
import { captureArticle } from "./article.js";
import { Fault, problem } from "./errors.js";
import { hash, mkdir, privateFile, filename } from "./util.js";
import type { Job, WorkerMessage } from "./types.js";
export interface WorkerConfig extends BrowserConfig {
  workerId: string;
  token: string;
  baseUrl: string;
  location?: "desktop" | "server";
  vncPort?: number;
}
export class Worker {
  readonly store: Store;
  readonly browser: BrowserAdapter;
  private socket?: WebSocket;
  private active?: Job;
  private cancelled = false;
  private resolveHuman?: () => void;
  private rejectHuman?: (e: any) => void;
  private viewers = new Map<string, net.Socket>();
  private heartbeat?: NodeJS.Timeout;
  private retentionTimer?: NodeJS.Timeout;
  private stopping = false;
  private step = 0;
  private running = false;
  private uncertain = false;
  private rateLimited?: Fault;
  private activeStarted = 0;
  private humanElapsed = 0;
  private reconnectTimer?: NodeJS.Timeout;
  private reconnectDelay = 1000;
  private lastReady?: boolean;
  private execution?: Promise<void>;
  private bootId = crypto.randomUUID();
  constructor(readonly config: WorkerConfig) {
    this.store = new Store(path.join(config.home, "journal"));
    this.browser = new BrowserAdapter(config);
    this.browser.onRateLimit = (evidence) => {
      if (!this.active) return;
      this.rateLimited = new Fault(
        "RATE_LIMITED",
        "站点返回限流，已停止后续自动动作",
        429,
        false,
        evidence,
      );
      this.send({
        type: "rate_limited",
        jobId: this.active.id,
        fence: this.active.fence,
        data: evidence,
      });
      this.rejectHuman?.(this.rateLimited);
      void this.browser.control(this.active, true).catch(() => {});
    };
  }
  async start() {
    this.maintainRetention();
    this.retentionTimer = setInterval(() => this.maintainRetention(), 60000);
    this.retentionTimer.unref();
    await this.browser.start();
    await this.connect();
  }
  private async connect() {
    const url =
      this.config.baseUrl.replace(/^http/, "ws").replace(/\/$/, "") +
      "/v1/worker/connect";
    const ws = new WebSocket(url, {
      headers: { authorization: `Bearer ${this.config.token}` },
      maxPayload: 32 * 1024 ** 2,
    });
    this.socket = ws;
    await new Promise<void>((resolve, reject) => {
      ws.once("open", resolve);
      ws.once("error", reject);
    });
    const publish = () => {
      const ready = this.browser.ready;
      if (ready !== this.lastReady) {
        this.send({
          type: "ready",
          profileId: this.config.profileId,
          browserReady: ready,
          bootId: this.bootId,
          version: VERSION,
          build: BUILD,
          browserVersion: this.browser.browserVersion,
          environment: {
            platform: process.platform,
            arch: process.arch,
            location: this.config.location || "desktop",
            headed: !this.config.headless,
            display: !!this.config.vncPort,
            attached: !!this.config.attach,
          },
        });
        this.lastReady = ready;
      } else this.send({ type: "heartbeat" });
    };
    this.lastReady = undefined;
    publish();
    this.heartbeat = setInterval(publish, 2000);
    this.heartbeat.unref();
    ws.on("message", (raw) => {
      try {
        void this.message(JSON.parse(raw.toString())).catch(() => ws.close());
      } catch {
        ws.close();
      }
    });
    ws.on("close", () => {
      clearInterval(this.heartbeat);
      this.cancelled = true;
      this.rejectHuman?.(new Fault("CONTROL_LOST", "服务连接已断开"));
      if (this.active)
        void this.browser.control(this.active, true).catch(() => {});
      for (const v of this.viewers.values()) v.destroy();
      this.viewers.clear();
      if (!this.stopping) this.scheduleReconnect();
    });
  }
  private scheduleReconnect() {
    if (this.stopping || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.connect()
        .then(() => {
          this.reconnectDelay = 1000;
        })
        .catch(() => {
          this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000);
          this.scheduleReconnect();
        });
    }, this.reconnectDelay);
    this.reconnectTimer.unref();
  }
  private send(msg: WorkerMessage) {
    if (this.socket?.readyState === 1) this.socket.send(JSON.stringify(msg));
  }
  private async message(msg: WorkerMessage) {
    const active = this.active;
    if (msg.type === "session_closed") {
      await this.browser.releaseClient(msg.sessionId);
      return;
    }
    if (msg.type === "execute") {
      if (this.running) {
        if (this.active?.id === msg.job.id) {
          this.send({
            type: "progress",
            jobId: msg.job.id,
            fence: msg.job.fence,
            data: { duplicate: true },
          });
          return;
        }
        this.send({
          type: "result",
          jobId: msg.job.id,
          fence: msg.job.fence,
          state: "failed",
          effectState: "not_started",
          stopped: false,
          error: {
            code: "WORKER_BUSY",
            message: "执行端仍有在途任务",
            retryable: false,
          },
        });
        return;
      }
      this.execution = this.execute(msg.job).catch((e) => {
        this.send({
          type: "result",
          jobId: msg.job.id,
          fence: msg.job.fence,
          state: "failed",
          effectState: "unknown",
          stopped: false,
          error: problem(e),
        });
      });
      return;
    }
    if (msg.type === "cancel" && active && active.id === msg.jobId) {
      this.cancelled = true;
      this.rejectHuman?.(new Fault("CANCELLED", "用户取消了任务"));
      await this.browser.control(active, true).catch(() => {});
      if (active.type === "ask")
        await this.browser.handoff(active, "cancelled").catch(() => {});
      return;
    }
    if (
      msg.type === "resume" &&
      active &&
      active.id === msg.jobId &&
      active.fence === msg.fence
    ) {
      this.resolveHuman?.();
      return;
    }
    if (msg.type === "view_open") {
      if (
        !this.config.vncPort ||
        !this.active ||
        this.active.id !== msg.jobId ||
        !this.resolveHuman
      )
        return;
      const tcp = net.connect({ host: "127.0.0.1", port: this.config.vncPort });
      this.viewers.set(msg.viewerId, tcp);
      tcp.on("data", (data) =>
        this.send({
          type: "display",
          viewerId: msg.viewerId,
          data: data.toString("base64"),
        }),
      );
      tcp.on("error", () => tcp.destroy());
      tcp.on("close", () => this.viewers.delete(msg.viewerId));
      return;
    }
    if (msg.type === "view_input") {
      if (this.resolveHuman && !this.cancelled)
        this.viewers.get(msg.viewerId)?.write(Buffer.from(msg.data, "base64"));
      return;
    }
    if (msg.type === "view_close") {
      this.viewers.get(msg.viewerId)?.destroy();
      this.viewers.delete(msg.viewerId);
    }
  }
  private check(job: Job) {
    if (this.cancelled)
      throw new Fault("CANCELLED", "用户或连接状态已取消本次执行");
    if (this.rateLimited) throw this.rateLimited;
    if (
      job.kind === "task" &&
      Date.now() - this.activeStarted - this.humanElapsed >
        (job.input.limits?.activeTimeoutSeconds || 180) * 1000
    )
      throw new Fault("ACTIVE_TIMEOUT", "主动执行预算已用完");
    if (Date.now() > job.expiresAt)
      throw new Fault("TIMEOUT", "任务总预算已用完");
  }
  private async run(job: Job, tool: string, args: any, raw = false) {
    this.check(job);
    if (++this.step > (job.input.limits?.maxSteps || 500))
      throw new Fault("STEP_LIMIT", "步骤预算已用完");
    const key = `${job.id}:attempt${job.attempt}:step${this.step}`;
    const prior = this.store.journalStart(key, {
      tool,
      args,
      raw,
      fence: job.fence,
    });
    if (!prior.fresh) {
      if (prior.resultExpired)
        throw new Fault(
          "RESULT_EXPIRED",
          "步骤结果已过期或未保留二进制，禁止重放；请查询服务端记录",
        );
      if (prior.state === "confirmed") return prior.result;
      throw new Fault("EFFECT_UNKNOWN", "已有步骤未收到确认，禁止重复执行");
    }
    this.send({
      type: "progress",
      jobId: job.id,
      fence: job.fence,
      data: { step: this.step, tool },
    });
    let received = false;
    try {
      const result = raw
        ? await this.browser.raw(tool, args, job)
        : tool === "ask"
          ? await this.ask(job, args)
          : await this.browser.call(tool, args, job);
      this.store.journalFinish(key, result);
      received = true;
      const errorCode = result?._meta?.["laofu.error"]?.code;
      const output = result?._meta?.["laofu.output"];
      if (
        tool === "act" &&
        output?.completed === false &&
        (output.effectUnknown || output.doneCount > 0)
      ) {
        output.effectUnknown = true;
        this.uncertain = true;
      }
      if (errorCode === "RATE_LIMITED") {
        const evidence = {
          origin:
            result._meta["laofu.error"].origin ||
            (args.url && new URL(args.url).origin),
          retryAfter: result._meta["laofu.error"].retryAfter || null,
        };
        if (evidence.origin)
          this.send({
            type: "rate_limited",
            jobId: job.id,
            fence: job.fence,
            data: evidence,
          });
      }
      if (
        result?.isError &&
        ["TIMEOUT", "INTERNAL", "NO_EXTENSION"].includes(errorCode) &&
        !(
          tool === "wait" &&
          errorCode === "TIMEOUT" &&
          result?._meta?.["laofu.error"]?.browserAcknowledged === true
        )
      )
        this.uncertain = true;
      this.check(job);
      return result;
    } catch (e) {
      if (!received) {
        const code = (e as any)?.code;
        if (
          [
            "LIMIT_EXCEEDED",
            "NETWORK_DENIED",
            "DOWNLOAD_INTERRUPTED",
            "CONTROL_REVOKED",
            "INVALID_ARGUMENT",
            "NO_TAB",
            "NOT_FOUND",
          ].includes(code)
        ) {
          this.store.journalFinish(key, {
            isError: true,
            error: { code, message: "浏览器明确拒绝或停止该操作" },
          });
          throw new Fault(code, "浏览器明确拒绝或停止该操作");
        }
        this.uncertain = true;
        this.store.journalUnknown(key, problem(e));
      }
      throw e;
    }
  }
  private async ask(job: Job, args: any) {
    let done = false,
      humanStart = 0;
    const budget = Math.max(
      1,
      (job.input.limits?.humanWaitSeconds || 600) * 1000 - this.humanElapsed,
    );
    const pending = this.browser.call(
      "ask",
      { ...args, timeout: Math.min(Number(args.timeout) || 300000, budget) },
      job,
    );
    const interrupted = new Promise<never>((_, reject) => {
      this.rejectHuman = reject;
    });
    void interrupted.catch(() => {});
    // Attach rejection handling immediately; lifecycle polling must not leave a rejected promise unobserved.
    void pending.then(
      () => {
        done = true;
      },
      () => {
        done = true;
      },
    );
    try {
      while (!done) {
        const status = await this.browser.handoff(job);
        if (status.ask?.ready) {
          await this.browser.control(job, true);
          humanStart = Date.now();
          this.resolveHuman = () => {
            void this.browser.handoff(job, "continued").catch(() => {});
          };
          this.send({
            type: "waiting_user",
            jobId: job.id,
            fence: job.fence,
            data: {
              reason: "ask",
              title: args.title,
              prompt: args.prompt,
              tabId: status.ask.tabId,
              display: !!this.config.vncPort,
            },
          });
          break;
        }
        await new Promise((r) => setTimeout(r, 150));
      }
      const result = await Promise.race([pending, interrupted]);
      const outcome = (result as any)?._meta?.["laofu.output"]?.outcome;
      if (["continued", "completed"].includes(outcome)) {
        this.check(job);
        await this.browser.control(job, false);
        this.send({
          type: "handoff_completed",
          jobId: job.id,
          fence: job.fence,
          data: { outcome },
        });
      }
      return result;
    } catch (e) {
      await this.browser.handoff(job, "cancelled").catch(() => {});
      let timer: NodeJS.Timeout | undefined;
      try {
        await Promise.race([
          pending,
          new Promise((_, reject) => {
            timer = setTimeout(
              () => reject(Error("handoff stop unconfirmed")),
              3000,
            );
          }),
        ]);
      } catch {
        this.uncertain = true;
      } finally {
        clearTimeout(timer);
      }
      throw e;
    } finally {
      if (humanStart) this.humanElapsed += Date.now() - humanStart;
      this.resolveHuman = undefined;
      this.rejectHuman = undefined;
      for (const tcp of this.viewers.values()) tcp.destroy();
      this.viewers.clear();
    }
  }
  private async human(job: Job, info: any) {
    const humanStarted = Date.now();
    await this.browser.control(job, true);
    this.send({
      type: "waiting_user",
      jobId: job.id,
      fence: job.fence,
      data: { ...info, display: !!this.config.vncPort },
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Fault("HUMAN_TIMEOUT", "人工等待已到期")),
          Math.min(job.input.limits?.humanWaitSeconds || 600, 600) * 1000,
        );
        this.resolveHuman = () => {
          clearTimeout(timer);
          resolve();
        };
        this.rejectHuman = (e) => {
          clearTimeout(timer);
          reject(e);
        };
      });
    } finally {
      this.humanElapsed += Date.now() - humanStarted;
      this.resolveHuman = undefined;
      this.rejectHuman = undefined;
      for (const tcp of this.viewers.values()) tcp.destroy();
      this.viewers.clear();
    }
    this.check(job);
    await this.browser.control(job, false);
  }
  private async inputFiles(job: Job, dir: string) {
    const args = { ...(job.input.args || {}) };
    for (const [key, artifactId] of Object.entries(
      job.input.inputArtifacts || {},
    )) {
      if (key !== "path")
        throw new Fault("INVALID_ARGUMENT", "文件输入字段未支持");
      const res = await fetch(
        this.config.baseUrl +
          `/v1/worker/artifacts/${artifactId}?jobId=${job.id}`,
        { headers: { authorization: `Bearer ${this.config.token}` } },
      );
      if (!res.ok)
        throw new Fault("ARTIFACT_UNAVAILABLE", "输入文件未授权或不可用");
      const bytes = Buffer.from(await res.arrayBuffer());
      if (hash(bytes) !== res.headers.get("x-sha256"))
        throw new Fault("ARTIFACT_INCOMPLETE", "输入文件校验失败");
      const name = path.basename(args.path || "upload.bin");
      filename(name);
      args.path = path.join(dir, name);
      fs.writeFileSync(args.path, bytes, { mode: 0o600 });
    }
    if (job.type === "download" && !args.savePath)
      args.savePath = "download.bin";
    if (args.savePath) {
      filename(args.savePath);
      args.savePath = path.join(dir, args.savePath);
    }
    return args;
  }
  private async upload(job: Job, file: string, name: string, mime: string) {
    const st = fs.statSync(file);
    const hasher = crypto.createHash("sha256");
    for await (const chunk of fs.createReadStream(file)) hasher.update(chunk);
    const digest = hasher.digest("hex");
    const response = await fetch(
      this.config.baseUrl + `/v1/worker/artifacts?jobId=${job.id}`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.config.token}`,
          "content-type": "application/octet-stream",
          "x-filename": encodeURIComponent(path.basename(name)),
          "x-mime-type": mime,
          "x-sha256": digest,
        },
        body: Readable.toWeb(fs.createReadStream(file)) as any,
        duplex: "half",
      } as any,
    );
    const out = (await response.json()) as any;
    if (!response.ok)
      throw new Fault(
        out.error?.code || "ARTIFACT_UPLOAD_FAILED",
        out.error?.message || "产物传输失败",
      );
    return { ...out, relativePath: name };
  }
  async execute(job: Job) {
    this.running = true;
    this.active = job;
    this.cancelled = false;
    this.step = 0;
    this.uncertain = false;
    this.rateLimited = undefined;
    this.activeStarted = Date.now();
    this.humanElapsed = 0;
    this.store.pruneJournalPayloads();
    this.cleanRetainedFiles();
    let commandError: any = null;
    let stopped = true;
    const prior = this.store.journalStart(job.id, {
      jobId: job.id,
      attempt: job.attempt,
      input: job.input,
      type: job.type,
    });
    if (!prior.fresh) {
      const result =
        prior.state === "confirmed" && !prior.resultExpired
          ? prior.result
          : {
              type: "result",
              jobId: job.id,
              fence: job.fence,
              state: "failed",
              effectState: "unknown",
              stopped: false,
              error: {
                code: "EFFECT_UNKNOWN",
                message: "执行端已有未确认记录，未重放",
                retryable: false,
              },
            };
      this.send(result);
      this.running = false;
      this.active = undefined;
      return;
    }
    const dir = mkdir(path.join(this.config.home, "jobs", job.id));
    let clientRetired = false;
    const retireClient = async () => {
      if (!job.sessionId && !clientRetired) {
        await this.browser.releaseClient(job.id);
        clientRetired = true;
      }
    };
    try {
      if (
        job.type === "browser.flow@v1" &&
        job.input.steps?.some((s: any) => s.tool === "reload")
      )
        throw new Fault(
          "CAPABILITY_UNAVAILABLE",
          "reload 只能作为独立维护命令执行",
        );
      await this.browser.control(job);
      let result: any,
        state = "succeeded";
      if (job.kind === "task" && job.type === "article.capture@v1") {
        let article;
        try {
          article = await captureArticle(
            job.input,
            dir,
            (tool, args, raw) => this.run(job, tool, args, raw),
            (info) => this.human(job, info),
            job.executionPolicy,
          );
        } catch (e) {
          if (e instanceof Fault && e.code === "RATE_LIMITED") {
            const origin = e.details?.origin || new URL(job.input.url).origin;
            const observed = this.browser.rateLimit(origin, this.activeStarted);
            e.details = {
              origin,
              retryAfter: observed?.retryAfter ?? null,
              evidence: observed
                ? "browser_response"
                : "page_rate_limit_without_header",
            };
          }
          throw e;
        }
        const artifacts = [];
        privateFile(
          path.join(this.config.home, "source-metadata", job.id + ".json"),
          JSON.stringify({
            expiresAt: Date.now() + 7 * 86400_000,
            ...article.sourceMetadata,
          }),
        );
        for (const f of article.files) {
          this.check(job);
          artifacts.push(
            await this.upload(job, path.join(dir, f.name), f.name, f.mime),
          );
        }
        result = { manifest: article.manifest, artifacts };
        state = article.state;
        await this.run(
          job,
          "tabs",
          { action: "close", tabId: article.tabId },
          true,
        );
        result.captureTab = { id: article.tabId, closed: true };
      } else if (job.kind === "task" && job.type === "browser.flow@v1") {
        const steps = [];
        for (const step of job.input.steps) {
          const out = await this.run(job, step.tool, step.args || {});
          steps.push(out);
          const output = out._meta?.["laofu.output"];
          if (
            out.isError ||
            output?.completed === false ||
            output?.truncated ||
            ["cancelled", "timed_out", "disabled"].includes(output?.outcome)
          ) {
            state = "partial";
            if (output?.outcome === "cancelled") state = "cancelled";
            if (["timed_out", "disabled"].includes(output?.outcome)) {
              state = "failed";
              commandError = {
                code:
                  output.outcome === "timed_out"
                    ? "HUMAN_TIMEOUT"
                    : "CAPABILITY_UNAVAILABLE",
                message: "人工等待未完成，已停止后续步骤",
                retryable: false,
              };
            }
            break;
          }
        }
        result = { steps };
      } else if (job.type === "learnings") {
        const response = await fetch(
          this.config.baseUrl + "/v1/worker/learnings",
          {
            method: "POST",
            headers: {
              authorization: `Bearer ${this.config.token}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({ jobId: job.id, args: job.input.args }),
          },
        );
        const data = (await response.json()) as any;
        if (!response.ok)
          throw new Fault(
            data.error?.code || "LEARNINGS_FAILED",
            data.error?.message || "经验读取失败",
          );
        result = {
          content: [{ type: "text", text: data.text }],
          version: data.version,
          artifacts: [],
        };
      } else {
        const args = await this.inputFiles(job, dir);
        const output = await this.run(job, job.type, args);
        const artifacts = [];
        const outputFile = output._meta?.["laofu.output"]?.outputFile;
        if (outputFile) {
          if (
            path.dirname(path.resolve(outputFile)) !== path.resolve(dir) ||
            !fs.lstatSync(outputFile).isFile()
          )
            throw new Fault(
              "ARTIFACT_INCOMPLETE",
              "输出文件不属于当前任务目录",
            );
          args.savePath = outputFile;
          delete output._meta["laofu.output"].outputFile;
        }
        for (const [index, content] of (output.content || []).entries()) {
          if (
            content.type === "image" &&
            content.data &&
            content.data.length > 256 * 1024
          ) {
            const mime = content.mimeType || "image/png";
            const name = `screenshot-${index + 1}.${mime === "image/jpeg" ? "jpeg" : "png"}`;
            const file = path.join(dir, name);
            fs.writeFileSync(file, Buffer.from(content.data, "base64"), {
              mode: 0o600,
            });
            const artifact = await this.upload(job, file, name, mime);
            artifacts.push(artifact);
            output.content[index] = {
              type: "text",
              text: `截图已保存为 artifact:${artifact.id}（${artifact.bytes} bytes）`,
            };
          }
        }
        if (args.savePath && fs.existsSync(args.savePath)) {
          const header = Buffer.alloc(16),
            fd = fs.openSync(args.savePath, "r");
          fs.readSync(fd, header, 0, 16, 0);
          fs.closeSync(fd);
          const mime = header
            .subarray(0, 8)
            .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
            ? "image/png"
            : header[0] === 255 && header[1] === 216
              ? "image/jpeg"
              : "application/octet-stream";
          const artifact = await this.upload(
            job,
            args.savePath,
            path.basename(args.savePath),
            mime,
          );
          artifacts.push(artifact);
          for (const content of output.content || [])
            if (content.text)
              content.text = content.text
                .split(args.savePath)
                .join(`artifact:${artifact.id}`);
        }
        result = {
          ...output,
          artifacts,
          truncated: !!output._meta?.["laofu.output"]?.truncated,
          originalLength:
            output._meta?.["laofu.output"]?.originalLength ?? null,
        };
        const outcome = output._meta?.["laofu.output"]?.outcome;
        if (outcome === "cancelled") state = "cancelled";
        else if (
          ["disabled", "timed_out"].includes(outcome) ||
          output.isError
        ) {
          state = "failed";
          commandError = {
            code:
              output._meta?.["laofu.error"]?.code ||
              (outcome === "timed_out" ? "HUMAN_TIMEOUT" : "TOOL_ERROR"),
            message: String(
              output.content?.find((x: any) => x.text)?.text ||
                "浏览器工具返回失败",
            ).slice(0, 1000),
            messageTruncated:
              String(output.content?.find((x: any) => x.text)?.text || "")
                .length > 1000,
            originalMessageLength: String(
              output.content?.find((x: any) => x.text)?.text || "",
            ).length,
            retryable: false,
          };
        } else if (output._meta?.["laofu.output"]?.completed === false)
          state = "partial";
        else if (result.truncated) state = "partial";
      }
      this.check(job);
      await this.browser.control(job, true);
      stopped = !this.uncertain;
      result = {
        ...result,
        metrics: {
          elapsedMs: Date.now() - this.activeStarted,
          activeMs: Date.now() - this.activeStarted - this.humanElapsed,
          humanMs: this.humanElapsed,
          steps: this.step,
          rssBytes: process.memoryUsage().rss,
          modelCalls: 0,
        },
        externalEffects: {
          possible:
            job.kind === "command" &&
            [
              "click",
              "type",
              "fill",
              "select",
              "key",
              "act",
              "eval",
              "fetch",
              "upload",
            ].includes(job.type),
          outcome:
            job.kind === "command" &&
            [
              "click",
              "type",
              "fill",
              "select",
              "key",
              "act",
              "eval",
              "fetch",
              "upload",
            ].includes(job.type)
              ? "not_independently_verified"
              : "none",
        },
      };
      // Retire before advertising a reusable worker to the broker.
      await retireClient();
      const response = {
        type: "result",
        jobId: job.id,
        fence: job.fence,
        state,
        effectState:
          state === "failed" &&
          job.kind === "command" &&
          job.type === "wait" &&
          result?._meta?.["laofu.error"]?.browserAcknowledged
            ? "not_started"
            : this.uncertain ||
                state === "failed" ||
                result?._meta?.["laofu.output"]?.effectUnknown
              ? "unknown"
              : "confirmed",
        stopped,
        error: commandError,
        result,
      };
      this.store.journalFinish(job.id, response);
      this.send(response);
    } catch (e) {
      stopped = !this.uncertain;
      this.browser.diagnostic("job_failed", {
        jobId: job.id,
        error: e instanceof Error ? e.stack : String(e),
      });
      await this.browser.control(job, true).catch(() => {
        stopped = false;
      });
      const error = problem(e);
      // Retire before advertising a reusable worker to the broker.
      await retireClient();
      const response = {
        type: "result",
        jobId: job.id,
        fence: job.fence,
        state: this.cancelled ? "cancelled" : "failed",
        effectState: this.step ? "unknown" : "not_started",
        stopped,
        error,
      };
      this.store.journalUnknown(job.id, response);
      this.send(response);
    } finally {
      // Task-only clients never outlive the job. Persistent sessions are retired
      // by session_closed, idle expiry, capacity eviction, or worker shutdown.
      await retireClient();
      fs.rmSync(dir, { recursive: true, force: true });
      this.running = false;
      this.active = undefined;
      this.resolveHuman = undefined;
      this.rejectHuman = undefined;
    }
  }
  private maintainRetention() {
    void this.browser.pruneClients();
    try {
      this.store.pruneJournalPayloads();
      this.cleanRetainedFiles();
    } catch (error) {
      this.browser.diagnostic("retention_failed", { error: String(error) });
    }
  }
  private cleanRetainedFiles(now = Date.now()) {
    const sources = path.join(this.config.home, "source-metadata");
    if (fs.existsSync(sources))
      for (const name of fs.readdirSync(sources)) {
        if (!/^[a-zA-Z0-9_-]+\.json$/.test(name)) continue;
        const file = path.join(sources, name);
        if (!fs.lstatSync(file).isFile()) continue;
        try {
          if (JSON.parse(fs.readFileSync(file, "utf8")).expiresAt < now)
            fs.rmSync(file);
        } catch {}
      }
    const jobs = path.join(this.config.home, "jobs");
    if (fs.existsSync(jobs))
      for (const name of fs.readdirSync(jobs)) {
        if (!/^(tsk|cmd)_[a-f0-9]{32}$/.test(name) || name === this.active?.id)
          continue;
        const dir = path.join(jobs, name),
          stat = fs.lstatSync(dir);
        if (stat.isDirectory() && stat.mtimeMs < now - 86400_000)
          fs.rmSync(dir, { recursive: true, force: true });
      }
  }
  async stop() {
    if (this.stopping) return;
    this.stopping = true;
    clearTimeout(this.reconnectTimer);
    this.cancelled = true;
    this.rejectHuman?.(new Fault("WORKER_STOPPED", "执行端已停止"));
    clearInterval(this.heartbeat);
    clearInterval(this.retentionTimer);
    this.socket?.close();
    for (const s of this.viewers.values()) s.destroy();
    await this.browser.stop();
    await this.execution;
    this.store.close();
  }
}
