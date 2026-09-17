import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { BrowserAdapter } from "../src/browser.js";
import { Worker } from "../src/worker.js";

test("BrowserAdapter correlates Chrome tab ID to exact target, not identical page URLs", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "lb-rate-adapter-"));
  const browser: any = new BrowserAdapter({ home, profileId: "fixture" });
  const page = (targetId: string) => Object.assign(new EventEmitter(), { targetId, isClosed: () => false });
  const a = page("target-a"), b = page("target-b");
  const context: any = Object.assign(new EventEmitter(), {
    pages: () => [a, b], newCDPSession: async (page: any) => ({
      send: async () => ({ targetInfo: { targetId: page.targetId } }), detach: async () => {},
    }),
  });
  browser.context = context;
  browser.rpc = { call: async () => ({ targetId: "target-a" }) };
  const seen: any[] = []; browser.onRateLimit = (e: any) => seen.push(e);
  browser.observeRateLimits(); browser.rateScope.control("job", 1);
  try {
    await browser.bindRatePage(7, { id: "job", fence: 1 });
    const emit = (page: any) => {
      const request = { frame: () => ({ page: () => page }) };
      context.emit("request", request);
      context.emit("response", { status: () => 429, url: () => "https://same.example/resource", headers: () => ({ "retry-after": "10" }), request: () => request });
    };
    emit(b); assert.equal(seen.length, 0);
    emit(a); assert.equal(seen.length, 1);
    assert.equal(seen[0].jobId, "job"); assert.equal(seen[0].fence, 1);
    a.emit("close"); assert.equal(browser.tabPages.has(7), false);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test("Worker ignores stale or foreign execution identity in rate-limit evidence", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "lb-rate-worker-"));
  const w: any = new Worker({ home, profileId: "fixture", workerId: "fixture", token: "fixture", baseUrl: "http://unused" });
  const callback = w.browser.onRateLimit; const sent: any[] = [];
  w.browser.control = async () => {}; w.send = (message: any) => sent.push(message);
  w.active = { id: "active", fence: 3 };
  const evidence = { origin: "https://example.org", retryAfter: "30", observedAt: 1 };
  try {
    callback({ ...evidence, jobId: "other", fence: 3 });
    callback({ ...evidence, jobId: "active", fence: 2 });
    assert.equal(w.rateLimited, undefined); assert.equal(sent.length, 0);
    callback({ ...evidence, jobId: "active", fence: 3 });
    assert.equal(w.rateLimited.code, "RATE_LIMITED"); assert.equal(sent.length, 1);
  } finally { w.store.close(); fs.rmSync(home, { recursive: true, force: true }); }
});
