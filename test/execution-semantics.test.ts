import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Worker } from "../src/worker.js";
import { Fault } from "../src/errors.js";
import { id } from "../src/util.js";

test("Flow ask excludes long and repeated human waits, while other budgets remain enforced", async () => {
  const originalNow = Date.now;
  let now = 1_000_000;
  const w: any = Object.create(Worker.prototype);
  Object.assign(w, { config: {}, cancelled: false, activeStarted: now, humanElapsed: 0,
    humanStarted: undefined, viewers: new Map(), rateLimited: undefined });
  const job: any = { id: "fixture", fence: 1, kind: "task", expiresAt: now + 900_000,
    input: { limits: { activeTimeoutSeconds: 180, humanWaitSeconds: 600 } } };
  Date.now = () => now;
  try {
    for (const delay of [179_000, 181_000]) {
      let resolve!: (result: any) => void;
      const pending = new Promise((yes) => { resolve = yes; });
      w.browser = { call: () => pending, handoff: async () => ({ ask: { ready: true, tabId: 1 } }), control: async () => {} };
      w.send = (message: any) => {
        if (message.type === "waiting_user") {
          now += delay;
          resolve({ _meta: { "laofu.output": { outcome: "continued" } } });
        }
      };
      await w.ask(job, {});
    }
    assert.equal(w.humanElapsed, 360_000);
    assert.equal(w.humanStarted, undefined);
    assert.equal(w.humanBudget(job), 240_000);
    now += 180_001;
    assert.throws(() => w.check(job), { code: "ACTIVE_TIMEOUT" });
    w.activeStarted = now;
    w.humanElapsed = 600_000;
    assert.throws(() => w.humanBudget(job), { code: "HUMAN_TIMEOUT" });
    job.expiresAt = now - 1;
    assert.throws(() => w.check(job), { code: "TIMEOUT" });
  } finally { Date.now = originalNow; }
});

test("human wait settlement is idempotent, including a clock starting at zero", () => {
  const originalNow = Date.now; let now = 0;
  const w: any = Object.create(Worker.prototype);
  Object.assign(w, { humanElapsed: 0, humanStarted: undefined });
  Date.now = () => now;
  try {
    w.beginHuman(); now = 181_000;
    assert.equal(w.humanTime(), 181_000);
    w.finishHuman(); w.finishHuman();
    assert.equal(w.humanTime(), 181_000);
  } finally { Date.now = originalNow; }
});

for (const scenario of ["read", "write", "write-fail", "write-cancel", "cancel-before-write", "command"] as const) {
  test(`external effect evidence follows issued tools: ${scenario}`, async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "lb-effects-"));
    const w: any = new Worker({ home, profileId: "fixture", workerId: "fixture", token: "fixture", baseUrl: "http://unused" });
    const messages: any[] = [], calls: string[] = [];
    w.browser = {
      control: async () => { if (scenario === "cancel-before-write") w.cancelled = true; },
      call: async (tool: string) => {
        calls.push(tool);
        if (scenario === "write-fail" && tool === "read_text") throw new Fault("INTERNAL", "fixture transport failure");
        if (scenario === "write-cancel" && tool === "click") w.cancelled = true;
        return { content: [] };
      },
      releaseClient: async () => {}, diagnostic() {},
    };
    w.send = (message: any) => messages.push(message);
    const steps = scenario === "read" ? [{ tool: "read_text" }] : [{ tool: "click" }, { tool: "read_text" }];
    const job: any = { id: id(scenario === "command" ? "cmd" : "tsk"), sessionId: "", attempt: 1, fence: 1,
      kind: scenario === "command" ? "command" : "task", type: scenario === "command" ? "click" : "browser.flow@v1",
      expiresAt: Date.now() + 900_000, input: scenario === "command" ? { args: {} } : { steps } };
    try {
      await w.execute(job);
      const reply = messages.find((m) => m.type === "result");
      const possible = calls.includes("click");
      assert.equal(reply.result.externalEffects.possible, possible);
      assert.equal(reply.result.externalEffects.outcome, possible ? "not_independently_verified" : "none");
      assert.deepEqual(reply.result.externalEffects.dispatchedTools, possible ? ["click"] : []);
      if (scenario === "write-fail") assert.equal(reply.state, "failed");
      else if (scenario.includes("cancel")) assert.equal(reply.state, "cancelled");
      else assert.equal(reply.state, "succeeded");
    } finally { w.store.close(); fs.rmSync(home, { recursive: true, force: true }); }
  });
}
