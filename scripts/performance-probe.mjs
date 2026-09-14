import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { BrowserClient } from "../dist/client.js";
const root = path.resolve("."),
  state = path.join(root, "workspace/local-state"),
  home = fs.mkdtempSync(path.join(root, "workspace/performance-")),
  owner = JSON.parse(fs.readFileSync(path.join(state, "owner.json"))),
  client = new BrowserClient(owner.url, owner.token),
  roots = JSON.parse(fs.readFileSync(path.join(state, "processes.json"))).map(
    (p) => p.pid,
  );
const fixture = http.createServer((req, res) => {
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.end(
    "<article><h1>性能固定样本</h1>" +
      Array.from(
        { length: 180 },
        (_, i) =>
          "<p>第" + i + "段。" + "保存正文、来源和图文包。".repeat(8) + "</p>",
      ).join("") +
      "</article>",
  );
});
await new Promise((r) => fixture.listen(17976, "127.0.0.1", r));
const samples = [];
function rss() {
  const rows = execFileSync("ps", ["-axo", "pid=,ppid=,rss="], {
      encoding: "utf8",
    })
      .trim()
      .split("\n")
      .map((l) => l.trim().split(/\s+/).map(Number)),
    pids = new Set(roots);
  for (let i = 0; i < 8; i++)
    for (const [pid, parent] of rows) if (pids.has(parent)) pids.add(pid);
  return rows
    .filter((r) => pids.has(r[0]))
    .reduce((n, r) => n + r[2] * 1024, 0);
}
try {
  const profile = (await client.capabilities()).profiles.find(
    (p) => p.mode === "owner" && p.ready,
  );
  assert.ok(profile);
  for (let i = 0; i < 3; i++) {
    let peak = rss();
    const timer = setInterval(() => {
      peak = Math.max(peak, rss());
    }, 200);
    try {
      const before = Date.now(),
        created = await client.submitTask(
          {
            type: "article.capture@v1",
            profileId: profile.id,
            input: { url: "http://127.0.0.1:17976" },
          },
          "perf-" + Date.now(),
        ),
        j = await client.wait(created.id);
      assert.equal(j.state, "succeeded");
      samples.push({
        jobId: j.id,
        totalMs: Date.now() - before,
        metrics: j.result.metrics,
        peakProcessTreeRssBytes: peak,
        artifactBytes: j.artifacts.reduce((n, a) => n + a.bytes, 0),
      });
    } finally {
      clearInterval(timer);
    }
  }
} finally {
  fixture.close();
}
const range = (key) => ({
  min: Math.min(...samples.map((x) => x[key])),
  max: Math.max(...samples.map((x) => x[key])),
});
const report = {
  home,
  environment: {
    platform: process.platform,
    arch: process.arch,
    node: process.version,
  },
  scope:
    "同一Mac专用浏览器180段本地固定页面，连续3次；200ms采样本任务服务/执行端进程树RSS总和，含共享页内存重复计数；不等于物理独占内存或公网采集SLO",
  samples,
  totalMs: range("totalMs"),
  peakProcessTreeRssBytes: range("peakProcessTreeRssBytes"),
};
fs.writeFileSync(
  path.join(home, "report.json"),
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report));
