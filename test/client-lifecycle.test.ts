import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Worker } from "../src/worker.js";
import { createServer } from "../src/server.js";
import { id } from "../src/util.js";

for (const sessionId of ["", "ses_persistent"]) {
  test(`Worker retires only task-scoped clients (session=${sessionId || "none"})`, async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "lb-clients-"));
    const w: any = new Worker({ home, profileId: "fixture", workerId: "fixture", token: "fixture", baseUrl: "http://unused" });
    const released: string[] = [], sent: any[] = [];
    w.browser = {
      control: async () => {}, call: async () => ({ content: [] }),
      releaseClient: async (key: string) => { released.push(key); }, diagnostic() {},
    };
    w.send = (msg: any) => sent.push(msg);
    const job = { id: id("tsk"), sessionId, kind: "task", type: "browser.flow@v1", attempt: 1, fence: 1,
      expiresAt: Date.now() + 900_000, input: { steps: [{ tool: "read_text", args: {} }] } };
    try {
      await w.execute(job);
      assert.equal(sent.find((m) => m.type === "result")?.state, "succeeded");
      assert.deepEqual(released, sessionId ? [] : [job.id]);
      await w.message({ type: "session_closed", sessionId: "ses_persistent" });
      assert.equal(released.at(-1), "ses_persistent");
    } finally { w.store.close(); fs.rmSync(home, { recursive: true, force: true }); }
  });
}

test("closing a Session notifies its Worker after denying new commands", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "lb-session-"));
  const server = await createServer({ home });
  try {
    const owner = server.store.createProduct("fixture", "owner", ["*"]);
    const profileId = id("prf"), workerId = id("wrk");
    server.store.put("profile", profileId, { id: profileId, workerId, productIds: [], mode: "owner" });
    const headers = { authorization: `Bearer ${owner.token}` };
    const created = await server.app.inject({ method: "POST", url: "/v1/sessions", headers, payload: { profileId } });
    assert.equal(created.statusCode, 200);
    const session = created.json();
    const messages: any[] = [];
    server.broker.send = (worker, message) => { messages.push({ worker, message }); };
    const closed = await server.app.inject({ method: "DELETE", url: `/v1/sessions/${session.id}`, headers });
    assert.equal(closed.statusCode, 200);
    assert.equal(server.store.get("session", session.id).closed, true);
    assert.deepEqual(messages, [{ worker: workerId, message: { type: "session_closed", sessionId: session.id } }]);
    const denied = await server.app.inject({ method: "GET", url: `/v1/sessions/${session.id}`, headers });
    assert.equal(denied.statusCode, 403);
  } finally { await server.app.close(); fs.rmSync(home, { recursive: true, force: true }); }
});

for (const fails of [false, true]) {
  test(`task completion waits for client retirement (fails=${fails})`, async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "lb-client-drain-"));
    const w: any = new Worker({ home, profileId: "fixture", workerId: "fixture", token: "fixture", baseUrl: "http://unused" });
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const cleanupStarted = new Promise<void>((r) => { entered = r; });
    const sent: any[] = [];
    w.browser = {
      control: async () => {},
      call: async () => { if (fails) throw Error("fixture failure"); return { content: [] }; },
      releaseClient: async () => { entered(); await gate; }, diagnostic() {},
    };
    w.send = (m: any) => sent.push(m);
    const execution = w.execute({ id: id("tsk"), sessionId: "", kind: "task", type: "browser.flow@v1",
      attempt: 1, fence: 1, expiresAt: Date.now() + 900_000,
      input: { steps: [{ tool: "read_text", args: {} }] } });
    try {
      await cleanupStarted;
      assert.equal(sent.some((m) => m.type === "result"), false);
      release(); await execution;
      assert.equal(sent.find((m) => m.type === "result").state, fails ? "failed" : "succeeded");
      assert.equal(w.running, false);
    } finally { release(); await execution; w.store.close(); fs.rmSync(home, { recursive: true, force: true }); }
  });
}
