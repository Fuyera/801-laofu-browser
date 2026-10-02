import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { Store } from "../src/store.js";
import { Broker } from "../src/broker.js";
import { Worker } from "../src/worker.js";
import { createServer } from "../src/server.js";
import { accessState, prepareArticle, renderArticle } from "../src/article.js";
import { redactUrl } from "../src/util.js";
import { Artifacts } from "../src/artifacts.js";

function fixture(t: any) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "lb-adversarial-"));
  const store = new Store(home);
  const { product } = store.createProduct("test", "owner", ["*"]);
  store.put("worker", "w", { id: "w", profileId: "p", egressId: "exit" });
  store.put("profile", "p", {
    id: "p",
    ready: true,
    quarantined: false,
    productIds: [],
  });
  const broker = new Broker(store);
  clearInterval((broker as any).timer);
  const socket: any = new EventEmitter();
  socket.readyState = 1;
  socket.send = () => {};
  socket.close = () => {};
  broker.workers.set("w", { socket, ready: true, lastSeen: Date.now() });
  let seq = 0;
  const job = (input: any = { args: {} }) =>
    store.createJob(product, "command", String(++seq), {
      type: "click",
      profileId: "p",
      workerId: "w",
      input,
    }).job;
  t.after(() => {
    broker.close();
    store.close();
    fs.rmSync(home, { recursive: true, force: true });
  });
  return { home, store, product, broker, socket, job };
}

test("long login walls and loading skeletons are never classified as accessible articles", () => {
  assert.equal(
    accessState({
      title: "Member access",
      text: "Sign in to continue. ".repeat(20),
      hasArticle: true,
      blockedMarker: "login",
    }),
    "login_required",
  );
  assert.notEqual(
    accessState({
      title: "Loading article",
      text: "Loading, please wait…",
      hasArticle: true,
    }),
    "accessible",
  );
  assert.equal(
    accessState({
      title: "验证码的工作原理",
      text: "验证码帮助系统区分访问类型。".repeat(30),
      hasArticle: true,
    }),
    "accessible",
  );
});

test("srcset uses resolution rather than source order and table cell pipes retain column meaning", () => {
  const meta = {
    url: "https://example.com",
    title: "test",
    html: '<p>Text</p><img src="/fallback.png" srcset="/large.png 1600w, /small.png 400w"><table><thead><tr><th>K</th><th>V</th></tr></thead><tbody><tr><td>a | b</td><td>value</td></tr></tbody></table>',
  };
  const prepared = prepareArticle(meta);
  assert.equal(prepared.images[0].source, "https://example.com/large.png");
  assert.match(renderArticle(meta, prepared).markdown, /a \\\| b/);
});

test("unsupported embedded media retains individual type and document position", () => {
  const p = prepareArticle({
    url: "https://example.com",
    title: "test",
    html: '<p>Before</p><video src="/a.mp4"></video><p>Middle</p><audio src="/a.mp3"></audio>',
  });
  const media = (p as any).embeddedMedia;
  assert.equal(media?.length, 2);
  assert.equal(media[0].type, "video");
  assert.equal(media[1].type, "audio");
  assert.ok(media[1].position > media[0].position);
  assert.match(
    renderArticle({ url: "https://example.com", title: "test", html: "" }, p)
      .markdown,
    /未下载/,
  );
});

test("site cooldown applies to command and every flow URL at the shared exit", (t) => {
  const f = fixture(t);
  f.store.recordCooldown(f.job(), {
    origin: "https://example.com",
    retryAfter: "60",
  });
  for (const input of [
    { args: { url: "https://example.com/a" } },
    {
      steps: [
        { tool: "navigate", args: { url: "https://other.com" } },
        { tool: "fetch", args: { url: "https://example.com/a" } },
      ],
    },
  ])
    assert.throws(
      () =>
        f.store.assertNotCooling({
          profileId: "other-profile",
          workerId: "w",
          input,
        }),
      { code: "SITE_COOLDOWN" },
    );
});

test("queued cancellation rolls back its flag if the state transaction fails", (t) => {
  const f = fixture(t),
    j = f.job();
  const transition = f.store.transition.bind(f.store);
  f.store.transition = () => {
    throw Error("injected storage failure");
  };
  assert.throws(() => f.broker.cancel(j));
  f.store.transition = transition;
  assert.equal(f.store.job(j.id)?.cancelRequested, false);
});

