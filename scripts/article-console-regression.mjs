import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import sharp from "sharp";
import { spawn } from "node:child_process";
import { chromium } from "playwright";
import { createServer } from "../dist/server.js";
import { BrowserClient } from "../dist/client.js";
const root = path.resolve("."),
  home = fs.mkdtempSync(path.join(root, "workspace/article-console-"));
const historical =
  process.env.LAOFU_WECHAT_FIXTURE || path.join(home, "synthetic-fixture");
const fixtureKind = process.env.LAOFU_WECHAT_FIXTURE
  ? "historical-offline-replay"
  : "synthetic-browser-fixture";
if (!process.env.LAOFU_WECHAT_FIXTURE) {
  fs.mkdirSync(path.join(historical, "images"), { recursive: true });
  const paragraphs = Array.from(
    { length: 11 },
    (_, i) =>
      `自建样本段落 ${i + 1}：` + "检查段落、标点和图片的顺序。".repeat(35),
  );
  fs.writeFileSync(
    path.join(historical, "article.json"),
    JSON.stringify({
      title: "自建图文回归样本",
      account: "测试作者",
      published: "2026-09-14",
      body: paragraphs.join("\n"),
    }),
  );
  fs.writeFileSync(
    path.join(historical, "image-text.json"),
    JSON.stringify(
      paragraphs
        .map((text, i) => text + `\n\n![图 ${i + 1}](fixture)`)
        .join("\n\n"),
    ),
  );
  for (let i = 1; i <= 11; i++)
    await sharp({
      create: {
        width: 320,
        height: 180,
        channels: 3,
        background: { r: i * 20, g: 120, b: 200 },
      },
    })
      .jpeg()
      .toFile(
        path.join(historical, `images/image-${String(i).padStart(2, "0")}.jpg`),
      );
}
const article = JSON.parse(
  fs.readFileSync(path.join(historical, "article.json")),
);
const imageText = JSON.parse(
  fs.readFileSync(path.join(historical, "image-text.json")),
);
const esc = (s) =>
  s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
