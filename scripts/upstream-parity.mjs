import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chromium } from "playwright";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createServer } from "../dist/server.js";
import { BrowserClient } from "../dist/client.js";
const root = path.resolve("."),
  home = fs.mkdtempSync(path.join(root, "workspace/parity-")),
  upstream = path.join(home, "upstream"),
  base = "http://127.0.0.1:17972",
  results = [];
fs.cpSync("vendor/huashu-chrome-1.2.0", upstream, { recursive: true });
fs.symlinkSync(
  path.join(root, "node_modules"),
  path.join(upstream, "node_modules"),
);
// Three infrastructure substitutions only; no tool or MCP semantic patches on this side.
const paths = path.join(upstream, "src/lib/paths.js");
fs.writeFileSync(
  paths,
  fs
    .readFileSync(paths, "utf8")
    .replace(
      "path.join(os.homedir(), '.huashu-chrome')",
      JSON.stringify(path.join(home, "baseline-state")),
    )
    .replace("DEFAULT_PORT = 8899", "DEFAULT_PORT = 18972"),
);
for (const rel of ["background.js", "offscreen.js"]) {
  const bg = path.join(upstream, "extension", rel);
  const before = fs.readFileSync(bg, "utf8");
  assert.ok(before.includes("const PORTS = [8899, 8900, 8901, 8902, 8903];"));
  fs.writeFileSync(
    bg,
    before.replace(
      "const PORTS = [8899, 8900, 8901, 8902, 8903];",
      "const PORTS = [18972];",
    ),
  );
}
const fixture = http.createServer((req, res) => {
  if (req.url === "/csp") {
    res.setHeader(
      "content-security-policy",
      "default-src 'self'; script-src 'self'",
    );
    res.setHeader("content-type", "text/html; charset=utf-8");
    return res.end("<title>CSP 对照</title><h1>严格 CSP 正文</h1>");
  }
  if (req.url.startsWith("/pages")) {
    const url = new URL(req.url, base),
      mode = url.searchParams.get("mode");
    res.setHeader("content-type", "application/json");
    if (mode === "error") {
      res.statusCode = 503;
      return res.end('{"error":"unavailable"}');
    }
    if (mode === "empty") return res.end("");
    return res.end(
      JSON.stringify({
        items: ["fixed"],
        next: mode === "cursor" ? "same" : null,
      }),
    );
  }
  if (req.url === "/edge") {
    res.setHeader("content-type", "text/html; charset=utf-8");
    return res.end(
      `<title>参数族边界</title><button id="stale" onclick="document.body.dataset.wrong='clicked'">旧按钮</button><div id="rich" contenteditable="true" role="textbox" aria-label="富文本"></div><div id="shadow"></div><dialog><p>模态内容</p></dialog><canvas id="canvas" width="300" height="120" style="position:fixed;left:10px;top:400px;background:#aaddff"></canvas><output id="drag-result"></output><script>document.querySelector('#shadow').attachShadow({mode:'open'}).innerHTML='<button>Shadow 按钮</button>';document.querySelector('#canvas').addEventListener('pointerup',()=>document.querySelector('#drag-result').textContent='drag-ended');</script>`,
    );
  }
  if (req.url.startsWith("/data")) {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ items: [{ title: "对照数据" }] }));
    return;
  }
  if (req.url.startsWith("/file")) {
    res.setHeader("content-type", "application/octet-stream");
    res.setHeader("content-disposition", 'attachment; filename="same.txt"');
    res.end("same file bytes");
    return;
  }
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.end(
    `<title>上游同输入对照</title><h1>上游同输入对照</h1><input id="name" aria-label="名称"><select id="select"><option value="a">甲</option><option value="b">乙</option></select><input type="checkbox" id="check"><input type="file" id="file"><p class="entry">对照正文</p><pre>const value=42;</pre><div style="height:1200px"></div><p>底部</p><script>fetch('/data')</script>`,
  );
});
await new Promise((r) => fixture.listen(17972, "127.0.0.1", r));
const core = await createServer({ home: path.join(home, "core"), port: 17973 });
const identity = core.store.createProduct("parity owner", "owner", ["*"]);
await core.listen();
const c = new BrowserClient("http://127.0.0.1:17973", identity.token);
const procs = [];
let context, mcp;
function proc(args, env = process.env) {
  const fd = fs.openSync(path.join(home, "processes.log"), "a", 0o600),
    p = spawn(process.execPath, args, { stdio: ["ignore", fd, fd], env });
  fs.closeSync(fd);
  procs.push(p);
  return p;
}
const text = (r) =>
  (r.content || [])
    .filter((x) => x.type === "text")
    .map((x) => x.text)
    .join("\n");