test("persisted queued cancellation cannot dispatch even when recovered from an old split commit", (t) => {
  const f = fixture(t),
    j = f.job();
  let sends = 0;
  f.socket.send = () => sends++;
  f.store.updateJob(j.id, { cancelRequested: true });
  f.broker.tick();
  assert.equal(sends, 0);
  assert.equal(f.store.job(j.id)?.state, "cancelled");
});

test("resume rejects quarantine and an unavailable worker without inventing running state", (t) => {
  const f = fixture(t),
    j = f.job();
  f.store.transition(j.id, "running");
  f.store.transition(j.id, "waiting_user");
  f.store.put("profile", "p", {
    ...f.store.get("profile", "p"),
    quarantined: true,
  });
  assert.throws(() => f.broker.resume(f.store.job(j.id)!));
  assert.equal(f.store.job(j.id)?.state, "waiting_user");
  f.store.put("profile", "p", {
    ...f.store.get("profile", "p"),
    quarantined: false,
  });
  f.socket.readyState = 3;
  assert.throws(() => f.broker.resume(f.store.job(j.id)!));
  assert.equal(f.store.job(j.id)?.state, "waiting_user");
  f.socket.readyState = 1;
  f.broker.workers.get("w")!.ready = false;
  assert.throws(() => f.broker.resume(f.store.job(j.id)!));
  assert.equal(f.store.job(j.id)?.state, "waiting_user");
});

test("wall deadline writes a cancel event with the durable flag", (t) => {
  const f = fixture(t),
    j = f.job();
  f.store.transition(j.id, "running", { expiresAt: Date.now() - 1 });
  f.broker.tick();
  assert.equal(f.store.job(j.id)?.cancelRequested, true);
  assert.equal(
    f.store.events(j.id).filter((e) => e.kind === "cancel_requested").length,
    1,
  );
});

test("terminal result closes an idle handoff viewer immediately", (t) => {
  const f = fixture(t),
    j = f.job();
  let closed = false;
  f.store.transition(j.id, "running", { fence: 1 });
  f.store.transition(j.id, "waiting_user");
  f.broker.viewers.set("v", {
    socket: {
      close() {
        closed = true;
      },
    } as any,
    jobId: j.id,
    workerId: "w",
  });
  f.broker.message("w", {
    type: "result",
    jobId: j.id,
    fence: 1,
    state: "succeeded",
    stopped: true,
    effectState: "confirmed",
    result: {},
  });
  assert.equal(closed, true);
  assert.equal(f.broker.viewers.size, 0);
});

test("command rate limit result persists cooldown too", (t) => {
  const f = fixture(t),
    j = f.job({ args: { url: "https://example.com" } });
  f.store.transition(j.id, "running", { fence: 1 });
  f.broker.message("w", {
    type: "result",
    jobId: j.id,
    fence: 1,
    state: "failed",
    stopped: true,
    effectState: "unknown",
    error: {
      code: "RATE_LIMITED",
      details: { origin: "https://example.com", retryAfter: "30" },
    },
  });
  assert.equal(f.store.list("cooldown").length, 1);
});

test("public source URLs hide path tokens and unknown query credentials", () => {
  const url = redactUrl(
    "https://example.com/s/SYNTHETIC_PATH?signature2=SYNTHETIC_KEY&page=2",
  );
  assert.doesNotMatch(url, /SYNTHETIC_PATH|SYNTHETIC_KEY/);
  assert.match(url, /page=2/);
});

test("journal does not duplicate raw binary and expired payloads retain the dedupe tombstone", (t) => {
  const f = fixture(t);
  f.store.journalStart("binary", { tool: "fetch" });
  f.store.journalFinish("binary", { base64: "U1lOVEhFVElD", bytes: 9 });
  assert.doesNotMatch(
    f.store.db.prepare("SELECT payload FROM journal WHERE id='binary'").get()!
      .payload,
    /U1lOVEhFVElD/,
  );
  f.store.journalStart("command", { tool: "click" });
  f.store.journalFinish("command", {
    content: [{ type: "text", text: "private body" }],
  });
  (f.store as any).pruneJournalPayloads(Date.now() + 8 * 86400_000);
  const replay = f.store.journalStart("command", { tool: "click" });
  assert.equal(replay.fresh, false);
  assert.equal((replay as any).resultExpired, true);
});

