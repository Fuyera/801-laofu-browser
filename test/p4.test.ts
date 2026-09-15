import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import { BrowserClient } from "../src/client.js";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { createServer } from "../src/server.js";
import { Store } from "../src/store.js";
import { Artifacts } from "../src/artifacts.js";
import { Broker } from "../src/broker.js";
import { captureArticle } from "../src/article.js";

test("product artifact quota prevents one product consuming the other product budget", async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "lb-p4-quota-")),
    s = new Store(home),
    a = new Artifacts(s, 1000);
  t.after(() => {
    s.close();
    fs.rmSync(home, { recursive: true, force: true });
  });
  const p = s.createProduct("A").product,
    q = s.createProduct("B").product;
  s.put("product", p.id, {
    ...p,
    limits: { artifactBytes: 100, maxQueued: 2, maxResident: 2 },
  });
  await a.write(
    p.id,
    "a.bin",
    "application/octet-stream",
    Readable.from([Buffer.alloc(80)]),
  );
  await assert.rejects(
    a.write(
      p.id,
      "over.bin",
      "application/octet-stream",
      Readable.from([Buffer.alloc(30)]),
    ),
    { code: "PRODUCT_QUOTA_EXCEEDED" },
  );
  await a.write(
    q.id,
    "b.bin",
    "application/octet-stream",
    Readable.from([Buffer.alloc(50)]),
  );
  assert.equal(s.artifacts().length, 2);
});
test("site cooldown persists across restart, rejects new identities of work, and preserves the original job", (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "lb-p4-cooldown-"));
  let s = new Store(home),
    broker: Broker | undefined;
  t.after(() => {
    broker?.close();
    s.close();
    fs.rmSync(home, { recursive: true, force: true });
  });
  const p = s.createProduct("A").product,
    q = s.createProduct("B").product;
  const request = {
    profileId: "profile-a",
    workerId: "worker-a",
    type: "article.capture@v1",
    input: { url: "https://example.com/article" },
  };
  const first = s.createJob(p, "task", "one", request);
  (s as any).recordCooldown(first.job, {
    origin: "https://example.com",
    retryAfter: "120",
  });
  s.close();
  s = new Store(home);
  assert.equal(s.createJob(p, "task", "one", request).job.id, first.job.id);
  assert.throws(() => s.createJob(p, "task", "two", request), {
    code: "SITE_COOLDOWN",
  });
  assert.throws(
    () =>
      s.createJob(q, "task", "other-product", {
        ...request,
        profileId: "profile-b",
        workerId: "worker-b",
      }),
    { code: "SITE_COOLDOWN" },
  );
  assert.ok(
    s.createJob(q, "task", "other-site", {
      ...request,
      input: { url: "https://different.example/article" },
    }).created,
  );
  broker = new Broker(s);
  const waiting = s.updateJob(first.job.id, { state: "waiting_user" });
  assert.throws(() => broker.resume(waiting), { code: "SITE_COOLDOWN" });
  assert.equal(s.job(first.job.id)?.state, "waiting_user");
});
test("unknown cooldown requires explicit release; expired trusted Retry-After permits new work", (t) => {
  const home = fs.mkdtempSync(
      path.join(os.tmpdir(), "lb-p4-cooldown-release-"),
    ),
    s = new Store(home);
  t.after(() => {
    s.close();
    fs.rmSync(home, { recursive: true, force: true });
  });
  const p = s.createProduct("A").product,
    request = {
      profileId: "a",
      workerId: "a",
      type: "article.capture@v1",
      input: { url: "https://example.com" },
    };
  const job = s.createJob(p, "task", "one", request).job;
  const unknown = (s as any).recordCooldown(job, {
    origin: "https://example.com",
    retryAfter: "invalid",
  });
  assert.equal(unknown.until, null);
  assert.equal(unknown.retryAfter, "invalid");
  assert.throws(() => s.createJob(p, "task", "two", request), {
    code: "SITE_COOLDOWN",
  });
  (s as any).releaseCooldown(unknown.id);
  assert.ok(s.createJob(p, "task", "two", request).created);
  const expired = (s as any).recordCooldown(job, {
    origin: "https://example.com",
    retryAfter: "0",
  });
  assert.ok(expired.until <= Date.now());
  assert.ok(s.createJob(p, "task", "three", request).created);
});
test("untrusted claimed MIME does not promote executable bytes to image or safe HTML", async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "lb-p4-mime-")),
    s = new Store(home),
    a = new Artifacts(s);
  t.after(() => {
    s.close();
    fs.rmSync(home, { recursive: true, force: true });
  });
  const p = s.createProduct("A").product;
  const file = await a.write(
    p.id,
    "image.png",
    "image/png",
    Readable.from(["<script>alert(1)</script>"]),
  );
  assert.equal(file.mime, "application/octet-stream");
  assert.equal(file.metadata.declaredMime, "image/png");
});
test("deleted artifacts terminate an already opened download and remain visible as deleted metadata", async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "lb-p4-delete-")),
    s = new Store(home),
    a = new Artifacts(s);
  t.after(() => {
    s.close();
    fs.rmSync(home, { recursive: true, force: true });
  });
  const p = s.createProduct("A").product;
  const file = await a.write(
    p.id,
    "large.bin",
    "application/octet-stream",
    Readable.from([Buffer.alloc(1024 * 1024)]),
  );
  const stream = (a as any).download(p, file.id);
  stream.on("error", () => {});
  a.remove(p, file.id);
  assert.equal(stream.destroyed, true);
  assert.equal(s.artifact(file.id)?.deleted, true);
  assert.throws(() => a.owned(p, file.id), { code: "FORBIDDEN" });
});
test("queue admission bounds one product without losing existing idempotency identity", async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "lb-p4-queue-")),
    s = await createServer({ home });
  t.after(async () => {
    await s.app.close();
    fs.rmSync(home, { recursive: true, force: true });
  });
  const owner = s.store.createProduct("owner", "owner", ["*"]);
  s.store.put("product", owner.product.id, {
    ...owner.product,
    limits: { maxQueued: 1, maxResident: 1 },
  });
  const headers = { authorization: `Bearer ${owner.token}` };
  const paired = await s.app.inject({
    method: "POST",
    url: "/v1/admin/workers",
    headers,
    payload: { mode: "owner" },
  });
  const payload = {
    type: "article.capture@v1",
    execution: { profileId: paired.json().profile.id },
    input: { url: "https://example.com" },
  };
  const post = (key: string) =>
    s.app.inject({
      method: "POST",
      url: "/v1/tasks",
      headers: { ...headers, "idempotency-key": key },
      payload,
    });
  const first = await post("one");
  assert.equal(first.statusCode, 202);
  const repeat = await post("one");
  assert.equal(repeat.json().id, first.json().id);
  const overflow = await post("two");
  assert.equal(overflow.statusCode, 429);
});
test("account site policy rejects outside scope before opening a page", async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "lb-p4-account-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  let calls = 0;
  await assert.rejects(
    (captureArticle as any)(
      { url: "https://outside.example" },
      home,
      async () => {
        calls++;
        throw Error("must not navigate");
      },
      async () => {},
      { mode: "required", origins: ["https://allowed.example"] },
    ),
    { code: "ACCOUNT_SCOPE_DENIED" },
  );
  assert.equal(calls, 0);
});
test("handoff connection ticket can only be redeemed once for its exact handoff", (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "lb-p4-ticket-")),
    s = new Store(home);
  t.after(() => {
    s.close();
    fs.rmSync(home, { recursive: true, force: true });
  });
  const ticket = s.credential("handoff", "handoff-a", 60000);
  assert.equal(
    (s as any).consumeCredential(ticket, "handoff", "handoff-b"),
    false,
  );
  assert.equal(
    (s as any).consumeCredential(ticket, "handoff", "handoff-a"),
    true,
  );
  assert.equal(
    (s as any).consumeCredential(ticket, "handoff", "handoff-a"),
    false,
  );
});
test("changing account policy cancels existing work; saving an identical policy preserves it", async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "lb-p4-policy-change-")),
    s = await createServer({ home });
  t.after(async () => {
    await s.app.close();
    fs.rmSync(home, { recursive: true, force: true });
  });
  const owner = s.store.createProduct("owner", "owner", ["*"]),
    headers = { authorization: `Bearer ${owner.token}` };
  const pair = (
    await s.app.inject({
      method: "POST",
      url: "/v1/admin/workers",
      headers,
      payload: { mode: "owner" },
    })
  ).json();
  const url = `/v1/admin/profiles/${pair.profile.id}/account-policy`,
    policy = { mode: "required", origins: ["https://example.com"] };
  assert.equal(
    (await s.app.inject({ method: "PUT", url, headers, payload: policy }))
      .statusCode,
    200,
  );
  const task = (
    await s.app.inject({
      method: "POST",
      url: "/v1/tasks",
      headers: { ...headers, "idempotency-key": "policy-job" },
      payload: {
        type: "article.capture@v1",
        execution: { profileId: pair.profile.id },
        input: { url: "https://example.com" },
      },
    })
  ).json();
  await s.app.inject({ method: "PUT", url, headers, payload: policy });
  assert.equal(s.store.job(task.id)?.state, "queued");
  await s.app.inject({
    method: "PUT",
    url,
    headers,
    payload: { mode: "anonymous", origins: [] },
  });
  assert.equal(s.store.job(task.id)?.state, "cancelled");
  assert.equal(
    (await s.app.inject({ method: "GET", url, headers })).json().mode,
    "anonymous",
  );
});
test("credential rotation during upload prevents publishing bytes received under the old credential", async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "lb-p4-rotate-upload-")),
    s = new Store(home),
    a = new Artifacts(s);
  t.after(() => {
    s.close();
    fs.rmSync(home, { recursive: true, force: true });
  });
  const identity = s.createProduct("A");
  async function* input() {
    yield Buffer.alloc(10);
    s.revokeCredentials("product", identity.product.id);
    yield Buffer.alloc(10);
  }
  await assert.rejects(
    a.write(
      identity.product.id,
      "upload.bin",
      "application/octet-stream",
      input(),
      {
        authorize: () => {
          s.product(identity.token);
        },
      },
    ),
    { code: "UNAUTHORIZED" },
  );
  assert.equal(s.artifacts().length, 0);
  assert.deepEqual(fs.readdirSync(a.directory), []);
});

test("client retries one interrupted read but never replays an interrupted submission", async (t) => {
  const hits = { GET: 0, POST: 0 };
  const server = http.createServer((req, res) => {
    const method = req.method as "GET" | "POST";
    hits[method]++;
    if (method === "POST" || hits.GET === 1) {
      req.socket.destroy();
      return;
    }
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: true }));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  });
  const c = new BrowserClient(
    `http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}`,
    "synthetic",
  );
  assert.deepEqual(await c.request("GET", "/read"), { ok: true });
  assert.equal(hits.GET, 2);
  await assert.rejects(c.request("POST", "/write", { effect: "one" }));
  assert.equal(hits.POST, 1);
});
