import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store } from "../src/store.js";
function fixture(t: any) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "lb-store-"));
  const s = new Store(home);
  t.after(() => {
    s.close();
    fs.rmSync(home, { recursive: true, force: true });
  });
  return s;
}
test("duplicate command retains original identity after restart; changed input conflicts", (t) => {
  const s = fixture(t);
  const { product } = s.createProduct("A");
  const input = {
    profileId: "p1",
    workerId: "w1",
    type: "click",
    input: { ref: "e1" },
  };
  const a = s.createJob(product, "command", "request-1", input);
  assert.equal(a.created, true);
  const b = s.createJob(product, "command", "request-1", input);
  assert.equal(b.created, false);
  assert.equal(b.job.id, a.job.id);
  assert.throws(
    () =>
      s.createJob(product, "command", "request-1", {
        ...input,
        input: { ref: "e2" },
      }),
    { code: "IDEMPOTENCY_CONFLICT" },
  );
  const other = new Store(s.home);
  assert.equal(
    other.createJob(product, "command", "request-1", input).job.id,
    a.job.id,
  );
  other.close();
});
test("profile cannot transfer to a second task until the first controller releases it", (t) => {
  const s = fixture(t);
  const fence = s.acquire("p", "first");
  assert.throws(() => s.acquire("p", "second"), { code: "PROFILE_BUSY" });
  s.release("p", "wrong");
  assert.equal(s.holds("p", "first", fence), true);
  s.release("p", "first");
  const next = s.acquire("p", "second");
  assert.ok(next > fence);
  assert.equal(s.holds("p", "first", fence), false);
});
test("late success does not restart or overwrite cancelled task", (t) => {
  const s = fixture(t);
  const { product } = s.createProduct("A");
  const { job } = s.createJob(product, "task", "one", {
    profileId: "p",
    workerId: "w",
    type: "article.capture@v1",
  });
  s.transition(job.id, "cancelled", { effectState: "unknown" });
  s.transition(job.id, "succeeded", {
    effectState: "confirmed",
    result: { sent: true },
  });
  assert.equal(s.job(job.id)?.state, "cancelled");
  assert.equal(s.events(job.id).at(-1)?.kind, "late_evidence");
});
test("cross-product ids do not grant task or profile access", (t) => {
  const s = fixture(t);
  const { product: a } = s.createProduct("A");
  const { product: b } = s.createProduct("B");
  const { job } = s.createJob(a, "task", "one", {
    profileId: "p",
    workerId: "w",
    type: "article.capture@v1",
  });
  s.put("profile", "p", { id: "p", productIds: [a.id] });
  assert.throws(() => s.ownedJob(b, job.id), { code: "FORBIDDEN" });
  assert.throws(() => s.profile(b, "p"), { code: "FORBIDDEN" });
  assert.equal(s.jobs(b).length, 0);
});
test("a replay of an unacknowledged worker command is not fresh", (t) => {
  const s = fixture(t);
  assert.equal(s.journalStart("command", { action: "submit" }).fresh, true);
  const restarted = new Store(s.home);
  const replay = restarted.journalStart("command", { action: "submit" });
  assert.equal(replay.fresh, false);
  assert.equal(replay.state, "started");
  assert.throws(() => restarted.journalStart("command", { action: "delete" }), {
    code: "IDEMPOTENCY_CONFLICT",
  });
  restarted.close();
});
test("concurrent learning changes cannot silently overwrite", (t) => {
  const s = fixture(t);
  s.saveNote("A", "example.com", "first", 0);
  assert.throws(() => s.saveNote("A", "example.com", "lost update", 0), {
    code: "VERSION_CONFLICT",
  });
  assert.equal(s.note("A", "example.com").body, "first");
  assert.equal(s.note("B", "example.com").body, "");
});
test("learning revisions retain dates and can restore old content as a new version without overwriting history", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "lb-note-"));
  const s = new Store(home);
  try {
    s.saveNote("A", "example.com", "first", 0);
    s.saveNote("A", "example.com", "second", 1);
    const history = s.noteHistory("A", "example.com");
    assert.equal(history.length, 2);
    assert.ok(history[0].savedAt);
    s.saveNote("A", "example.com", history[1].body, 2);
    assert.equal(s.note("A", "example.com").body, "first");
    assert.equal(s.noteHistory("A", "example.com").length, 3);
    assert.deepEqual(s.noteHistory("B", "example.com"), []);
  } finally {
    s.close();
    fs.rmSync(home, { recursive: true, force: true });
  }
});