test("failed worker execution cleans only its own temporary job directory", async (t) => {
  const f = fixture(t);
  const w: any = new Worker({
    home: path.join(f.home, "worker"),
    profileId: "p",
    workerId: "w",
    token: "synthetic",
    baseUrl: "http://unused",
  });
  t.after(() => w.store.close());
  w.browser = {
    releaseClient: async () => {},
    control: async () => {},
    call: async () => {
      throw Error("fixture failure");
    },
    diagnostic() {},
  };
  w.send = () => {};
  const j = { ...f.job(), attempt: 1, fence: 1 };
  await w.execute(j);
  assert.equal(fs.existsSync(path.join(w.config.home, "jobs", j.id)), false);
});

test("interrupted act after completed steps remains unknown and cannot report a reusable controller", async (t) => {
  const f = fixture(t);
  const w: any = new Worker({
    home: path.join(f.home, "worker"),
    profileId: "p",
    workerId: "w",
    token: "synthetic",
    baseUrl: "http://unused",
  });
  t.after(() => w.store.close());
  let response: any;
  w.browser = {
    releaseClient: async () => {},
    control: async () => {},
    call: async () => ({
      content: [],
      _meta: {
        "laofu.output": {
          completed: false,
          doneCount: 1,
          effectUnknown: false,
        },
      },
    }),
    diagnostic() {},
  };
  w.send = (m: any) => {
    if (m.type === "result") response = m;
  };
  await w.execute({ ...f.job(), type: "act", fence: 1 });
  assert.equal(response.state, "partial");
  assert.equal(response.effectState, "unknown");
  assert.equal(response.stopped, false);
});

test("HTTP body limits, flow reload preflight, staged artifacts and bounded task pages expose precise outcomes", async (t) => {
  const f = fixture(t),
    s = await createServer({ home: path.join(f.home, "http") });
  t.after(() => s.app.close());
  const o = s.store.createProduct("owner", "owner", ["*"]),
    h = { authorization: `Bearer ${o.token}` };
  const oversize = await s.app.inject({
    method: "POST",
    url: "/v1/tasks",
    headers: h,
    payload: { padding: "x".repeat(2 * 1024 ** 2 + 1) },
  });
  assert.equal(oversize.statusCode, 413);
  assert.equal(oversize.json().error.code, "LIMIT_EXCEEDED");
  const paired = (
    await s.app.inject({
      method: "POST",
      url: "/v1/admin/workers",
      headers: h,
      payload: { name: "test" },
    })
  ).json();
  const flow = await s.app.inject({
    method: "POST",
    url: "/v1/tasks",
    headers: { ...h, "idempotency-key": "reload" },
    payload: {
      type: "browser.flow@v1",
      execution: { profileId: paired.profile.id },
      input: {
        steps: [
          { tool: "reload" },
          { tool: "status", args: { text: "after" } },
        ],
      },
    },
  });
  assert.equal(flow.statusCode, 400);
  assert.equal(flow.json().error.code, "CAPABILITY_UNAVAILABLE");
  const a = await s.artifacts.write(
    o.product.id,
    "article.md",
    "text/markdown",
    Readable.from(["pending"]),
    { metadata: { source: "worker", publication: "staged" } },
  );
  const read = await s.app.inject({ url: "/v1/artifacts/" + a.id, headers: h });
  assert.notEqual(read.statusCode, 200);
  const listed = await s.app.inject({ url: "/v1/artifacts", headers: h });
  assert.equal(listed.json().items.length, 0);
  for (let i = 0; i < 55; i++) {
    const j = s.store.createJob(o.product, "task", "page-" + i, {
      type: "test",
      profileId: "p",
      workerId: "w",
    }).job;
    s.store.transition(j.id, "succeeded");
  }
  const first = (
    await s.app.inject({ url: "/v1/tasks?limit=20", headers: h })
  ).json();
  assert.equal(first.items.length, 20);
  assert.ok(first.nextCursor);
  assert.equal(first.truncated, true);
  const second = (
    await s.app.inject({
      url: "/v1/tasks?limit=20&cursor=" + first.nextCursor,
      headers: h,
    })
  ).json();
  assert.ok(
    second.items.every(
      (j: any) => !first.items.some((a: any) => a.id === j.id),
    ),
  );
});

