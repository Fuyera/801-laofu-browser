#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import net from "node:net";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { parseArgs } from "node:util";
import { Store } from "./store.js";
import { ROOT } from "./catalog.js";
import { discoverHosts, installHost } from "./hosts.js";
import { createServer } from "./server.js";
import { Worker } from "./worker.js";
import { BrowserClient } from "./client.js";
import { mkdir, privateFile, hash, canonical } from "./util.js";
import { problem, Fault } from "./errors.js";
import { processLock } from "./lock.js";
import { egressProxy } from "./network.js";
import { gateway } from "./relay.js";
import { VERSION, BUILD } from "./version.js";
import { serveMcp } from "./mcp.js";
const { values: v, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    home: { type: "string" },
    host: { type: "string" },
    port: { type: "string" },
    config: { type: "string" },
    profile: { type: "string" },
    url: { type: "string" },
    token: { type: "string" },
    name: { type: "string" },
    mode: { type: "string" },
    output: { type: "string" },
    key: { type: "string" },
    headless: { type: "boolean" },
    attach: { type: "boolean" },
    "vnc-port": { type: "string" },
    apply: { type: "boolean" },
    "dry-run": { type: "boolean" },
    discover: { type: "boolean" },
    session: { type: "string" },
    "bridge-port": { type: "string" },
    site: { type: "string" },
  },
});
const command = positionals[0] || "help",
  home = path.resolve(
    v.home ||
      process.env.LAOFU_HOME ||
      path.join(os.homedir(), ".laofu-browser"),
  ),
  ownerFile = path.join(home, "owner.json");