try {
  proc([
    path.join(upstream, "src/cli.js"),
    "bridge",
    "--foreground",
    "--port",
    "18972",
  ]);
  for (
    let i = 0;
    i < 100 && !fs.existsSync(path.join(home, "baseline-state/bridge.json"));
    i++
  )
    await new Promise((r) => setTimeout(r, 100));
  const extension = path.join(upstream, "extension");
  context = await chromium.launchPersistentContext(
    path.join(home, "baseline-chrome"),
    {
      channel: "chromium",
      headless: true,
      chromiumSandbox: true,
      ignoreDefaultArgs: ["--disable-extensions"],
      args: [
        `--disable-extensions-except=${extension}`,
        `--load-extension=${extension}`,
      ],
    },
  );
  const setup = await context.newPage();
  await setup.goto("chrome://extensions");
  if (!(await setup.locator("#devMode").evaluate((e) => !!e.checked)))
    await setup.locator("#devMode").click();
  const cdp = await context.newCDPSession(setup);
  fs.mkdirSync(path.join(home, "baseline-downloads"));
  await cdp.send("Browser.setDownloadBehavior", {
    behavior: "allow",
    downloadPath: path.join(home, "baseline-downloads"),
  });
  await cdp.detach();
  await setup.close();
  mcp = new Client({ name: "baseline-parity", version: "1.0" });
  await mcp.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [path.join(upstream, "src/cli.js"), "mcp"],
      env: { ...process.env, HUASHU_CHROME_ASK: "on" },
      stderr: "pipe",
    }),
  );
  await new Promise((r) => setTimeout(r, 1200));
  const pair = await c.request("POST", "/v1/admin/workers", {
      name: "adapter parity",
    }),
    config = path.join(home, "worker.json");
  fs.writeFileSync(
    config,
    JSON.stringify({
      home: path.join(home, "adapter-worker"),
      baseUrl: c.baseUrl,
      token: pair.token,
      workerId: pair.worker.id,
      profileId: pair.profile.id,
      headless: true,
      bridgePort: 18973,
    }),
    { mode: 0o600 },
  );
  proc(["dist/cli.js", "worker", "--config", config]);
  for (let i = 0; i < 120; i++) {
    if ((await c.capabilities()).profiles.some((p) => p.ready)) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  const session = await c.session(pair.profile.id);
  let serial = 0;
  const original = (tool, args) =>
    mcp.callTool({ name: tool, arguments: args }, undefined, {
      timeout: 180000,
    });
  const adapted = async (tool, args, inputArtifacts) => {
    let j = await c.wait(
      (
        await c.command(
          session.id,
          { tool, args, inputArtifacts },
          "parity-" + ++serial,
        )
      ).id,
    );
    for (let i = 0; j.state === "waiting_user" && i < 40; i++) {
      await new Promise((r) => setTimeout(r, 250));
      j = await c.job(j.id);
    }
    if (j.error)
      return {
        isError: true,
        content: [{ type: "text", text: JSON.stringify(j.error) }],
      };
    return j.result;
  };
  async function check(id, tool, args = {}, options = {}) {
    try {
      const a = await original(tool, options.originalArgs || args),
        b = await adapted(tool, args, options.inputArtifacts);
      fs.writeFileSync(
        path.join(home, id + "-result.json"),
        JSON.stringify({ tool, args, original: a, adapter: b }, null, 2),
      );
      assert.equal(!!a.isError, !!b.isError, "isError differs");
      assert.equal(!!a.isError, !!options.error);
      if (options.assert) {
        options.assert(a);
        options.assert(b);
      }
      results.push({
        id,
        tool,
        status: "passed",
        difference: options.difference || null,
      });
      console.log("PASS " + id + " " + tool);
    } catch (e) {
      results.push({ id, tool, status: "failed", error: String(e) });
      console.log("FAIL " + id + " " + e.message);
    }
  }
  const list = await mcp.listTools(),
    baseline = JSON.parse(fs.readFileSync("docs/LAOFU_BROWSER_BASELINE.json"));
  for (const t of baseline.tools)
    assert.deepEqual(
      list.tools.find((x) => x.name === t.name).inputSchema,
      t.inputSchema,
    );
  await check("B10", "tabs", { action: "new", url: base, label: "对照" });
  await check("B02", "navigate", { url: base });
  await check(
    "B01",
    "snapshot",
    {},
    { assert: (r) => assert.match(text(r), /名称/) },
  );
  await check("B03", "click", { selector: "#check", real: true });
  await check("B04", "type", {
    selector: "#name",
    text: "同输入",
    clear: true,
    expect: { value: "同输入" },
  });
  await check("B05", "select", { find: { selector: "#select" }, value: "b" });
  const snapshots = [
    await original("snapshot", {}),
    await adapted("snapshot", {}),
  ];
  const fields = snapshots.map((r) => {
    const s = text(r),
      ref = /\b(e\d+)\b/.exec(
        s.split("\n").find((x) => x.includes("名称") && /e\d+/.test(x)),
      )?.[1],
      snapshotId = /\[snapshot (s\d+)\]/.exec(s)?.[1];
    assert.ok(ref && snapshotId);
    return { fields: [{ ref, text: "同值填充" }], snapshotId };
  });
  await check("B06", "fill", fields[1], {
    originalArgs: fields[0],
    difference: "使用各自实际 snapshotId/ref，同一字段与值",
  });
  await check("B07", "key", { key: "Escape", real: true });
  await check(
    "B08",
    "read_text",
    { format: "markdown" },
    { assert: (r) => assert.match(text(r), /对照正文/) },
  );
  await check(
    "B09",
    "screenshot",
    {},
    { assert: (r) => assert.equal(r.content[0].mimeType, "image/jpeg") },
  );
  await check("B11", "wait", {
    for: "selector",
    value: "#name",
    timeout: 3000,
  });
  await check("B12", "network", { reload: true, match: "/data" });
  await check(
    "B13",
    "fetch",
    { url: base + "/data", maxBody: 20000 },
    { assert: (r) => assert.match(text(r), /对照数据/) },
  );
  await check("B14", "scroll", { to: "bottom", times: 1 });
  await check(
    "B15",
    "download",
    { url: base + "/file", savePath: "same.txt", timeout: 10000 },
    {
      originalArgs: {
        url: base + "/file",
        savePath: path.join(home, "same.txt"),
        timeout: 10000,
      },
      difference: "MCP本机文件对应HTTP受控artifact，不暴露服务器路径",
    },
  );
  const upload = path.join(home, "upload.txt");
  fs.writeFileSync(upload, "same upload");
  const artifact = await c.upload(upload);
  await check(
    "B16",
    "upload",
    { path: "upload.txt", selector: "#file" },
    {
      originalArgs: { path: upload, selector: "#file" },
      inputArtifacts: { path: artifact.id },
      difference: "调用端路径上传为artifact后在执行端解析",
    },
  );
  await check(
    "B17",
    "query",
    { selector: ".entry", limit: 10 },
    { assert: (r) => assert.match(text(r), /对照正文/) },
  );
  await check("B18", "act", {
    steps: [
      { do: "assert", cond: { selectorExists: "#name" } },
      { do: "read", selector: ".entry" },
    ],
  });
  await check("B19", "ask", {
    prompt: "对照完成条件",
    until: { selectorExists: "#name" },
    timeout: 5000,
    focus: false,
  });
  await check("B20", "status", { text: "对照完成" });
  await check(
    "B21",
    "eval",
    { expr: "({value:42})" },
    { assert: (r) => assert.match(text(r), /42/) },
  );
  await check(
    "B22",
    "learnings",
    { domain: "example.com", save: "同一经验" },
    { difference: "laofu另保留版本、CAS与本产品权限" },
  );
  await check(
    "ERR",
    "wait",
    { for: "selector", value: "#absent", timeout: 100 },
    { error: true },
  );
  await check("B23", "reload");
  await new Promise((r) => setTimeout(r, 4000));
  await check("RECONNECT", "status", { text: "扩展重连后继续" });
  for (const mode of ["repeat", "empty", "error", "cursor"])
    await check(
      `PAGINATION-${mode}`,
      "fetch",
      {
        url: base + "/pages?mode=" + mode,
        pages:
          mode === "cursor"
            ? { cursorParam: "cursor", cursorPath: "next", max: 4 }
            : { param: "page", max: 4 },
      },
      {
        assert: (r) => {
          assert.match(text(r), /已抓 [0-2] 页/);
          assert.doesNotMatch(text(r), /上限/);
        },
      },
    );
  await check("CSP-PAGE", "navigate", { url: base + "/csp" });
  await check(
    "CSP-EVAL",
    "eval",
    { expr: "40+2" },
    { assert: (r) => assert.match(text(r), /42/) },
  );
  await check(
    "CSP-READ",
    "read_text",
    {},
    { assert: (r) => assert.match(text(r), /严格 CSP 正文/) },
  );
  await check("EDGE-PAGE", "navigate", { url: base + "/edge" });
  await check(
    "SHADOW",
    "snapshot",
    {},
    { assert: (r) => assert.match(text(r), /Shadow 按钮/) },
  );
  await check("RICH-TEXT", "type", {
    selector: "#rich",
    text: "富文本写入",
    clear: true,
  });
  await check(
    "RICH-RESULT",
    "eval",
    { expr: "document.querySelector('#rich').textContent" },
    { assert: (r) => assert.match(text(r), /富文本写入/) },
  );
  await check("CANVAS-DRAG", "click", {
    x: 40,
    y: 430,
    dragTo: { x: 220, y: 430 },
    real: true,
  });
  await check(
    "CANVAS-RESULT",
    "eval",
    { expr: "document.querySelector('#drag-result').textContent" },
    { assert: (r) => assert.match(text(r), /drag-ended/) },
  );
  await check("DIALOG-OPEN", "eval", {
    expr: "(()=>{document.querySelector('dialog').showModal();return 'opened';})()",
  });
  await check(
    "DIALOG-READ",
    "snapshot",
    {},
    { assert: (r) => assert.match(text(r), /模态内容/) },
  );
  await check("DIALOG-CLOSE", "key", { key: "Escape", real: true });
  const staleSnapshots = [
    await original("snapshot", {}),
    await adapted("snapshot", {}),
  ].map((r) => {
    const line = text(r)
      .split("\n")
      .find((x) => x.includes("旧按钮"));
    return {
      ref: /\b(e\d+)\b/.exec(line)?.[1],
      snapshotId: /\[snapshot (s\d+)\]/.exec(text(r))?.[1],
    };
  });
  assert.ok(staleSnapshots.every((s) => s.ref && s.snapshotId));
  await check("RERENDER", "eval", {
    expr: "(()=>{document.querySelector('#stale').remove();return 'removed';})()",
  });
  await check("STALE-REF", "click", staleSnapshots[1], {
    originalArgs: staleSnapshots[0],
    error: true,
    difference: "各自原快照引用；目标被移除后均拒绝",
  });
  assert.equal(results.filter((r) => r.status === "failed").length, 0);
} finally {
  await mcp?.close().catch(() => {});
  await context?.close().catch(() => {});
  for (const p of procs) p.kill("SIGTERM");
  await Promise.all(
    procs.map((p) =>
      p.exitCode !== null
        ? Promise.resolve()
        : new Promise((r) => {
            p.once("exit", r);
            setTimeout(() => {
              p.kill("SIGKILL");
              r();
            }, 5000).unref();
          }),
    ),
  );
  await core.app.close();
  fixture.close();
  fs.writeFileSync(
    path.join(home, "report.json"),
    JSON.stringify(
      {
        home,
        environment: {
          platform: process.platform,
          arch: process.arch,
          node: process.version,
          playwright: "1.63.0",
        },
        upstream: "1.2.0",
        baselineChanges: [
          "private state path",
          "bridge port",
          "extension discovery port",
        ],
        scope:
          "23工具代表性同输入双实现对照、错误和重连；不代表107参数所有组合已实测",
        results,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      home,
      passed: results.filter((r) => r.status === "passed").length,
      total: results.length,
    }),
  );
}
