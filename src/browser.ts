import { VERSION, BUILD, API_VERSION } from "./version.js";
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import { spawn, type ChildProcess } from "node:child_process";
import { pathToFileURL } from "node:url";
import { chromium, type BrowserContext } from "playwright";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ROOT } from "./catalog.js";
import { Fault } from "./errors.js";
import { operationalLog } from "./logs.js";
import { mkdir, privateFile, secret } from "./util.js";
import type { Job, ToolReply } from "./types.js";
import { ClientPool } from "./client-pool.js";
export interface BrowserConfig {
  home: string;
  profileId: string;
  headless?: boolean;
  attach?: boolean;
  proxy?: string;
  bridgePort?: number;
  display?: string;
}
export class BrowserAdapter {
  private bridge?: ChildProcess;
  private context?: BrowserContext;
  private clients = new ClientPool<Client>((key) => this.createClient(key));
  private rpc: any;
  private current?: Job;
  private stopping = false;
  private logs?: ReturnType<typeof operationalLog>;
  get ready() {
    return (
      this.rpc?.ws?.readyState === 1 &&
      !!this.rpc?.extensionOnline &&
      !this.stopping
    );
  }
  readonly engine: string;
  readonly env: Record<string, string>;
  readonly port: number;
  readonly pairing: string;
  browserVersion = "unknown";
  onRateLimit?: (evidence: {
    origin: string;
    retryAfter: string | null;
    observedAt: number;
  }) => void;
  private rateResponses = new Map<
    string,
    { origin: string; retryAfter: string | null; observedAt: number }
  >();
  rateLimit(url: string, since: number) {
    const value = this.rateResponses.get(new URL(url).origin);
    return value && value.observedAt >= since ? value : undefined;
  }
  constructor(readonly config: BrowserConfig) {
    this.engine = path.join(mkdir(config.home), "engine");
    this.port = config.bridgePort || 18899;
    const pairFile = path.join(config.home, "pairing");
    this.pairing = fs.existsSync(pairFile)
      ? fs.readFileSync(pairFile, "utf8").trim()
      : secret();
    if (!fs.existsSync(pairFile)) privateFile(pairFile, this.pairing);
    this.env = Object.fromEntries(
      Object.entries({
        ...process.env,
        LAOFU_ENGINE_HOME: path.join(config.home, "bridge"),
        LAOFU_BRIDGE_PORT: String(this.port),
        LAOFU_PAIR_TOKEN: this.pairing,
        LAOFU_PROFILE_ID: config.profileId,
        LAOFU_SESSION_ID: "lb-" + config.profileId,
        HUASHU_CHROME_ASK: "on",
        ...(config.display ? { DISPLAY: config.display } : {}),
      }).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
  }
  async start() {
    if (!fs.existsSync(path.join(ROOT, "runtime/engine")))
      throw new Fault("ENGINE_MISSING", "请先运行构建生成执行引擎");
    fs.cpSync(path.join(ROOT, "runtime/engine"), this.engine, {
      recursive: true,
    });
    const modules = path.join(this.engine, "node_modules");
    if (
      fs.existsSync(modules) &&
      fs.lstatSync(modules).isSymbolicLink() &&
      fs.readlinkSync(modules) !== path.join(ROOT, "node_modules")
    )
      fs.unlinkSync(modules);
    if (!fs.existsSync(modules))
      fs.symlinkSync(
        path.join(ROOT, "node_modules"),
        modules,
        process.platform === "win32" ? "junction" : "dir",
      );
    privateFile(
      path.join(this.engine, "extension/laofu-config.js"),
      `export const LAOFU = ${JSON.stringify({ port: this.port, token: this.pairing, profileId: this.config.profileId })};\n`,
    );
    this.logs = operationalLog(this.config.home);
    this.bridge = spawn(
      process.execPath,
      [
        path.join(this.engine, "src/cli.js"),
        "bridge",
        "--foreground",
        "--port",
        String(this.port),
      ],
      { env: this.env, stdio: ["ignore", "pipe", "pipe"] },
    );
    for (const stream of [this.bridge.stdout, this.bridge.stderr])
      stream?.on("data", (chunk) =>
        this.logs?.write("bridge", { message: String(chunk) }),
      );
    const infoFile = path.join(this.env.LAOFU_ENGINE_HOME, "bridge.json");
    for (let i = 0; i < 100; i++) {
      if (this.bridge.exitCode !== null)
        throw new Fault("BRIDGE_START_FAILED", "独立桥启动失败");
      if (fs.existsSync(infoFile)) {
        const info = JSON.parse(fs.readFileSync(infoFile, "utf8"));
        if (info.pid === this.bridge.pid) break;
      }
      await new Promise((r) => setTimeout(r, 100));
      if (i === 99) throw new Fault("BRIDGE_START_FAILED", "独立桥未就绪");
    }
    if (!this.config.attach) {
      const extension = path.join(this.engine, "extension");
      this.context = await chromium.launchPersistentContext(
        path.join(this.config.home, "chrome-profile"),
        {
          ignoreDefaultArgs: ["--disable-extensions"],
          channel: "chromium",
          headless: this.config.headless ?? false,
          chromiumSandbox: true,
          // The worker owns shutdown: let context.close() flush the persistent
          // profile before container init terminates any remaining children.
          handleSIGINT: false,
          handleSIGTERM: false,
          acceptDownloads: true,
          downloadsPath: mkdir(path.join(this.config.home, "downloads")),
          env: this.env,
          args: [
            `--disable-extensions-except=${extension}`,
            `--load-extension=${extension}`,
            ...(this.config.proxy
              ? [
                  `--proxy-server=${this.config.proxy}`,
                  `--proxy-bypass-list=<-loopback>;127.0.0.1:${this.port}`,
                  "--disable-quic",
                  "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
                ]
              : []),
          ],
        },
      );
      this.browserVersion =
        this.context.browser()?.version() ||
        (await this.context.pages()[0]?.evaluate(() => navigator.userAgent)) ||
        "unknown";
      this.context.on("response", (response) => {
        if (response.status() !== 429) return;
        const origin = new URL(response.url()).origin;
        this.rateResponses.set(origin, {
          origin,
          retryAfter: response.headers()["retry-after"] || null,
          observedAt: Date.now(),
        });
        this.onRateLimit?.(this.rateResponses.get(origin)!);
      });
      const setup = await this.context.newPage();
      try {
        const downloadSession = await this.context.newCDPSession(setup);
        await downloadSession.send("Browser.setDownloadBehavior", {
          behavior: "allow",
          downloadPath: mkdir(path.join(this.config.home, "downloads")),
        });
        await downloadSession.detach();
        await setup.goto("chrome://extensions");
        const toggle = setup.locator("#devMode");
        await toggle.waitFor();
        if (!(await toggle.evaluate((el: any) => !!el.checked)))
          await toggle.click();
        if (!(await toggle.evaluate((el: any) => !!el.checked)))
          throw new Fault(
            "EXTENSION_SETUP_FAILED",
            "专用浏览器的开发者模式未启用",
          );
      } finally {
        await setup.close();
      }
    }
    // Each Worker owns exactly one profile; the imported bridge client reads only this process's private home.
    for (const key of [
      "LAOFU_ENGINE_HOME",
      "LAOFU_BRIDGE_PORT",
      "LAOFU_PAIR_TOKEN",
      "LAOFU_PROFILE_ID",
    ])
      process.env[key] = this.env[key];
    const { BridgeClient } = await import(
      pathToFileURL(path.join(this.engine, "src/lib/rpc.js")).href
    );
    this.rpc = new BridgeClient({
      client: "laofu-browser",
      sessionId: "lb-control-" + this.config.profileId,
    });
    await this.rpc.connect();
    if (this.config.attach) {
      console.error(
        `等待本人 Chrome 加载配对扩展：${path.join(this.engine, "extension")}；执行端会保持等待，不操作未配对浏览器`,
      );
      return;
    }
    for (let i = 0; i < 150; i++) {
      if (this.stopping) throw new Fault("WORKER_STOPPED", "执行端已停止");
      if (this.rpc.extensionOnline) return;
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Fault("EXTENSION_OFFLINE", "独立扩展未连接");
  }
  private async createClient(sessionId: string) {
    const client = new Client(
      { name: "laofu-browser-worker", version: VERSION },
      { capabilities: {} },
    );
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [path.join(this.engine, "src/cli.js"), "mcp", "--client", "laofu-browser"],
      env: { ...this.env, LAOFU_SESSION_ID: sessionId },
      stderr: "ignore",
    });
    try {
      await client.connect(transport);
      return client;
    } catch (error) {
      await Promise.allSettled([client.close(), transport.close()]);
      throw error;
    }
  }
  async releaseClient(key: string) {
    try {
      await this.clients.release(key);
    } catch (error) {
      this.diagnostic("client_cleanup_failed", { key, error: String(error) });
    }
  }
  async pruneClients() {
    try {
      await this.clients.sweep();
    } catch (error) {
      this.diagnostic("client_cleanup_failed", { error: String(error) });
    }
  }
  async connected(timeout = 35000) {
    const end = Date.now() + timeout;
    while (!this.ready && Date.now() < end)
      await new Promise((r) => setTimeout(r, 200));
    if (!this.ready)
      throw new Fault(
        "EXTENSION_OFFLINE",
        "扩展未在预算内重连；已停止后续动作",
      );
  }
  async control(job: Job, cancelled = false) {
    this.current = job;
    await this.connected();
    return this.rpc.call(
      "__lb_control",
      { jobId: job.id, fence: job.fence, expiresAt: job.expiresAt, cancelled },
      { timeoutMs: 10000 },
    );
  }
  async handoff(job: Job, outcome?: "continued" | "cancelled") {
    return this.rpc.call(
      "__lb_control",
      {
        op: outcome ? "ask_finish" : "ask_status",
        jobId: job.id,
        fence: job.fence,
        outcome,
      },
      { timeoutMs: 5000 },
    );
  }
  private args(args: any, job: Job) {
    return {
      ...args,
      __lb: {
        jobId: job.id,
        fence: job.fence,
        outputDir: path.join(this.config.home, "jobs", job.id),
        maxBytes:
          job.kind === "task"
            ? job.input.limits?.maxBytes || 52428800
            : 536870912,
      },
    };
  }
  async call(name: string, args: any, job: Job): Promise<ToolReply> {
    const timeout = Math.max(
      35000,
      Math.min(job.expiresAt - Date.now() + 25000, 925000),
    );
    const result = await this.clients.use(job.sessionId || job.id, async (client) =>
      await client.callTool(
        { name, arguments: this.args(args, job) },
        undefined,
        { timeout },
      ) as ToolReply,
    );
    if (name === "reload" && !result.isError) {
      await new Promise((r) => setTimeout(r, 500));
      await this.connected(45000);
    }
    return result;
  }
  async raw(name: string, args: any, job: Job) {
    // Register the new page before the recipe navigates it, so initial response headers cannot race observation.
    const page =
      name === "tabs" &&
      args.action === "new" &&
      (!args.url || args.url === "about:blank") &&
      this.context
        ? this.context.waitForEvent("page", { timeout: 10000 })
        : undefined;
    void page?.catch(() => {});
    const result = await this.rpc.call(name, this.args(args, job), {
      tabId: args.tabId,
      timeoutMs: Math.max(35000, Math.min(job.expiresAt - Date.now(), 650000)),
    });
    if (page) await page;
    return result;
  }
  async evaluate(expression: string, job: Job, tabId?: number) {
    const result = await this.raw(
      "eval",
      { expr: expression, tabId, maxLength: 16000 },
      job,
    );
    if (result.text?.includes("…（已截断）"))
      throw new Fault("TRUNCATED", "内部提取输出被截断");
    try {
      return JSON.parse(result.text);
    } catch {
      throw new Fault(
        "INVALID_BROWSER_RESULT",
        "浏览器返回了不可解析的提取结果",
      );
    }
  }
  diagnostic(event: string, data: Record<string, unknown>) {
    this.logs?.write(event, data);
  }
  async stop() {
    this.stopping = true;
    await this.clients.close().catch((error) =>
      this.diagnostic("client_cleanup_failed", { error: String(error) }),
    );
    this.rpc?.close();
    await this.context?.close();
    this.bridge?.kill("SIGTERM");
    this.logs?.close();
  }
}
