import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import * as cheerio from "cheerio";
import { captureArticle } from "../src/article.js";
import { createServer } from "../src/server.js";
import { hash } from "../src/util.js";

test("orderedBlocks matches final article.html main, with image, table, and code", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "lb-structure-"));
  const image = await sharp({ create: { width: 8, height: 8, channels: 3, background: "white" } }).png().toBuffer();
  const html = '<h2>Section</h2><p>First paragraph.</p><img src="data:image/png;base64,' + image.toString("base64") +
    '"><pre><code>let x = 1;</code></pre><table><tr><th>Key</th><th>Value</th></tr><tr><td>A</td><td>B</td></tr></table><p>Last paragraph.</p>';
  const meta = { url: "https://example.org/article", title: "Fixture", author: "Author", publishedText: "", httpStatus: 200,
    blockedMarker: "", text: "Authorized synthetic fixture content. ".repeat(10), hasArticle: true, hasNextPage: false, length: html.length };
  const run = async (name: string, args: any) => {
    if (name === "tabs" && args.action === "list") return { text: "共 0 个标签页" };
    if (name === "tabs" && args.action === "new") return { tabId: 1 };
    if (name === "navigate") return { text: "navigated" };
    if (name !== "eval") throw new Error(`Unexpected fixture call ${name}`);
    const expr = args.expr as string; let value: any;
    if (expr.startsWith("(async()=>")) value = { stable: true, elapsedMs: 1000, scrolls: 0 };
    else if (expr.includes("return {length:r.innerHTML.length,meta}")) value = { length: html.length, meta };
    else if (expr.includes("return {same,meta:")) value = { same: true, meta };
    else if (expr.startsWith("globalThis[") && expr.includes(".slice(")) {
      const m = /\.slice\((\d+),(\d+)\)/.exec(expr)!;
      value = html.slice(Number(m[1]), Number(m[2]));
    } else value = meta;
    return { text: JSON.stringify(value) };
  };
  try {
    const result = await captureArticle({ url: meta.url }, home, run, async () => { throw new Error("Unexpected gate"); });
    assert.equal(result.state, "succeeded");
    const bytes = fs.readFileSync(path.join(home, "article.html"));
    const $ = cheerio.load(bytes.toString());
    const nodes = $("main").find("p,h1,h2,h3,h4,h5,h6,pre,table,img").toArray();
    assert.deepEqual(nodes.map((n: any) => n.tagName), ["h2", "p", "img", "pre", "table", "p"]);
    assert.deepEqual(result.manifest.orderedBlocks, nodes.map((node: any, index) => ({
      index: index + 1, type: node.tagName, textHash: hash($(node).text()),
      ...(node.tagName === "img" ? { imagePath: $(node).attr("src") } : {}),
    })));
    assert.equal(result.manifest.contentHash, hash(bytes));
    assert.equal(result.manifest.markdownHash, hash(fs.readFileSync(path.join(home, "article.md"))));
    assert.match(result.manifest.orderedBlocks[2].imagePath!, /^images\/image-0001\.png$/);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test("latest checkpoint crosses page boundaries without changing ordered event cursors", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "lb-checkpoint-"));
  const server = await createServer({ home });
  try {
    const owner = server.store.createProduct("fixture", "owner", ["*"]);
    const request = { profileId: "fixture-profile", workerId: "fixture-worker", type: "browser.flow@v1", input: { steps: [] } };
    const { job } = server.store.createJob(owner.product, "task", "checkpoints", request);
    const other = server.store.createJob(owner.product, "task", "other", request).job;
    const headers = { authorization: `Bearer ${owner.token}` };
    const view = async () => {
      const response = await server.app.inject({ method: "GET", url: `/v1/tasks/${job.id}`, headers });
      assert.equal(response.statusCode, 200); return response.json();
    };
    assert.equal((await view()).checkpoint.step, 0);
    for (let step = 1; step <= 2000; step++) {
      server.store.event(job.id, "progress", { step });
      if (step % 7 === 0) server.store.event(job.id, "state", { state: "fixture" });
      server.store.event(other.id, "progress", { step: step + 10000 });
      if ([499, 500, 501, 600, 2000].includes(step)) assert.equal((await view()).checkpoint.step, step);
    }
    assert.equal(server.store.latestProgress(other.id).step, 12000);
    assert.equal(server.store.latestProgress("missing"), undefined);
    const ids: number[] = []; let after = 0;
    for (;;) {
      const rows = server.store.events(job.id, after);
      if (!rows.length) break;
      assert.ok(rows.length <= 500);
      for (const row of rows) { assert.ok(row.id > after); assert.equal(row.jobId, job.id); after = row.id; ids.push(row.id); }
    }
    assert.equal(ids.length, 1 + 2000 + Math.floor(2000 / 7));
    assert.equal(new Set(ids).size, ids.length);
  } finally { await server.app.close(); fs.rmSync(home, { recursive: true, force: true }); }
});
