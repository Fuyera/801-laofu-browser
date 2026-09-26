// Real extension + worker + HTTP + MCP stdio; isolated profile and dynamic ports.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import net from "node:net";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createServer } from "../dist/server.js";
import { BrowserClient } from "../dist/client.js";
const home = fs.mkdtempSync(path.join(os.tmpdir(), "laofu-observation-"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = async () => {
  const s = net.createServer();
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  const p = s.address().port;
  await new Promise((r) => s.close(r));
  return p;
};
const fixture = http.createServer((_req, res) => {
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.end(
    `<!doctype html><title>Observation fixture</title><style>img{width:80px;height:50px}button{display:block}#tail{margin-top:3000px}</style><main><div id="busy" aria-busy="true">Loading fixture</div><img id="picture" style="cursor:pointer" alt="查看样例图片" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='80' height='50'%3E%3C/svg%3E"><img alt="装饰图片"><p>${"可核验的样本正文。".repeat(220)}</p><div id="tail">End</div></main><script>document.querySelector('#picture').addEventListener('click',e=>e.target.alt='图片已打开')</script>`,
  );
});
let service, worker, mcp;
const checks = [];
const check = async (name, fn) => {
  await fn();
  checks.push(name);
  console.log("PASS", name);
};
const text = (r) =>
  r.content
    ?.filter((x) => x.type === "text")
    .map((x) => x.text)
    .join("\n") || "";
const observation = (r) => {
  const m = text(r).match(/\[observation (\{[^\n]+\})\]/);
  assert.ok(m, text(r));
  return JSON.parse(m[1]);
};
try {
  await new Promise((r) => fixture.listen(0, "127.0.0.1", r));
  service = await createServer({ home: path.join(home, "service") });
  const url = await service.app.listen({ host: "127.0.0.1", port: 0 });
  const owner = service.store.createProduct("observation regression", "owner", [
    "*",
  ]);
  const c = new BrowserClient(url, owner.token);
  const pair = await c.request("POST", "/v1/admin/workers", {
    name: "isolated observation",
  });
  const config = {
    home: path.join(home, "worker"),
    baseUrl: url,
    workerId: pair.worker.id,
    profileId: pair.profile.id,
    token: pair.token,
    headless: true,
    bridgePort: await freePort(),
  };
  const configPath = path.join(home, "worker.json");
  fs.writeFileSync(configPath, JSON.stringify(config), { mode: 0o600 });
  const fd = fs.openSync(path.join(home, "worker.log"), "a");
  worker = spawn(
    process.execPath,
    ["dist/cli.js", "worker", "--config", configPath],
    { stdio: ["ignore", fd, fd] },
  );
  fs.closeSync(fd);
  let ready = false;
  for (let i = 0; i < 120; i++) {
    if ((await c.capabilities()).profiles.some((p) => p.ready)) {
      ready = true;
      break;
    }
    if (worker.exitCode !== null) throw Error("Worker exited; inspect " + home);
    await sleep(500);
  }
  assert.ok(ready, "Worker did not become ready; " + home);
  mcp = new Client({ name: "real-observation-regression", version: "1" });
  await mcp.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: ["dist/cli.js", "mcp", "--profile", pair.profile.id],
      env: {
        ...process.env,
        LAOFU_URL: url,
        LAOFU_TOKEN: owner.token,
        LAOFU_HOME: path.join(home, "client"),
      },
      stderr: "ignore",
    }),
  );
  const call = async (name, args = {}) => {
    const r = await mcp.callTool({ name, arguments: args });
    assert.notEqual(r.isError, true, text(r));
    return r;
  };
  await call("tabs", {
    action: "new",
    url: `http://127.0.0.1:${fixture.address().port}/`,
  });
  await check(
    "real MCP preserves snapshot text and delivers structured job evidence",
    async () => {
      const r = await call("snapshot");
      assert.equal(r.structuredContent.outcome.successful, true);
      assert.equal(r.structuredContent.job.state, "succeeded");
      assert.match(text(r), /Observation fixture/);
    },
  );
  await check(
    "snapshot reports busy, excerpt truncation and bounded scroll scope",
    async () => {
      const o = observation(await call("snapshot"));
      assert.equal(o.busy, true);
      assert.equal(o.excerptTruncated, true);
      assert.equal(o.scroll.atBottom, false);
      assert.equal(o.completeness, "not_assessed");
    },
  );
  await check(
    "image-only pointer control is discoverable and clickable by semantic name",
    async () => {
      const r = await call("snapshot");
      assert.match(text(r), /\[e\d+\].*查看样例图片/);
      assert.doesNotMatch(text(r), /\[e\d+\].*装饰图片/);
      await call("click", {
        find: { role: "button", name: "查看样例图片" },
        expect: { appears: 'img[alt="图片已打开"]' },
      });
      assert.match(text(await call("snapshot")), /图片已打开/);
    },
  );
  await check(
    "new observations reflect DOM changes; hidden busy markers are excluded",
    async () => {
      await call("eval", {
        expr: "(()=>{document.querySelector('#busy').style.display='none';return true})()",
      });
      assert.equal(observation(await call("snapshot")).busy, false);
    },
  );
  await check(
    "element limit is explicit and bottom is not a completeness claim",
    async () => {
      await call("eval", {
        expr: "(()=>{document.querySelector('main').innerHTML='<div style=\"display:flex;flex-wrap:wrap\">'+Array.from({length:450},(_,i)=>'<button>'+i+'</button>').join('')+'</div>';return true})()",
      });
    const reply = await mcp.callTool({ name: "snapshot", arguments: {} });
    assert.equal(reply.isError, true);
    assert.equal(reply.structuredContent.outcome.partial, true);
    assert.equal(reply.structuredContent.outcome.successful, false);
    const o = observation(JSON.parse(reply.content[0].text).result);
    assert.equal(o.elementsTruncated, true);
      assert.ok(o.interactiveElements <= 300);
      assert.equal(o.completeness, "not_assessed");
    },
  );
  await check(
    "unknown MCP tool is rejected without creating a task",
    async () => {
      const before = service.store.jobs().length;
      const r = await mcp.callTool({ name: "invented_tool", arguments: {} });
      assert.equal(r.isError, true);
      assert.equal(r.structuredContent.error.code, "CAPABILITY_UNAVAILABLE");
      assert.equal(service.store.jobs().length, before);
    },
  );
  fs.writeFileSync(
    path.join(home, "report.json"),
    JSON.stringify(
      {
        node: process.version,
        checks,
        passed: checks.length,
        scope: "real isolated Chromium extension / HTTP worker / MCP stdio",
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ home, passed: checks.length }));
} finally {
  await mcp?.close();
  if (worker && worker.exitCode === null) {
    worker.kill("SIGTERM");
    await Promise.race([
      new Promise((r) => worker.once("exit", r)),
      sleep(10000),
    ]);
    if (worker.exitCode === null) worker.kill("SIGKILL");
  }
  await service?.app.close();
  await new Promise((r) => fixture.close(r));
}