test("capture publication is atomic with the terminal state; janitor removes only abandoned temporary data", async (t) => {
  const f = fixture(t),
    artifacts = new Artifacts(f.store);
  const j = f.store.createJob(f.product, "task", "bundle", {
    type: "article.capture@v1",
    profileId: "p",
    workerId: "w",
    input: {},
  }).job;
  f.store.transition(j.id, "running");
  const files = [];
  for (const name of [
    "article.md",
    "article.html",
    "manifest.json",
    "article-with-images.zip",
  ])
    files.push(
      await artifacts.write(
        f.product.id,
        name,
        "text/plain",
        Readable.from(["synthetic bundle member"]),
        { jobId: j.id, metadata: { source: "worker", publication: "staged" } },
      ),
    );
  const result = { manifest: { title: "test" }, artifacts: files };
  assert.throws(() => artifacts.owned(f.product, files[0].id), {
    code: "ARTIFACT_INCOMPLETE",
  });
  const transition = f.store.transition.bind(f.store);
  f.store.transition = () => {
    throw Error("injected terminal commit failure");
  };
  assert.throws(
    () => f.store.finishJob(j.id, "succeeded", { result }),
    /commit failure/,
  );
  assert.equal(f.store.job(j.id)?.state, "running");
  assert.ok(
    files.every(
      (a) => f.store.artifact(a.id)?.metadata.publication === "staged",
    ),
  );
  f.store.transition = transition;
  assert.throws(
    () =>
      f.store.finishJob(j.id, "succeeded", {
        result: { ...result, artifacts: files.map(() => files[0]) },
      }),
    { code: "ARTIFACT_INCOMPLETE" },
  );
  assert.ok(
    files.every(
      (a) => f.store.artifact(a.id)?.metadata.publication === "staged",
    ),
  );
  f.store.finishJob(j.id, "succeeded", { result });
  assert.ok(
    files.every(
      (a) =>
        artifacts.owned(f.product, a.id).metadata.publication === "published",
    ),
  );
  const failed = f.store.createJob(f.product, "task", "failed-bundle", {
    type: "article.capture@v1",
    profileId: "p",
    workerId: "w",
  }).job;
  const abandoned = await artifacts.write(
    f.product.id,
    "article.md",
    "text/plain",
    Readable.from(["abandoned"]),
    { jobId: failed.id, metadata: { source: "worker", publication: "staged" } },
  );
  f.store.transition(failed.id, "failed");
  const stale = path.join(
      artifacts.directory,
      "art_" + "1".repeat(32) + ".partial",
    ),
    recent = path.join(
      artifacts.directory,
      "art_" + "2".repeat(32) + ".partial",
    );
  fs.writeFileSync(stale, "old partial");
  fs.utimesSync(stale, 0, 0);
  fs.writeFileSync(recent, "recent partial");
  artifacts.sweep();
  assert.equal(fs.existsSync(stale), false);
  assert.equal(fs.existsSync(recent), true);
  assert.equal(f.store.artifact(abandoned.id)?.deleted, true);
  artifacts.sweep(Date.now() + 365 * 86400_000);
  assert.ok(files.every((a) => !f.store.artifact(a.id)?.deleted));
});

test("legacy journal timestamps migrate once and never expire the idempotency key", (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "lb-journal-migration-"));
  let store = new Store(home);
  t.after(() => {
    store.close();
    fs.rmSync(home, { recursive: true, force: true });
  });
  store.journalStart("legacy", { tool: "click" });
  store.journalFinish("legacy", { text: "private source" });
  store.db
    .prepare("DELETE FROM resources WHERE kind='journal-retention'")
    .run();
  store.close();
  store = new Store(home);
  const savedAt = store.get("journal-retention", "legacy").savedAt;
  store.pruneJournalPayloads(savedAt + 8 * 86400_000);
  store.close();
  store = new Store(home);
  assert.equal(store.get("journal-retention", "legacy"), undefined);
  const prior = store.journalStart("legacy", { tool: "click" });
  assert.equal(prior.fresh, false);
  assert.equal(prior.resultExpired, true);
  assert.throws(() => store.journalStart("legacy", { tool: "type" }), {
    code: "IDEMPOTENCY_CONFLICT",
  });
});
