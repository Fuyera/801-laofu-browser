import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import sharp from "sharp";
import { createServer } from "../dist/server.js";
import { BrowserClient } from "../dist/client.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
const root = path.resolve("."),
  home = fs.mkdtempSync(path.join(root, "workspace/sdk-")),
  external = fs.mkdtempSync(path.join(os.tmpdir(), "laofu-consumers-"));
const run = (cmd, args, options = {}) =>
  new Promise((resolve, reject) => {
    const p = spawn(cmd, args, {
      ...options,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    p.stdout.on("data", (b) => (out += b));
    p.stderr.on("data", (b) => (out += b));
    p.once("exit", (code) =>
      code === 0 ? resolve(out) : reject(new Error(out)),
    );
  });
const png = await sharp({
    create: { width: 30, height: 30, channels: 3, background: "#397288" },
  })
    .png()
    .toBuffer(),
  open = new Set();
const fixture = http.createServer((req, res) => {
  const u = new URL(req.url, "http://localhost");
  if (u.pathname === "/unlock") {
    open.add(u.searchParams.get("client"));
    res.end("ok");
    return;
  }
  if (u.pathname === "/open") {
    res.end(open.has(u.searchParams.get("client")) ? "yes" : "no");
    return;
  }
  if (u.pathname === "/image.png") {
    res.setHeader("content-type", "image/png");
    res.end(png);
    return;
  }
  res.setHeader("content-type", "text/html; charset=utf-8");
  if (u.pathname === "/gate") {
    res.end(
      `<title>请先登录</title><main>请先登录后继续，这是人工接手测试页。</main><script>setInterval(async()=>{if(await(await fetch('/open?client=${u.searchParams.get("client")}')).text()==='yes')location.href='/article'},200)</script>`,
    );
    return;
  }
  res.end(
    "<title>独立 SDK 采集</title><article><h1>独立 SDK 采集</h1><p>" +
      "完整图文采集测试。".repeat(30) +
      '</p><img src="/image.png"><table><tr><th>名称</th><th>值</th></tr><tr><td>能力</td><td>共享服务</td></tr></table></article>',
  );
});
await new Promise((r) => fixture.listen(17932, "127.0.0.1", r));
const server = await createServer({ home, port: 17931 });
const owner = server.store.createProduct("SDK 安装验收所有者", "owner", ["*"]);
await server.listen();
const c = new BrowserClient("http://127.0.0.1:17931", owner.token);
let worker;
try {
  const pair = await c.request("POST", "/v1/admin/workers", {
      name: "SDK 真实浏览器",
    }),
    offline = await c.request("POST", "/v1/admin/workers", {
      name: "取消测试离线配置",
    });
  const cfg = {
    home: path.join(home, "worker"),
    baseUrl: c.baseUrl,
    workerId: pair.worker.id,
    profileId: pair.profile.id,
    token: pair.token,
    headless: true,
    bridgePort: 18931,
  };
  fs.writeFileSync(path.join(home, "worker.json"), JSON.stringify(cfg), {
    mode: 0o600,
  });
  const fd = fs.openSync(path.join(home, "worker.log"), "a");
  worker = spawn(
    process.execPath,
    ["dist/cli.js", "worker", "--config", path.join(home, "worker.json")],
    { stdio: ["ignore", fd, fd] },
  );
  fs.closeSync(fd);
  for (let i = 0; i < 120; i++) {
    if ((await c.capabilities()).profiles.some((p) => p.ready)) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  const env = {
    ...process.env,
    PATH: path.dirname(process.execPath) + ":" + process.env.PATH,
    LAOFU_URL: c.baseUrl,
    LAOFU_TOKEN: owner.token,
    LAOFU_PROFILE: pair.profile.id,
    LAOFU_OFFLINE_PROFILE: offline.profile.id,
    LAOFU_SAMPLE_URL: "http://127.0.0.1:17932",
  };
  const ts = path.join(external, "typescript"),
    py = path.join(external, "python");
  fs.mkdirSync(ts);
  fs.mkdirSync(py);
  fs.writeFileSync(
    path.join(ts, "package.json"),
    '{"private":true,"type":"module"}',
  );
  console.log(
    await run(
      "npm",
      [
        "install",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        path.join(
          root,
          `releases/laofu-browser-${JSON.parse(fs.readFileSync(path.join(root, "package.json"))).version}.tgz`,
        ),
      ],
      { cwd: ts, env },
    ),
  );
  fs.copyFileSync("examples/consumer.mjs", path.join(ts, "consumer.mjs"));
  console.log(await run(process.execPath, ["consumer.mjs"], { cwd: ts, env }));
  await run("python3", ["-m", "venv", path.join(py, "venv")]);
  const python = path.join(py, "venv/bin/python");
  console.log(
    await run(python, [
      "-m",
      "pip",
      "install",
      "--no-index",
      "--no-deps",
      path.join(
        root,
        `releases/laofu_browser-${JSON.parse(fs.readFileSync(path.join(root, "package.json"))).version.replace("-dev.", ".dev")}-py3-none-any.whl`,
      ),
    ]),
  );
  fs.copyFileSync("examples/consumer.py", path.join(py, "consumer.py"));
  console.log(await run(python, ["consumer.py"], { cwd: py, env }));
  const results = [
    JSON.parse(fs.readFileSync(path.join(ts, "result.json"))),
    JSON.parse(fs.readFileSync(path.join(py, "result.json"))),
  ];
  const cli = JSON.parse(
    await run(process.execPath, ["dist/cli.js", "job", results[0].capture], {
      cwd: root,
      env,
    }),
  );
  const mcp = new Client(
    { name: "sdk-smoke", version: "1" },
    { capabilities: {} },
  );
  await mcp.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [
        path.join(root, "dist/cli.js"),
        "mcp",
        "--profile",
        pair.profile.id,
      ],
      env,
      stderr: "ignore",
    }),
  );
  const tool = await mcp.callTool({
    name: "laofu_job",
    arguments: { id: results[0].capture },
  });
  await mcp.close();
  if (
    cli.id !== results[0].capture ||
    !tool.content[0].text.includes(results[0].capture)
  )
    throw new Error("CLI/MCP results differ");
  const report = {
    home,
    external,
    results,
    scope:
      "两个独立安装的 SDK 程序通过所有者入口访问真实服务；不作为受限产品隔离或业务产品接入证据",
    cliMcpSameTask: true,
  };
  fs.writeFileSync(
    path.join(home, "report.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report));
} finally {
  if (worker && worker.exitCode === null) {
    worker.kill("SIGTERM");
    await new Promise((r) => {
      worker.once("exit", r);
      setTimeout(() => {
        worker.kill("SIGKILL");
        r();
      }, 10000).unref();
    });
  }
  await server.app.close();
  await new Promise((r) => fixture.close(r));
}