let imgIndex = 0;
const body = imageText
  .split(/\n\s*\n/)
  .filter((x) => x.trim())
  .map((p) =>
    /^!\[/.test(p.trim())
      ? `<img data-src="/images/image-${String(++imgIndex).padStart(2, "0")}.jpg" alt="原文配图">`
      : `<p>${esc(p)}</p>`,
  )
  .join("\n");
assert.equal(imgIndex, 11);
console.log("Historical fixture prepared");
const longText = Array.from(
  { length: 180 },
  (_, i) =>
    `<p>长文段落${i}：${"真实浏览器分块传输应保留全部文字、顺序与标点。".repeat(12)}</p>`,
).join("");
const raw = Buffer.alloc(2200 * 2100 * 3);
let seed = 7;
for (let i = 0; i < raw.length; i++) {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  raw[i] = seed >>> 24;
}
const largeImage = await sharp(raw, {
  raw: { width: 2200, height: 2100, channels: 3 },
})
  .png({ compressionLevel: 0 })
  .toBuffer();
assert.ok(largeImage.length > 12 * 1024 ** 2);
let imageRequests = 0;
const fixture = http.createServer((req, res) => {
  const u = new URL(req.url, "http://127.0.0.1:17962");
  if (/^\/images\/image-\d\d\.jpg$/.test(u.pathname)) {
    imageRequests++;
    res.setHeader("content-type", "image/jpeg");
    res.end(fs.readFileSync(path.join(historical, u.pathname.slice(1))));
    return;
  }
  if (u.pathname === "/large-image.png") {
    res.setHeader("content-type", "image/png");
    res.end(largeImage);
    return;
  }
  if (u.pathname === "/bad.png") {
    imageRequests++;
    res.end("invalid");
    return;
  }
  if (u.pathname === "/denied") {
    res.statusCode = 403;
    res.end("NETWORK_DENIED");
    return;
  }
  if (u.pathname === "/limited") {
    res.statusCode = 429;
    res.end("<title>操作过于频繁</title>访问频率限制");
    return;
  }
  res.setHeader("content-type", "text/html; charset=utf-8");
  if (u.pathname === "/history")
    res.end(
      `<title>${esc(article.title)}</title><h1 id="activity-name">${esc(article.title)}</h1><span id="js_name">${esc(article.account)}</span><span id="publish_time">${esc(article.published)}</span><article id="js_content">${body}</article>`,
    );
  else if (u.pathname === "/large")
    res.end(
      "<title>大图</title><article><p>" +
        "有界原生下载测试正文。".repeat(30) +
        '</p><img data-src="/large-image.png"></article>',
    );
  else if (u.pathname === "/broken")
    res.end(
      `<title>缺图</title><article>${longText.slice(0, 5000)}<img src="/bad.png"></article>`,
    );
  else if (u.pathname === "/changing")
    res.end(
      `<title>变化文章</title><article>${longText}<span id="changing"></span></article><script>setInterval(()=>document.querySelector('#changing').textContent=Date.now(),20)</script>`,
    );
  else
    res.end(
      `<title>长正文完整性</title><article>${longText}<pre><code>  x = 1\n  y = 2</code></pre><table><tr><th>项目</th><th>值</th></tr><tr><td>样本</td><td>180</td></tr></table><a href="/next">下一页</a><script>window.evil=1</script><img src="/images/image-01.jpg" onerror="alert(1)"><p>结束标记 END-180</p></article>`,
    );
});
await new Promise((r) => fixture.listen(17962, "127.0.0.1", r));
const server = await createServer({ home, port: 17961 }),
  owner = server.store.createProduct("本机验收", "owner", ["*"]);
await server.listen();
const c = new BrowserClient("http://127.0.0.1:17961", owner.token),
  results = [];
let worker, browser;
const wait = async (fn, ms = 90000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error("condition timed out");
};
try {
  const pair = await c.request("POST", "/v1/admin/workers", {
    name: "图文验收浏览器",
  });
  const cfg = {
    home: path.join(home, "worker"),
    baseUrl: c.baseUrl,
    workerId: pair.worker.id,
    profileId: pair.profile.id,
    token: pair.token,
    headless: true,
    bridgePort: 18961,
  };
  fs.writeFileSync(path.join(home, "worker.json"), JSON.stringify(cfg), {
    mode: 0o600,
  });
  const log = fs.openSync(path.join(home, "worker.log"), "a");
  worker = spawn(
    process.execPath,
    ["dist/cli.js", "worker", "--config", path.join(home, "worker.json")],
    { stdio: ["ignore", log, log] },
  );
  fs.closeSync(log);
  await wait(async () =>
    (await c.capabilities()).profiles.some((p) => p.ready),
  );
  const capture = async (suffix, key) => {
    const j = await c.submitTask(
      {
        type: "article.capture@v1",
        execution: { profileId: pair.profile.id },
        input: { url: "http://127.0.0.1:17962" + suffix },
      },
      key,
    );
    return c.wait(j.id);
  };
  const historic = await capture("/history", "history");
  assert.equal(historic.state, "succeeded", JSON.stringify(historic.error));
  assert.equal(historic.result.manifest.mediaCoverage.downloadedImages, 11);
  const md = historic.result.artifacts.find((a) => a.filename === "article.md");
  await c.download(md.id, path.join(home, "historical.md"));
  const markdown = fs.readFileSync(path.join(home, "historical.md"), "utf8");
  const compact = (s) => s.replace(/[\s\\*_`#]/g, "");
  const missing = article.body
    .split("\n")
    .filter((x) => x.trim())
    .filter((line) => !compact(markdown).includes(compact(line)));
  assert.deepEqual(missing, [], "all historic nonempty DOM lines must remain");
  for (let i = 1; i <= 11; i++) {
    const out = historic.result.manifest.images[i - 1];
    assert.equal(out.index, i);
    assert.equal(
      out.sha256,
      crypto
        .createHash("sha256")
        .update(
          fs.readFileSync(
            path.join(
              historical,
              `images/image-${String(i).padStart(2, "0")}.jpg`,
            ),
          ),
        )
        .digest("hex"),
    );
  }
  results.push({
    case: `${fixtureKind}: 11 image hashes and ordered DOM lines`,
    passed: true,
    jobId: historic.id,
    evidenceKind: fixtureKind,
  });
  console.log("Historical 11-image replay passed");
  browser = await chromium.launch({ channel: "chromium", headless: true });
  const context = await browser.newContext({
    locale: "zh-CN",
    viewport: { width: 1440, height: 1100 },
    acceptDownloads: true,
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const ticket = server.store.credential("bootstrap", owner.product.id, 600000);
  await page.goto(c.baseUrl + "/#bootstrap=" + ticket);
  await page.getByLabel("文章链接").waitFor();
  assert.equal(new URL(page.url()).hash, "");
  await page.getByLabel("文章链接").fill("http://127.0.0.1:17962/long");
  await page.getByRole("button", { name: "采集图文", exact: true }).click();
  let long;
  await wait(async () => {
    long = (await c.request("GET", "/v1/tasks")).items.find((j) =>
      j.input.url.endsWith("/long"),
    );
    return long && ["succeeded", "failed", "partial"].includes(long.state);
  });
  assert.equal(long.state, "succeeded", JSON.stringify(long.error));
  const longMd = long.result.artifacts.find((a) => a.filename === "article.md");
  await c.download(longMd.id, path.join(home, "long.md"));
  const longBody = fs.readFileSync(path.join(home, "long.md"), "utf8");
  for (let i = 0; i < 180; i++)
    assert.ok(longBody.includes("长文段落" + i + "："));
  assert.ok(longBody.includes("END-180"));
  assert.match(longBody, /  x = 1\n  y = 2/);
  assert.match(longBody, /\| 项目 \| 值 \|/);
  assert.match(longBody, /http:\/\/127.0.0.1:17962\/next/);
  await page
    .getByRole("heading", { name: "长正文完整性", exact: true })
    .waitFor();
  await page.screenshot({
    path: path.join(home, "console-tasks.png"),
    fullPage: true,
  });
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: /article-with-images.zip/ }).click();
  const downloaded = await downloadPromise;
  await downloaded.saveAs(path.join(home, "ui-package.zip"));
  assert.ok(fs.statSync(path.join(home, "ui-package.zip")).size > 1000);
  console.log("UI capture and ZIP download passed");
  await page.getByRole("button", { name: /图文产物/ }).click();
  await page.getByRole("button", { name: "预览", exact: true }).first().click();
  const frame = page.frameLocator('iframe[title="安全图文预览"]');
  await frame.locator("img").first().waitFor();
  await wait(
    async () =>
      await frame
        .locator("img")
        .evaluateAll((xs) => xs.every((x) => x.complete && x.naturalWidth > 0)),
  );
  assert.equal(await frame.locator("script").count(), 0);
  await page.getByRole("button", { name: "关闭预览" }).click();
  for (const zone of ["浏览器与设备", "产品凭据", "诊断与经验", "任务"]) {
    await page
      .getByRole("button", { name: new RegExp(zone) })
      .first()
      .click();
    await page
      .getByRole("heading", { name: zone, exact: true, level: 1 })
      .waitFor();
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: path.join(home, "console-mobile.png"),
    fullPage: true,
  });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
    "mobile document must not overflow",
  );
  assert.deepEqual(errors, []);
  results.push({
    case: "web console submits long capture, all 180 paragraphs/code/table/link retained, downloads ZIP, safe image preview, five zones and mobile layout",
    passed: true,
    jobId: long.id,
  });
  const big = await capture("/large", "large");
  assert.equal(
    big.state,
    "succeeded",
    JSON.stringify(big.error || big.result?.manifest),
  );
  assert.equal(
    big.result.manifest.images[0].sha256,
    crypto.createHash("sha256").update(largeImage).digest("hex"),
  );
  results.push({
    case: "image larger than 12 MiB uses native bounded download and retains original hash",
    passed: true,
    jobId: big.id,
  });
  const budget = await c.submitTask(
    {
      type: "article.capture@v1",
      execution: { profileId: pair.profile.id },
      input: { url: "http://127.0.0.1:17962/long" },
      limits: { maxBytes: 1024 },
    },
    "small-budget",
  );
  const limited = await c.wait(budget.id);
  assert.equal(limited.state, "failed");
  assert.equal(limited.error.code, "LIMIT_EXCEEDED");
  const partial = await capture("/broken", "broken");
  assert.equal(partial.state, "partial");
  assert.equal(partial.result.manifest.mediaCoverage.failedImages, 1);
  results.push({ case: "corrupt image reports partial", passed: true });
  const changed = await capture("/changing", "changing");
  assert.equal(changed.state, "partial");
  assert.equal(changed.result.manifest.versionConsistent, false);
  results.push({
    case: "DOM changes during transfer report unknown coverage",
    passed: true,
  });
  for (const [route, error] of [
    ["/denied", "ACCESS_BLOCKED"],
    ["/limited", "RATE_LIMITED"],
  ]) {
    const j = await capture(route, route);
    assert.equal(j.state, "failed");
    assert.equal(j.error.code, error);
    assert.equal(j.result, null);
    results.push({ case: route + " is never an article", passed: true });
  }
  const uploadFile = path.join(home, "hostile.html");
  fs.writeFileSync(uploadFile, '<script>fetch("/v1/admin/products")</script>');
  const a = await c.upload(uploadFile);
  await assert.rejects(c.request("GET", `/v1/artifacts/${a.id}/preview`));
  fs.writeFileSync(
    path.join(home, "report.json"),
    JSON.stringify({ home, results, imageRequests }, null, 2),
  );
  console.log(JSON.stringify({ home, results }));
} finally {
  await browser?.close();
  if (worker) {
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
