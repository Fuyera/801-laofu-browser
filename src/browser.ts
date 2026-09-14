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
  private clients = new Map<string, Client>();
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
  async client(sessionId: string) {
    let client = this.clients.get(sessionId);
    if (!client) {
      client = new Client(
        { name: "laofu-browser-worker", version: "0.1.0" },
        { capabilities: {} },
      );
      await client.connect(
        new StdioClientTransport({
          command: process.execPath,
          args: [
            path.join(this.engine, "src/cli.js"),
            "mcp",
            "--client",
            "laofu-browser",
          ],
          env: { ...this.env, LAOFU_SESSION_ID: sessionId },
          stderr: "ignore",
        }),
      );
      this.clients.set(sessionId, client);
    }
    return client;
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
        maxBytes:
          job.kind === "task"
            ? job.input.limits?.maxBytes || 52428800
            : 536870912,
      },
    };
  }
  async call(name: string, args: any, job: Job): Promise<ToolReply> {
    const client = await this.client(job.sessionId || job.id);
    const timeout = Math.max(
      35000,
      Math.min(job.expiresAt - Date.now() + 25000, 925000),
    );
    const result = (await client.callTool(
      { name, arguments: this.args(args, job) },
      undefined,
      { timeout },
    )) as ToolReply;
    if (name === "reload" && !result.isError) {
      await new Promise((r) => setTimeout(r, 500));
      await this.connected(45000);
    }
    return result;
  }
  async raw(name: string, args: any, job: Job) {
    return this.rpc.call(name, this.args(args, job), {
      tabId: args.tabId,
      timeoutMs: Math.max(35000, Math.min(job.expiresAt - Date.now(), 650000)),
    });
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
  async stop() {
    this.stopping = true;
    await Promise.allSettled([...this.clients.values()].map((c) => c.close()));
    this.clients.clear();
    this.rpc?.close();
    await this.context?.close();
    this.bridge?.kill("SIGTERM");
    this.logs?.close();
  }
}
