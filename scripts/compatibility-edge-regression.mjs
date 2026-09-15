// N06: actual extension debugger contention, CSP and independent sessions.
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import assert from "node:assert/strict";
import sharp from "sharp";
import { chromium } from "playwright";
import { Worker } from "../dist/worker.js";
import { createServer } from "../dist/server.js";
import { BrowserClient } from "../dist/client.js";
const home = fs.mkdtempSync(path.resolve("workspace/compat-edge-")),
  checks = [];
const record = (name, data = {}) => {
  checks.push({ name, status: "passed", ...data });
  fs.writeFileSync(
    path.join(home, "report.json"),
    JSON.stringify(
      {
        home,
        evidenceKind:
          "actual Chromium; synthetic local pages and competing test extension",
        checks,
      },
      null,
      2,
    ),
  );
  console.log("PASS " + name);
};
const wait = async (fn) => {
  const end = Date.now() + 40000;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw Error("condition timeout");
};
const fixture = http.createServer((req, res) => {
  if (req.url === "/script.js") {
    res.setHeader("content-type", "text/javascript");
    return res.end(
      "window.count=0;document.querySelector('button').addEventListener('click',()=>document.querySelector('output').textContent=++window.count)",
    );
  }
  if (req.url.startsWith("/csp"))
    res.setHeader(
      "content-security-policy",
      "default-src 'self'; script-src 'self'; style-src 'unsafe-inline'",
    );
  res.setHeader("content-type", "text/html; charset=utf-8");
  const name = req.url.slice(1) || "A";
  res.end(
    `<title>Session ${name}</title><style>body{background:${name === "A" ? "rgb(240,40,40)" : "rgb(40,180,40)"};height:800px}</style><h1 id="marker">session-only-${name}</h1><input type="password" value="synthetic-password"><button>受控计数</button><output>0</output><script src="/script.js"></script>`,
  );
});
await new Promise((r) => fixture.listen(17994, "127.0.0.1", r));
const origin = "http://127.0.0.1:17994",
  server = await createServer({
    home: path.join(home, "service"),
    port: 17993,
  });
const owner = server.store.createProduct("compat owner", "owner", ["*"]);
await server.listen();
const c = new BrowserClient("http://127.0.0.1:17993", owner.token),
  pair = await c.request("POST", "/v1/admin/workers", {
    name: "compat attach",
  });
