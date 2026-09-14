import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import sharp from "sharp";
import { createServer } from "../dist/server.js";
import { BrowserClient } from "../dist/client.js";
const root = path.resolve("."),
  home = fs.mkdtempSync(path.join(root, "workspace/tools-"));
const base = "http://127.0.0.1:17922";
const png = await sharp({
  create: { width: 80, height: 50, channels: 3, background: "#176d80" },
})
  .png()
  .toBuffer();
let submissions = 0;
const html = `<!doctype html><meta charset="utf-8"><title>laofu 工具对照站</title><style>body{font:16px system-ui;padding:25px}input,select,button{margin:10px;padding:8px}article{max-width:700px}#bottom{margin-top:1200px}</style><article><h1>工具测试文章</h1><p>正文段落与代码、表格、图片测试。</p><label>标题<input id="title" value="原值"></label><label>类别<select id="category"><option value="a">甲</option><option value="b">乙</option></select></label><label><input id="check" type="checkbox">同意</label><button id="inc" onclick="window.count++;document.querySelector('#count').textContent=window.count;this.textContent='增加计数 '+window.count">增加计数</button><output id="count">0</output><form onsubmit="event.preventDefault();fetch('/submit',{method:'POST'})"><button type="submit" id="submit">提交测试</button></form><input id="file" type="file"><div id="drop" ondragover="event.preventDefault()" ondrop="event.preventDefault();this.textContent=event.dataTransfer.files[0].name" style="height:80px;border:1px dashed;padding:20px">拖放文件</div><div contenteditable="true" id="editor">富文本</div><img src="/image.png"><pre><code>const answer = 42;</code></pre><table><tr><th>名称</th><th>值</th></tr><tr><td>项目</td><td>23</td></tr></table><iframe src="/frame" title="同源子页"></iframe><iframe src="http://localhost:17922/frame" title="跨源子页"></iframe><div id="shadow"></div><p id="bottom">页面底部</p></article><script>window.count=0;document.querySelector('#shadow').attachShadow({mode:'open'}).innerHTML='<button id="shadow-button">影子按钮</button>';fetch('/api?page=1');</script>`;
const fixture = http.createServer((req, res) => {
  const url = new URL(req.url, base);
  if (url.pathname === "/submit") {
    submissions++;
    res.end("ok");
    return;
  }
  if (url.pathname === "/image.png") {
    res.setHeader("content-type", "image/png");
    res.end(png);
    return;
  }
  if (url.pathname === "/file") {
    res.setHeader("content-type", "application/octet-stream");
    res.setHeader("Content-Disposition", 'attachment; filename="fixture.bin"');
    res.end(Buffer.alloc(5 * 1024 ** 2, 42));
    return;
  }
  if (url.pathname === "/api") {
    res.setHeader("content-type", "application/json");
    const p = Number(url.searchParams.get("page") || 1);
    res.end(
      JSON.stringify({
        items: p <= 3 ? [{ page: p }] : [],
        next: p < 3 ? p + 1 : null,
      }),
    );
    return;
  }
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.end(
    url.pathname === "/frame"
      ? "<button onclick=\"this.textContent='子页已点击'\">子页按钮</button>"
      : html,
  );
});
await new Promise((r) => fixture.listen(17922, "0.0.0.0", r));
const server = await createServer({ home, port: 17921 });
const owner = server.store.createProduct("工具回归", "owner", ["*"]);
await server.listen();
const c = new BrowserClient("http://127.0.0.1:17921", owner.token);
let worker;
const results = [];
async function check(label, fn) {
  try {
    await fn();
    results.push({ label, status: "passed" });
    console.log("PASS " + label);
  } catch (e) {
    results.push({ label, status: "failed", error: String(e) });
    console.log("FAIL " + label + " " + e.message);
  }
  fs.writeFileSync(
    path.join(home, "report.json"),
    JSON.stringify(
      {
        environment: {
          platform: process.platform,
          arch: process.arch,
          node: process.version,
          upstream: "1.2.0",
          playwright: "1.63.0",
        },
        results,
      },
      null,
      2,
    ),
  );
}
try {
  const pair = await c.request("POST", "/v1/admin/workers", {
    name: "工具回归",
  });
  const config = {
    home: path.join(home, "worker"),
    baseUrl: c.baseUrl,
    workerId: pair.worker.id,
    profileId: pair.profile.id,
    token: pair.token,
    headless: true,
    bridgePort: 18921,
  };
  fs.writeFileSync(path.join(home, "worker.json"), JSON.stringify(config), {
    mode: 0o600,
  });
  const fd = fs.openSync(path.join(home, "worker.log"), "a");
  worker = spawn(
    process.execPath,
    ["dist/cli.js", "worker", "--config", path.join(home, "worker.json")],
    { stdio: ["ignore", fd, fd], env: { ...process.env, LAOFU_DEBUG: "1" } },
  );
  fs.closeSync(fd);
  for (let i = 0; i < 120; i++) {
    if ((await c.capabilities()).profiles.some((p) => p.ready)) break;
    if (worker.exitCode !== null) throw new Error("worker exited");
    await new Promise((r) => setTimeout(r, 500));
  }
  const session = await c.session(pair.profile.id);
  let serial = 0;
  async function call(tool, args = {}, inputArtifacts = {}) {
    const accepted = await c.command(
      session.id,
      { tool, args, inputArtifacts },
      "test-" + ++serial,
    );
    let result = await c.wait(accepted.id);
    if (tool === "ask") {
      const end = Date.now() + 15000;
      while (result.state === "waiting_user" && Date.now() < end) {
        await new Promise((r) => setTimeout(r, 250));
        result = await c.job(accepted.id);
      }
    }
    fs.writeFileSync(
      path.join(home, `${serial}-${tool}.json`),
      JSON.stringify(result, null, 2),
    );
    if (result.state !== "succeeded")
      throw new Error(
        tool + ": " + JSON.stringify(result.error || result.result),
      );
    return result.result;
  }
  const text = (r) =>
    r.content
      ?.filter((x) => x.text)
      .map((x) => x.text)
      .join("\n") || "";
  await check("B10 tabs/new", () =>
    call("tabs", { action: "new", url: base, label: "完整工具回归" }),
  );
  await check("B02 navigate", () => call("navigate", { url: base }));
  await check("B01 snapshot + DOM/iframe", async () => {
    const r = text(await call("snapshot"));
    assert.match(r, /标题/);
    assert.match(r, /@f\d+/);
    assert.match(r, /影子按钮/);
  });
  await check("B04 type + clear + expect", async () => {
    await call("type", {
      selector: "#title",
      text: "新标题",
      clear: true,
      expect: { value: "新标题" },
    });
    assert.match(
      text(
        await call("eval", { expr: "document.querySelector('#title').value" }),
      ),
      /新标题/,
    );
  });
  await check("B05 select", async () => {
    await call("select", { find: { selector: "#category" }, value: "b" });
    assert.match(
      text(
        await call("eval", {
          expr: "document.querySelector('#category').value",
        }),
      ),
      /b/,
    );
  });
  await check("B03 click + real + expect", async () => {
    await call("click", {
      selector: "#inc",
      real: true,
      expect: { appears: "1" },
    });
    assert.match(text(await call("eval", { expr: "window.count" })), /1/);
  });
  await check("B06 fill stateful refs", async () => {
    const snap = text(await call("snapshot"));
    const sid = /\[snapshot (s\d+)\]/.exec(snap)?.[1];
    const title = snap
      .split("\n")
      .find((l) => l.includes("标题") && /e\d+/.test(l));
    const ref = /\b(e\d+)\b/.exec(title || "")?.[1];
    assert.ok(
      ref && sid,
      "ref and snapshotId must come from the actual snapshot",
    );
    await call("fill", {
      snapshotId: sid,
      fields: [{ ref, text: "批量填写" }],
    });
    assert.match(
      text(
        await call("eval", { expr: "document.querySelector('#title').value" }),
      ),
      /批量填写/,
    );
  });
  await check("B07 key sequence", () =>
    call("key", { key: ["Tab", "Tab", "Escape"], real: true }),
  );
  await check("B08 read_text formats", async () => {
    assert.match(
      text(await call("read_text", { format: "markdown" })),
      /answer/,
    );
    assert.match(text(await call("read_text", { format: "text" })), /正文段落/);
  });
  await check("B09 screenshot JPEG/PNG + artifact", async () => {
    const jpeg = await call("screenshot");
    assert.equal(jpeg.content[0].mimeType, "image/jpeg");
    const png = await call("screenshot", {
      full: true,
      savePath: "screen.png",
    });
    assert.equal(png.artifacts[0].mime, "image/png");
  });
  await check("B11 wait selector/text/idle", async () => {
    for (const args of [
      { for: "selector", value: "#title" },
      { for: "text", value: "工具测试文章" },
      { for: "idle" },
    ])
      await call("wait", { ...args, timeout: 5000 });
  });
  await check("B12 network capture + response", async () => {
    await call("network", { reload: true, match: "/api" });
    assert.match(
      text(await call("network", { body: "/api", maxBody: 20000 })),
      /page/,
    );
  });
  await check("B13 fetch pagination + binary", async () => {
    const r = await call("fetch", {
      url: base + "/api",
      pages: { param: "page", from: 1, max: 3 },
      savePath: "pages.jsonl",
    });
    assert.ok(r.artifacts.length);
    const a = await c.request("GET", "/v1/artifacts/" + r.artifacts[0].id);
    assert.ok(a.bytes > 50);
    const b = await call("fetch", {
      url: base + "/image.png",
      binary: true,
      savePath: "fetched.png",
    });
    assert.equal(
      b.artifacts[0].sha256,
      await sharp(png)
        .toBuffer()
        .then((v) =>
          import("node:crypto").then((m) =>
            m.createHash("sha256").update(v).digest("hex"),
          ),
        ),
    );
  });
  await check("B14 scroll", async () => {
    await call("scroll", { to: "bottom", times: 1, wait: 50 });
    assert.match(text(await call("eval", { expr: "scrollY>0" })), /true/);
    await call("scroll", { to: "top" });
  });
  await check("B15 download 5 MiB artifact", async () => {
    const r = await call("download", {
      url: base + "/file",
      savePath: "download.bin",
      timeout: 120000,
    });
    assert.equal(r.artifacts[0].bytes, 5 * 1024 ** 2);
  });
  await check("B16 upload file input and drop", async () => {
    const file = path.join(home, "upload.txt");
    fs.writeFileSync(file, "SDK upload file");
    const a = await c.upload(file);
    await call(
      "upload",
      { path: "upload.txt", selector: "#file" },
      { path: a.id },
    );
    assert.match(
      text(
        await call("eval", {
          expr: "document.querySelector('#file').files[0].name",
        }),
      ),
      /upload.txt/,
    );
    await call(
      "upload",
      { path: "upload.txt", dropSelector: "#drop" },
      { path: a.id },
    );
    assert.match(
      text(
        await call("eval", {
          expr: "document.querySelector('#drop').textContent",
        }),
      ),
      /upload.txt/,
    );
  });
  await check("B17 query extracted table", async () => {
    const r = await call("query", {
      selector: "table tr",
      extract: { name: "td:first-child", value: "td:last-child" },
      limit: 10,
    });
    assert.match(text(r), /23/);
  });
  await check("B18 act repeat/if/assert", async () => {
    await call("act", {
      steps: [
        { do: "type", selector: "#title", text: "批处理" },
        { do: "repeat", max: 2, steps: [{ do: "click", selector: "#inc" }] },
        {
          do: "if",
          cond: { selectorExists: "#title" },
          then: [{ do: "read", selector: "#title", attr: "value" }],
        },
        { do: "assert", cond: { selectorExists: "#inc" } },
      ],
    });
    assert.match(
      text(await call("eval", { expr: "window.count===2" })),
      /true/,
    );
  });
  await check("B19 ask completion predicate", () =>
    call("ask", {
      prompt: "测试页存在标题输入时继续",
      until: { selectorExists: "#title" },
      timeout: 5000,
      focus: false,
    }),
  );
  await check("B20 status", () => call("status", { text: "工具回归完成" }));
  await check("B21 eval async", async () => {
    assert.match(
      text(await call("eval", { expr: "Promise.resolve({value:42})" })),
      /42/,
    );
  });
  await check("B22 learnings versioned save/read", async () => {
    await call("learnings", { domain: "example.com", save: "测试站经验" });
    assert.match(
      text(await call("learnings", { domain: "example.com" })),
      /测试站经验/,
    );
    assert.equal(
      (await c.request("GET", "/v1/learnings?domain=example.com")).version,
      1,
    );
  });
  await check("B23 reload extension reconnect", async () => {
    await call("reload");
    await new Promise((r) => setTimeout(r, 3000));
    await call("status", { text: "重连完成" });
  });
  console.log(
    JSON.stringify({
      home,
      passed: results.filter((r) => r.status === "passed").length,
      total: results.length,
      submissions,
    }),
  );
  if (results.some((r) => r.status === "failed")) process.exitCode = 1;
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
