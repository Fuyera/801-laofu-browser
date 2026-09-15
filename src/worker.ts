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
  private stopping = false;
  private step = 0;
  private running = false;
  private uncertain = false;
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
  }
  async start() {
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
    const pending = this.browser.call("ask", args, job);
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
      return await pending;
    } finally {
      if (humanStart) this.humanElapsed += Date.now() - humanStart;
      this.resolveHuman = undefined;
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
    this.activeStarted = Date.now();
    this.humanElapsed = 0;
    let commandError: any = null;
    let stopped = true;
    const dir = mkdir(path.join(this.config.home, "jobs", job.id));
    const prior = this.store.journalStart(job.id, {
      jobId: job.id,
      attempt: job.attempt,
      input: job.input,
      type: job.type,
    });
    if (!prior.fresh) {
      const result =
        prior.state === "confirmed"
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
    try {
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
          if (out.isError) {
            state = "partial";
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
            : state === "failed" ||
                result?._meta?.["laofu.output"]?.effectUnknown
              ? "unknown"
              : "confirmed",
        stopped,
        error: commandError,
        result,
      };
      this.store.journalFinish(job.id, response);
      this.send(response);
      fs.rmSync(dir, { recursive: true, force: true });
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
      this.running = false;
      this.active = undefined;
      this.resolveHuman = undefined;
      this.rejectHuman = undefined;
    }
  }
  async stop() {
    if (this.stopping) return;
    this.stopping = true;
    clearTimeout(this.reconnectTimer);
    this.cancelled = true;
    this.rejectHuman?.(new Fault("WORKER_STOPPED", "执行端已停止"));
    clearInterval(this.heartbeat);
    this.socket?.close();
    for (const s of this.viewers.values()) s.destroy();
    await this.browser.stop();
    await this.execution;
    this.store.close();
  }
}
