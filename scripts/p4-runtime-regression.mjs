import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "../dist/server.js";
import { Worker } from "../dist/worker.js";
import { BrowserClient } from "../dist/client.js";

const home = fs.mkdtempSync(path.resolve("workspace/p4-runtime-")),
  checks = [];
const record = (name, evidence = {}) => {
  checks.push({ name, status: "passed", ...evidence });
  fs.writeFileSync(
    path.join(home, "report.json"),
    JSON.stringify(
      {
        home,
        evidenceKind:
          "synthetic fixtures through real Chromium, engine and HTTP",
        checks,
      },
      null,
      2,
    ),
  );
  console.log("PASS " + name);
};
let rateHits = 0;
const fixture = http.createServer((req, res) => {
  const pathname = new URL(req.url, "http://fixture").pathname;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  if (pathname === "/rate") {
    rateHits++;
    res.writeHead(429, { "Retry-After": "120" });
    return res.end("<title>操作过于频繁</title>too many requests");
  }
  const account = pathname === "/wrong" ? "Bob" : "Alice";
  const body = `<span id="account">${account}</span><article><h1>P4 当前正文</h1><p>${"可验证正文及账号范围。".repeat(30)}</p></article>`;
  if (pathname === "/late")
    return res.end(
      `<title>延迟正文</title><article>加载中</article><script>setTimeout(()=>document.body.innerHTML=${JSON.stringify(body)},700)</script>`,
    );
  res.end(
    `<title>P4 运行样本</title>${body}<button id="switch" onclick="document.querySelector('#account').textContent='Alice'">切换为已授权测试账号</button>`,
  );
});
await new Promise((resolve) => fixture.listen(17982, "127.0.0.1", resolve));
const origin = "http://127.0.0.1:17982";
let server = await createServer({
    home: path.join(home, "service"),
    port: 17981,
  }),
  worker;