const read = (file: string) => JSON.parse(fs.readFileSync(file, "utf8"));
const print = (x: any) => console.log(JSON.stringify(x, null, 2));
function client() {
  const cfg = fs.existsSync(ownerFile) ? read(ownerFile) : {};
  return new BrowserClient(
    v.url || process.env.LAOFU_URL || cfg.url || "http://127.0.0.1:17889",
    v.token || process.env.LAOFU_TOKEN || cfg.token || "",
  );
}
async function main() {
  if (command === "install" || command === "uninstall") {
    if (!v.host) {
      print({ hosts: discoverHosts(undefined, !!v.discover), applied: false });
      return;
    }
    if (!v.profile)
      throw new Fault(
        "INVALID_ARGUMENT",
        "指定 --profile；本命令默认只显示改动计划，--apply 才写入",
      );
    print(
      installHost({
        host: v.host,
        home,
        profileId: v.profile,
        apply: !!v.apply && !v["dry-run"],
        remove: command === "uninstall",
        target: v.output,
      }),
    );
    return;
  }
  if (command === "extension") {
    if (!v.config)
      throw new Fault("INVALID_ARGUMENT", "extension --config WORKER.json");
    print({
      directory: path.join(read(v.config).home, "engine/extension"),
      baseline: "1.2.0",
      pairedConfiguration: !!fs.existsSync(
        path.join(read(v.config).home, "pairing"),
      ),
    });
    return;
  }
  if (command === "audit" || command === "stats") {
    print(
      await client().request(
        "GET",
        command === "stats" ? "/v1/diagnostics" : "/v1/tasks?includeCommands=1",
      ),
    );
    return;
  }
  if (command === "bridge") {
    throw new Fault(
      "WORKER_REQUIRED",
      "桥生命周期由独立执行端管理：使用 worker --config，避免绕过配对与任务记录",
    );
  }
  if (command === "init") {
    mkdir(home);
    const release = processLock(home, "server");
    try {
      const store = new Store(home);
      if (store.list<any>("product").some((p) => p.role === "owner"))
        throw new Fault(
          "ALREADY_INITIALIZED",
          "状态目录已有所有者；使用 console-login 建立新会话",
        );
      const owner = store.createProduct("本人", "owner", ["*"]);
      privateFile(
        ownerFile,
        JSON.stringify(
          { ...owner, url: v.url || "http://127.0.0.1:17889" },
          null,
          2,
        ),
      );
      store.close();
      print({ initialized: true, home, ownerCredentialFile: ownerFile });
    } finally {
      release();
    }
    return;
  }
  if (command === "console-login") {
    const store = new Store(home);
    const owner = store.list<any>("product").find((p) => p.role === "owner");
    if (!owner) throw new Fault("NOT_INITIALIZED", "先运行 init");
    const key = store.credential("bootstrap", owner.id, 10 * 60000);
    store.close();
    print({
      url: (v.url || read(ownerFile).url) + "/#bootstrap=" + key,
      expiresInSeconds: 600,
    });
    return;
  }
  if (command === "serve") {
    if (!fs.existsSync(ownerFile) && !process.env.LAOFU_ALLOW_REMOTE_INIT)
      throw new Fault("NOT_INITIALIZED", "先运行 init");
    const release = processLock(home, "server");
    const server = await createServer({
      home,
      host: v.host,
      port: Number(v.port || 17889),
    });
    await server.listen();
    print({
      service: "laofu-browser",
      url: `http://${v.host || "127.0.0.1"}:${v.port || 17889}`,
      home,
    });
    const close = async () => {
      await server.app.close();
      release();
    };
    process.once("SIGINT", () => void close());
    process.once("SIGTERM", () => void close());
    return;
  }
  if (command === "pair") {
    const c = client();
    const pair = await c.request("POST", "/v1/admin/workers", {
      name: v.name || "Mac 专用浏览器",
      mode: v.mode || "owner",
    });
    const freePort = await new Promise<number>((resolve, reject) => {
      const probe = net.createServer();
      probe.once("error", reject);
      probe.listen(0, "127.0.0.1", () => {
        const port = (probe.address() as net.AddressInfo).port;
        probe.close(() => resolve(port));
      });
    });
    const config = {
      home: path.join(home, "workers", pair.worker.id),
      baseUrl: c.baseUrl,
      workerId: pair.worker.id,
      profileId: pair.profile.id,
      token: pair.token,
      headless: !!v.headless,
      attach: !!v.attach,
      bridgePort: Number(v["bridge-port"] || freePort),
      ...(v["vnc-port"] ? { vncPort: Number(v["vnc-port"]) } : {}),
    };
    const file = path.join(home, "worker-" + pair.worker.id + ".json");
    privateFile(file, JSON.stringify(config, null, 2));
    print({
      configFile: file,
      profileId: pair.profile.id,
      command: `node dist/cli.js worker --config ${file}`,
    });
    return;
  }
  if (command === "worker") {
    if (!v.config) throw new Fault("INVALID_ARGUMENT", "worker 需要 --config");
    const config = read(v.config);
    const release = processLock(config.home, "worker");
    const worker = new Worker(config);
    const stop = async () => {
      await worker.stop();
      release();
    };
    process.once("SIGINT", () => void stop());
    process.once("SIGTERM", () => void stop());
    try {
      await worker.start();
    } catch (e) {
      await stop();
      throw e;
    }
    print({
      worker: config.workerId,
      profile: config.profileId,
      ready: worker.browser.ready,
    });
    return;
  }
  if (command === "gateway") {
    gateway(process.env.LAOFU_CORE_URL || "http://host.docker.internal:17889");
    return;
  }
  if (command === "proxy") {
    egressProxy(Number(v.port || 18880), v.host || "127.0.0.1");
    print({ proxy: true, port: Number(v.port || 18880) });
    return;
  }
  if (command === "doctor") {
    const c = client();
    const capabilities = await c.capabilities();
    let targetSiteAccess: any = { status: "not_checked" };
    if (v.site) {
      if (!v.profile)
        throw new Fault(
          "INVALID_ARGUMENT",
          "doctor --site URL 需要 --profile，使用指定浏览器进行有界检查",
        );
      const task = await c.submitTask(
        {
          type: "article.capture@v1",
          execution: { profileId: v.profile },
          input: { url: v.site, downloadImages: false },
          limits: {
            activeTimeoutSeconds: 20,
            wallTimeoutSeconds: 35,
            humanWaitSeconds: 5,
            maxBytes: 1024 ** 2,
          },
        },
        "doctor-" + crypto.randomUUID(),
      );
      const result = await c.wait(task.id, { timeoutMs: 40000 });
      targetSiteAccess = {
        status: result.state,
        taskId: task.id,
        accessState:
          result.result?.manifest?.accessState ||
          result.result?.handoff?.reason ||
          null,
        account: result.result?.manifest?.account || null,
        error: result.error,
      };
      if (result.state === "waiting_user") await c.cancel(task.id);
    }
    print({
      packages: {
        version: JSON.parse(
          fs.readFileSync(path.join(ROOT, "package.json"), "utf8"),
        ).version,
        enginePresent: fs.existsSync(
          path.join(ROOT, "runtime/engine/extension/manifest.json"),
        ),
        baseline: "huashu-chrome@1.2.0",
        build: BUILD,
        matchesService: capabilities.version === VERSION,
      },
      targetSiteAccess,
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      home,
      service: await c.request("GET", "/v1/diagnostics"),
      capabilities,
    });
    return;
  }
  if (command === "capabilities") {
    print(await client().capabilities());
    return;
  }
  if (command === "capture") {
    if (!positionals[1] || !v.profile)
      throw new Fault("INVALID_ARGUMENT", "capture URL --profile PROFILE");
    print(
      await client().submitTask(
        {
          type: "article.capture@v1",
          execution: { profileId: v.profile },
          input: { url: positionals[1] },
        },
        v.key || crypto.randomUUID(),
      ),
    );
    return;
  }
  if (command === "call") {
    if ((!v.profile && !v.session) || !positionals[1])
      throw new Fault(
        "INVALID_ARGUMENT",
        "call TOOL JSON --profile PROFILE [--session SESSION]",
      );
    const c = client();
    const cache = path.join(
      home,
      "cli-sessions",
      crypto
        .createHash("sha256")
        .update(c.baseUrl + c.token + v.profile)
        .digest("hex") + ".json",
    );
    let sessionId = v.session;
    if (!sessionId && fs.existsSync(cache)) {
      try {
        sessionId = (await c.request("GET", "/v1/sessions/" + read(cache).id))
          .id;
      } catch (e) {
        if (!(e instanceof Fault) || ![403, 404].includes(e.statusCode))
          throw e;
      }
    }
    if (!sessionId) {
      sessionId = (await c.session(v.profile!)).id;
      privateFile(cache, JSON.stringify({ id: sessionId }));
    }
    const key = v.key || crypto.randomUUID(),
      request: any = {
        tool: positionals[1],
        args: JSON.parse(positionals[2] || "{}"),
      };
    const pending = path.join(
      home,
      "cli-requests",
      crypto.createHash("sha256").update(key).digest("hex") + ".json",
    );
    const inputHash = hash(
      canonical({ sessionId, tool: request.tool, args: request.args }),
    );
    const prior = fs.existsSync(pending) ? read(pending) : undefined;
    if (prior?.inputHash && prior.inputHash !== inputHash)
      throw new Fault("IDEMPOTENCY_CONFLICT", "同一键对应不同 CLI 请求", 409);
    if (request.tool === "upload" && request.args.path) {
      if (prior?.prepared && prior.inputHash === inputHash)
        Object.assign(request, prior.prepared);
      else {
        const artifact = await c.upload(request.args.path);
        request.inputArtifacts = { path: artifact.id };
        request.args.path = path.basename(request.args.path);
      }
    }
    privateFile(
      pending,
      JSON.stringify({
        key,
        sessionId,
        tool: request.tool,
        inputHash,
        prepared: request,
        submittedAt: new Date().toISOString(),
      }),
    );
    try {
      const result = await c.command(sessionId!, request, key);
      privateFile(
        pending,
        JSON.stringify({
          key,
          sessionId,
          jobId: result.id,
          inputHash,
          prepared: request,
        }),
      );
      print({ ...result, idempotencyKey: key });
    } catch (e) {
      console.error(
        JSON.stringify({
          idempotencyKey: key,
          sessionId,
          recoveryFile: pending,
        }),
      );
      throw e;
    }
    return;
  }
  if (command === "job" || command === "cancel" || command === "resume") {
    if (!positionals[1]) throw new Fault("INVALID_ARGUMENT", "需提供任务 ID");
    print(await client()[command](positionals[1]));
    return;
  }
  if (command === "upload") {
    print(await client().upload(positionals[1]));
    return;
  }
  if (command === "download") {
    if (!v.output)
      throw new Fault("INVALID_ARGUMENT", "download ID --output PATH");
    print(await client().download(positionals[1], v.output));
    return;
  }
  if (command === "mcp-config") {
    const args = [
      path.resolve(import.meta.dirname, "cli.js"),
      "mcp",
      "--home",
      home,
      ...(v.profile ? ["--profile", v.profile] : []),
    ];
    const data = {
      mcpServers: { "laofu-browser": { command: process.execPath, args } },
      credentialPolicy:
        "凭据从本机受控目录或宿主提供的 LAOFU_TOKEN 读取，模板不包含密钥",
    };
    if (v.output)
      privateFile(
        path.resolve(v.output),
        JSON.stringify({ mcpServers: data.mcpServers }, null, 2),
      );
    print(data);
    return;
  }
  if (command === "mcp") {
    if (!v.profile)
      throw new Fault("INVALID_ARGUMENT", "mcp --profile PROFILE");
    await serveMcp(client(), v.profile);
    return;
  }
  console.log(
    "laofu-browser: init | serve | console-login | pair | worker | doctor | capabilities | capture | call | job | cancel | resume | upload | download | mcp | mcp-config | install | uninstall | extension | audit | stats\n全局选项: --home DIR --url URL；凭据从 LAOFU_TOKEN 或受控 owner.json 读取。",
  );
}
main().catch((e) => {
  console.error(JSON.stringify({ error: problem(e) }));
  if (process.env.LAOFU_DEBUG) console.error(e);
  process.exitCode = 1;
});
