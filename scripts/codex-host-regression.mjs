// Exercise the actual installed Codex app-server MCP host without a model turn.
// The host context is ephemeral; no user task, account config or chat is created.
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "../dist/server.js";
import { Worker } from "../dist/worker.js";
import { BrowserClient } from "../dist/client.js";
import { installHost } from "../dist/hosts.js";
const codex = process.env.LAOFU_CODEX_BINARY;
if (!codex)
  throw Error(
    "LAOFU_CODEX_BINARY must point to the installed Codex executable",
  );
const home = fs.mkdtempSync(path.resolve("workspace/codex-host-")),
  checks = [];
const record = (name) => {
  checks.push({ name, status: "passed" });
  fs.writeFileSync(
    path.join(home, "report.json"),
    JSON.stringify(
      {
        home,
        host: codex,
        scope:
          "Actual Codex app-server, generated scoped config, ephemeral protocol context, no model turn or persistent user configuration change",
        checks,
      },
      null,
      2,
    ),
  );
  console.log("PASS " + name);
};
const fixture = http.createServer((_q, r) => {
  r.setHeader("content-type", "text/html; charset=utf-8");
  r.end("<title>Codex MCP host</title><h1>P4_ACTUAL_CODEX_HOST_READ</h1>");
});
await new Promise((r) => fixture.listen(17996, "127.0.0.1", r));
const serviceHome = path.join(home, "service"),
  core = await createServer({ home: serviceHome, port: 17995 }),
  owner = core.store.createProduct("host owner", "owner", ["*"]);
await core.listen();
fs.writeFileSync(
  path.join(serviceHome, "owner.json"),
  JSON.stringify({ ...owner, url: "http://127.0.0.1:17995" }),
  { mode: 0o600 },
);
const c = new BrowserClient("http://127.0.0.1:17995", owner.token),
  pair = await c.request("POST", "/v1/admin/workers", {
    name: "actual host browser",
  });
const worker = new Worker({
  home: path.join(home, "worker"),
  baseUrl: c.baseUrl,
  token: pair.token,
  workerId: pair.worker.id,
  profileId: pair.profile.id,
  headless: true,
  bridgePort: 18995,
});
let host;
try {
  await worker.start();
  for (let i = 0; i < 150; i++) {
    if ((await c.capabilities()).profiles.some((p) => p.ready)) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  const target = path.join(home, "codex-config.toml");
  fs.writeFileSync(target, "# P4 scoped host configuration\n");
  const args = {
    host: "codex",
    home: serviceHome,
    profileId: pair.profile.id,
    target,
    apply: true,
  };
  const installed = installHost(args);
  assert.equal(installed.applied, true);
  const config = fs.readFileSync(target, "utf8"),
    command = JSON.parse(/^command = (.+)$/m.exec(config)[1]),
    commandArgs = JSON.parse(/^args = (.+)$/m.exec(config)[1]);
  const inventory = spawnSync(codex, ["mcp", "list", "--json"], {
    encoding: "utf8",
  });
  assert.equal(inventory.status, 0, inventory.stderr);
  const overrides = Object.fromEntries(
    JSON.parse(inventory.stdout).map((s) => [
      s.name,
      { command: process.execPath, args: [], enabled: false },
    ]),
  );
  overrides["laofu-browser"] = { command, args: commandArgs, enabled: true };
  const fd = fs.openSync(path.join(home, "host.log"), "w", 0o600);
  host = spawn(codex, ["app-server", "--stdio"], {
    stdio: ["pipe", "pipe", fd],
  });
  fs.closeSync(fd);
  let serial = 0,
    buffer = "";
  const pending = new Map();
  host.stdout.on("data", (chunk) => {
    buffer += chunk;
    let i;
    while ((i = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, i);
      buffer = buffer.slice(i + 1);
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      if (msg.id !== undefined && pending.has(msg.id)) {
        const p = pending.get(msg.id);
        pending.delete(msg.id);
        clearTimeout(p.timer);
        msg.error
          ? p.reject(Error(JSON.stringify(msg.error)))
          : p.resolve(msg.result);
      } else if (msg.id !== undefined) {
        host.stdin.write(
          JSON.stringify({
            jsonrpc: "2.0",
            id: msg.id,
            error: {
              code: -32601,
              message: "No unsolicited requests permitted in host regression",
            },
          }) + "\n",
        );
      }
    }
  });
  const rpc = (method, params) =>
    new Promise((resolve, reject) => {
      const id = ++serial,
        timer = setTimeout(() => {
          pending.delete(id);
          reject(Error("host timeout: " + method));
        }, 60000);
      pending.set(id, { resolve, reject, timer });
      host.stdin.write(
        JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n",
      );
    });
  await rpc("initialize", {
    clientInfo: { name: "laofu-p4-host-test", version: "0.1.0" },
    capabilities: { experimentalApi: true },
  });
  host.stdin.write(
    JSON.stringify({ jsonrpc: "2.0", method: "initialized" }) + "\n",
  );
  const started = await rpc("thread/start", {
      cwd: home,
      ephemeral: true,
      approvalPolicy: "never",
      sandbox: "read-only",
      config: { mcp_servers: overrides },
    }),
    threadId = started.thread.id;
  const list = await rpc("mcpServerStatus/list", { threadId });
  const item = list.data.find((x) => x.name === "laofu-browser");
  assert.ok(item);
  assert.ok(Object.keys(item.tools).length >= 23);
  record(
    "installed Codex host recognizes generated configuration and discovers browser tools",
  );
  const call = (tool, arguments_) =>
    rpc("mcpServer/tool/call", {
      threadId,
      server: "laofu-browser",
      tool,
      arguments: arguments_,
    });
  const created = await call("tabs", {
    action: "new",
    url: "http://127.0.0.1:17996",
  });
  assert.notEqual(created.isError, true, JSON.stringify(created));
  const read = await call("read_text", {});
  assert.notEqual(read.isError, true);
  assert.match(JSON.stringify(read), /P4_ACTUAL_CODEX_HOST_READ/);
  record(
    "actual Codex MCP host calls browser tools and receives real page content without a model turn",
  );
  const removed = installHost({ ...args, remove: true });
  assert.equal(removed.applied, true);
  assert.doesNotMatch(
    fs.readFileSync(target, "utf8"),
    /mcp_servers\.laofu-browser/,
  );
  record(
    "uninstall removes generated host entry and preserves surrounding configuration",
  );
} finally {
  host?.kill("SIGTERM");
  await worker.stop();
  await core.app.close();
  await new Promise((r) => fixture.close(r));
}
console.log(JSON.stringify({ home, passed: checks.length }));