const owner = server.store.createProduct("P4 runtime owner", "owner", ["*"]);
await server.listen();
let c = new BrowserClient("http://127.0.0.1:17981", owner.token);
const wait = async (fn) => {
  for (let i = 0; i < 400; i++) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw Error("condition timeout");
};
try {
  const pair = await c.request("POST", "/v1/admin/workers", {
    name: "P4 runtime browser",
  });
  worker = new Worker({
    home: path.join(home, "worker"),
    baseUrl: c.baseUrl,
    profileId: pair.profile.id,
    workerId: pair.worker.id,
    token: pair.token,
    headless: true,
    bridgePort: 18981,
  });
  await worker.start();
  await wait(async () =>
    (await c.capabilities()).profiles.some((p) => p.ready),
  );
  const context = worker.browser.context;
  const existing = await context.newPage();
  await existing.goto(origin + "/existing");
  const before = context.pages().map((p) => p.url());
  const submit = (route, key, limits) =>
    c.submitTask(
      {
        type: "article.capture@v1",
        execution: { profileId: pair.profile.id },
        input: { url: origin + route },
        ...(limits ? { limits } : {}),
      },
      key,
    );
  const doctor = (args) =>
    new Promise((resolve, reject) => {
      const p = spawn(
        process.execPath,
        [
          "dist/cli.js",
          "doctor",
          "--home",
          path.join(home, "service"),
          "--url",
          c.baseUrl,
          ...args,
        ],
        {
          env: { ...process.env, LAOFU_TOKEN: owner.token },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      let out = "",
        err = "";
      p.stdout.on("data", (b) => (out += b));
      p.stderr.on("data", (b) => (err += b));
      p.once("error", reject);
      p.once("exit", (code) =>
        code ? reject(Error(err)) : resolve(JSON.parse(out)),
      );
    });
  assert.equal((await doctor([])).targetSiteAccess.status, "not_checked");
  const diagnosis = await doctor([
    "--site",
    origin + "/normal",
    "--profile",
    pair.profile.id,
  ]);
  assert.equal(diagnosis.targetSiteAccess.status, "succeeded");
  assert.equal(diagnosis.packages.matchesService, true);
  record(
    "doctor leaves site unchecked by default and performs an explicit bounded browser diagnosis",
  );
  for (let i = 0; i < 30; i++) {
    const job = await c.wait(
      (await submit(i === 0 ? "/late" : "/normal", "capture-" + i)).id,
    );
    assert.equal(job.state, "succeeded", JSON.stringify(job.error));
    assert.equal(job.result.captureTab.closed, true);
    if (i === 0) {
      const file = job.artifacts.find((a) => a.filename === "article.md");
      const text = await fetch(c.baseUrl + `/v1/artifacts/${file.id}/content`, {
        headers: { authorization: "Bearer " + c.token },
      }).then((r) => r.text());
      assert.match(text, /可验证正文/);
      assert.doesNotMatch(text, /加载中/);
    }
  }
  assert.deepEqual(
    context.pages().map((p) => p.url()),
    before,
  );
  record(
    "30 captures return owned tab count to baseline and preserve pre-existing page",
    { before: before.length, after: context.pages().length },
  );
  const tabLimit = await c.wait(
    (await submit("/normal", "tab-limit", { maxTabs: before.length })).id,
  );
  assert.equal(tabLimit.error.code, "TAB_LIMIT");
  assert.deepEqual(
    context.pages().map((p) => p.url()),
    before,
  );
  record("tab budget refuses new page without closing other pages");
  await c.request(
    "PUT",
    `/v1/admin/profiles/${pair.profile.id}/account-policy`,
    {
      mode: "required",
      origins: [origin],
      selector: "#account",
      expectedHash: crypto.createHash("sha256").update("Alice").digest("hex"),
    },
  );
  const matched = await c.wait((await submit("/normal", "account-matched")).id);
  assert.equal(matched.state, "succeeded");
  assert.equal(matched.result.manifest.account.status, "matched");
  const wrong = await c.wait((await submit("/wrong", "account-wrong")).id);
  assert.equal(wrong.state, "waiting_user");
  assert.equal(wrong.result.handoff.reason, "account_mismatched");
  assert.equal(wrong.artifacts.length, 0);
  const pendingPage = context.pages().find((p) => p.url().endsWith("/wrong"));
  await pendingPage.locator("#switch").click();
  await c.resume(wrong.id);
  const resumed = await c.wait(wrong.id);
  assert.equal(resumed.state, "succeeded");
  assert.equal(resumed.id, wrong.id);
  record(
    "required account matched, mismatch pauses without artifacts, explicit user action and resume reverify",
  );
  const eventResponse = await fetch(
    c.baseUrl + `/v1/tasks/${resumed.id}/events`,
    {
      headers: { authorization: "Bearer " + c.token, "last-event-id": "0" },
      signal: AbortSignal.timeout(3000),
    },
  );
  const reader = eventResponse.body.getReader();
  const firstEvent = await reader.read();
  await reader.cancel();
  const eventsText = Buffer.from(firstEvent.value).toString(),
    cursor = Number(/^id: (\d+)/m.exec(eventsText)?.[1]);
  assert.ok(cursor);
  const continuation = await fetch(
    c.baseUrl + `/v1/tasks/${resumed.id}/events`,
    {
      headers: {
        authorization: "Bearer " + c.token,
        "last-event-id": String(cursor),
      },
      signal: AbortSignal.timeout(3000),
    },
  );
  const nextReader = continuation.body.getReader(),
    next = await nextReader.read();
  await nextReader.cancel();
  const ids = [
    ...Buffer.from(next.value)
      .toString()
      .matchAll(/^id: (\d+)/gm),
  ].map((m) => Number(m[1]));
  assert.ok(ids.length && ids.every((id) => id > cursor));
  const streamToken = server.store.credential("product", owner.product.id);
  const revokedResponse = await fetch(
    c.baseUrl + `/v1/tasks/${resumed.id}/events`,
    {
      headers: { authorization: "Bearer " + streamToken },
      signal: AbortSignal.timeout(3000),
    },
  );
  const revokedReader = revokedResponse.body.getReader();
  await revokedReader.read();
  assert.equal(
    server.store.consumeCredential(streamToken, "product", owner.product.id),
    true,
  );
  assert.equal((await revokedReader.read()).done, true);
  record(
    "real SSE resumes after the saved cursor and ends an open stream when its credential is revoked",
  );
  const large = path.join(home, "large.bin");
  fs.writeFileSync(large, Buffer.alloc(32 * 1024 ** 2, 7));
  const file = await c.upload(large);
  const transfer = await new Promise((resolve, reject) => {
    const req = http.get(
      c.baseUrl + `/v1/artifacts/${file.id}/content`,
      { headers: { authorization: "Bearer " + c.token } },
      (res) => {
        res.once("data", () => {
          res.pause();
          resolve(res);
        });
      },
    );
    req.on("error", reject);
  });
  const ended = new Promise((resolve) => {
    transfer.once("aborted", () => resolve("aborted"));
    transfer.once("error", () => resolve("error"));
    transfer.once("end", () => resolve("complete"));
  });
  await c.request("DELETE", `/v1/artifacts/${file.id}`);
  transfer.resume();
  assert.notEqual(await ended, "complete");
  await assert.rejects(c.request("GET", `/v1/artifacts/${file.id}/content`));
  const taskFile = matched.artifacts[0];
  await c.request("DELETE", `/v1/artifacts/${taskFile.id}`);
  const deleted = await c.job(matched.id);
  assert.equal(
    deleted.artifacts.find((a) => a.id === taskFile.id).deleted,
    true,
  );
  assert.equal(
    deleted.result.artifacts.find((a) => a.id === taskFile.id).deleted,
    true,
  );
  record(
    "deleting during actual HTTP download terminates response and task metadata retains deleted state",
  );
  await c.request(
    "PUT",
    `/v1/admin/profiles/${pair.profile.id}/account-policy`,
    { mode: "anonymous", origins: [] },
  );
  const limited = await c.wait((await submit("/rate", "rate-first")).id);
  assert.equal(limited.error.code, "RATE_LIMITED");
  assert.equal(limited.error.details.retryAfter, "120");
  await assert.rejects(submit("/rate", "rate-second"), {
    code: "SITE_COOLDOWN",
  });
  assert.equal(rateHits, 1);
  await server.app.close();
  server = await createServer({
    home: path.join(home, "service"),
    port: 17981,
  });
  await server.listen();
  await assert.rejects(submit("/rate", "rate-after-restart"), {
    code: "SITE_COOLDOWN",
  });
  assert.equal(rateHits, 1);
  assert.equal((await submit("/rate", "rate-first")).id, limited.id);
  const cooldown = (await c.request("GET", "/v1/admin/cooldowns")).items.find(
    (x) => !x.releasedAt,
  );
  await c.request("POST", `/v1/admin/cooldowns/${cooldown.id}/release`, {});
  assert.equal((await c.job(limited.id)).state, "failed");
  record(
    "actual HTTP Retry-After persists, prevents a second request and survives service restart without replay",
    { rateHits, cooldownId: cooldown.id },
  );
} finally {
  await worker?.stop();
  await server.app.close();
  await new Promise((resolve) => fixture.close(resolve));
}
console.log(JSON.stringify({ home, passed: checks.length }));