const worker = new Worker({
  home: path.join(home, "worker"),
  baseUrl: c.baseUrl,
  workerId: pair.worker.id,
  profileId: pair.profile.id,
  token: pair.token,
  attach: true,
  bridgePort: 18993,
});
let context, blocker;
try {
  await worker.start();
  const extension = path.join(home, "worker/engine/extension"),
    competitor = path.join(home, "competing-extension");
  fs.mkdirSync(competitor);
  fs.writeFileSync(
    path.join(competitor, "manifest.json"),
    JSON.stringify({
      manifest_version: 3,
      name: "P4 debugger contention fixture",
      version: "1.0",
      permissions: ["debugger", "tabs"],
      background: { service_worker: "blocker.js" },
    }),
  );
  fs.writeFileSync(
    path.join(competitor, "blocker.js"),
    "chrome.runtime.onInstalled.addListener(()=>{});console.log('P4 competitor ready');",
  );
  context = await chromium.launchPersistentContext(
    path.join(home, "external-chrome"),
    {
      channel: "chromium",
      headless: true,
      chromiumSandbox: true,
      ignoreDefaultArgs: ["--disable-extensions"],
      args: [
        `--disable-extensions-except=${extension},${competitor}`,
        `--load-extension=${extension},${competitor}`,
      ],
    },
  );
  const setup = await context.newPage();
  await setup.goto("chrome://extensions");
  if (!(await setup.locator("#devMode").evaluate((e) => e.checked)))
    await setup.locator("#devMode").click();
  await setup.close();
  await wait(async () =>
    (await c.capabilities()).profiles.some(
      (p) => p.id === pair.profile.id && p.ready,
    ),
  );
  blocker = await wait(() =>
    context.serviceWorkers().find((w) => w.url().endsWith("/blocker.js")),
  );
  const a = await c.session(pair.profile.id),
    b = await c.session(pair.profile.id);
  let seq = 0;
  const call = async (session, tool, args = {}, key) =>
    c.wait(
      (await c.command(session.id, { tool, args }, key || "edge-" + ++seq)).id,
    );
  const ok = async (session, tool, args) => {
    const job = await call(session, tool, args);
    assert.equal(job.state, "succeeded", JSON.stringify(job));
    return job;
  };
  const text = (job) =>
    (job.result?.content || [])
      .filter((x) => x.type === "text")
      .map((x) => x.text)
      .join("\n");
  await ok(a, "tabs", { action: "new", url: origin + "/A" });
  await ok(b, "tabs", { action: "new", url: origin + "/B" });
  for (const [session, name, other] of [
    [a, "A", "B"],
    [b, "B", "A"],
    [a, "A", "B"],
  ]) {
    const value = text(await ok(session, "read_text", {}));
    assert.match(value, new RegExp("session-only-" + name));
    assert.doesNotMatch(value, new RegExp("session-only-" + other));
  }
  record(
    "two sessions retain distinct default tabs across one shared worker/extension connection",
  );
  for (const [session, name] of [
    [a, "A"],
    [b, "B"],
  ]) {
    const shot = await ok(session, "screenshot", {
      full: true,
      savePath: "screen.png",
    });
    const file = shot.artifacts.find((f) => f.mime === "image/png");
    assert.ok(file);
    const output = path.join(home, name + ".png");
    await c.download(file.id, output);
    const pixel = await sharp(output)
      .extract({ left: 500, top: 400, width: 1, height: 1 })
      .removeAlpha()
      .raw()
      .toBuffer();
    assert.deepEqual([...pixel], name === "A" ? [240, 40, 40] : [40, 180, 40]);
  }
  record(
    "screenshots capture each requested session, including a background tab, without capturing the peer page",
  );
  const cs = await c.session(pair.profile.id);
  await ok(cs, "tabs", { action: "new", url: origin + "/csp" });
  const tabId = await blocker.evaluate(async (url) => {
    const [tab] = await chrome.tabs.query({ url });
    await chrome.debugger.attach({ tabId: tab.id }, "1.3");
    return tab.id;
  }, origin + "/csp");
  assert.ok(tabId);
  const page = context.pages().find((p) => p.url() === origin + "/csp");
  assert.ok(page);
  const concurrent = await ok(cs, "click", { selector: "button", real: true });
  assert.equal(await page.locator("output").textContent(), "1");
  assert.match(text(await ok(cs, "eval", { expr: "40+2" })), /42/);
  assert.equal(
    await blocker.evaluate(async (id) => {
      await chrome.debugger.sendCommand({ tabId: id }, "Runtime.evaluate", {
        expression: "1",
      });
      return true;
    }, tabId),
    true,
  );
  record(
    "current Chromium permits another debugger concurrently; click executes once and the other debugger remains usable",
  );
  await blocker.evaluate(
    async (id) => chrome.debugger.detach({ tabId: id }),
    tabId,
  );
  assert.equal((await c.job(concurrent.id)).state, "succeeded");
  const adapter = context
    .serviceWorkers()
    .find((w) => w.url().endsWith("/background.js"));
  assert.ok(adapter);
  await adapter.evaluate(() => chrome.storage.local.set({ l2Disabled: true }));
  const limited = await c.session(pair.profile.id);
  await ok(limited, "tabs", { action: "new", url: origin + "/csp-disabled" });
  const limitedPage = context
    .pages()
    .find((p) => p.url() === origin + "/csp-disabled");
  assert.ok(limitedPage);
  const blockedClick = await call(
    limited,
    "click",
    { selector: "button", real: true },
    "disabled-click",
  );
  assert.equal(blockedClick.state, "failed");
  assert.match(JSON.stringify(blockedClick.result), /NEEDS_L2/);
  const blockedEval = await call(
    limited,
    "eval",
    { expr: "document.querySelector('button').click()" },
    "disabled-csp-eval",
  );
  assert.equal(blockedEval.state, "failed");
  assert.match(JSON.stringify(blockedEval.result), /NEEDS_L2/);
  assert.equal(await limitedPage.locator("output").textContent(), "0");
  record(
    "disabled high-fidelity mode refuses real click and CSP evaluation without falling back or producing side effects",
  );
  await adapter.evaluate(() => chrome.storage.local.set({ l2Disabled: false }));
  assert.equal(
    (
      await call(
        limited,
        "click",
        { selector: "button", real: true },
        "disabled-click",
      )
    ).id,
    blockedClick.id,
  );
  assert.equal(await limitedPage.locator("output").textContent(), "0");
  assert.match(text(await ok(limited, "eval", { expr: "40+2" })), /42/);
  record(
    "explicitly enabling high-fidelity mode permits a new CSP read; failed idempotency key is never replayed",
  );
  await worker.stop();
  assert.equal(page.isClosed(), false);
  record("stopping attached worker preserves the externally started browser");
} finally {
  await worker.stop();
  await context?.close();
  await server.app.close();
  await new Promise((r) => fixture.close(r));
}
console.log(JSON.stringify({ home, passed: checks.length }));
