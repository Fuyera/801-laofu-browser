import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { Store } from "../dist/store.js";
import { BrowserClient } from "../dist/client.js";
const root = path.resolve("."),
  home = fs.mkdtempSync(path.join(root, "workspace/faults-"));
let count = 0;
const effects = [];
const fixture = http.createServer((req, res) => {
  if (req.url === "/submit") {
    count++;
    effects.push(Date.now());
    setTimeout(() => res.end("accepted"), 3000);
    return;
  }
  res.setHeader("content-type", "text/html");
  res.end(
    "<title>Effect fixture</title><button id=\"commit\" onclick=\"fetch('/submit',{method:'POST'})\">Commit test effect</button>",
  );
});
await new Promise((r) => fixture.listen(17952, "127.0.0.1", r));
const store = new Store(home),
  owner = store.createProduct("故障测试", "owner", ["*"]);
fs.writeFileSync(
  path.join(home, "owner.json"),
  JSON.stringify({ ...owner, url: "http://127.0.0.1:17951" }),
  { mode: 0o600 },
);
store.close();
const c = new BrowserClient("http://127.0.0.1:17951", owner.token);
let core, worker;
const results = [];
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
function child(args, name) {
  const fd = fs.openSync(path.join(home, name + ".log"), "a");
  const p = spawn(process.execPath, ["dist/cli.js", ...args], {
    stdio: ["ignore", fd, fd],
    env: { ...process.env, LAOFU_DEBUG: "1" },
  });
  fs.closeSync(fd);
  return p;
}
async function stop(p, signal = "SIGTERM") {
  if (!p || p.exitCode !== null) return;
  p.kill(signal);
  await new Promise((r) => {
    p.once("exit", r);
    setTimeout(() => {
      p.kill("SIGKILL");
      r();
    }, 12000).unref();
  });
}
async function wait(test, timeout = 60000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await test()) return;
    await delay(100);
  }
  throw new Error("condition timeout");
}
async function startCore() {
  core = child(["serve", "--home", home, "--port", "17951"], "core");
  await wait(async () => {
    try {
      return (await fetch(c.baseUrl + "/healthz")).ok;
    } catch {
      return false;
    }
  });
}
try {
  await startCore();
  const pair = await c.request("POST", "/v1/admin/workers", {
    name: "故障浏览器",
  });
  const cfg = {
    home: path.join(home, "worker"),
    baseUrl: c.baseUrl,
    workerId: pair.worker.id,
    profileId: pair.profile.id,
    token: pair.token,
    headless: true,
    bridgePort: 18951,
  };
  fs.writeFileSync(path.join(home, "worker.json"), JSON.stringify(cfg), {
    mode: 0o600,
  });
  const startWorker = async () => {
    worker = child(
      ["worker", "--config", path.join(home, "worker.json")],
      "worker",
    );
    await wait(async () =>
      (await c.capabilities()).profiles.some((p) => p.ready),
    );
  };
  await startWorker();
  const session = await c.session(pair.profile.id);
  const call = async (tool, args, key) => {
    const j = await c.command(session.id, { tool, args }, key);
    return c.wait(j.id);
  };
  assert.equal(
    (
      await call(
        "tabs",
        { action: "new", url: "http://127.0.0.1:17952" },
        "open",
      )
    ).state,
    "succeeded",
  );
  const request = {
    tool: "eval",
    args: { expr: 'fetch("/submit",{method:"POST"}).then(r=>r.text())' },
  };
  const first = await c.command(session.id, request, "commit-once");
  await wait(() => count === 1);
  await stop(core, "SIGKILL");
  await delay(2000);
  await startCore();
  const resumed = await c.job(first.id);
  assert.equal(resumed.state, "suspended");
  assert.equal(resumed.effectState, "unknown");
  const same = await c.command(session.id, request, "commit-once");
  assert.equal(same.id, first.id);
  await delay(6500);
  assert.equal(count, 1, "unknown write must not replay");
  assert.equal(
    (await c.capabilities()).profiles.find((p) => p.id === pair.profile.id)
      .quarantined,
    true,
  );
  assert.equal((await c.job(first.id)).state, "suspended");
  results.push({
    case: "service killed after external effect before acknowledgment; original id replay does not resend",
    passed: true,
    effects: count,
    jobId: first.id,
  });
  await c.cancel(first.id);
  await stop(worker);
  await c.request("POST", `/v1/admin/profiles/${pair.profile.id}/recover`, {
    confirmStopped: true,
    acknowledgeUnknownEffects: true,
  });
  await startWorker();
  assert.equal(count, 1);
  results.push({
    case: "old worker reconnect and explicit recovery do not replay the write",
    passed: true,
  });
  assert.equal(
    (
      await call(
        "tabs",
        { action: "new", url: "http://127.0.0.1:17952" },
        "open-again",
      )
    ).state,
    "succeeded",
  );
  const batch = await c.command(
    session.id,
    {
      tool: "act",
      args: {
        allowSensitive: true,
        steps: [
          {
            do: "repeat",
            max: 5,
            steps: [
              { do: "click", selector: "#commit" },
              {
                do: "wait",
                for: "text",
                value: "never appears",
                timeout: 5000,
              },
            ],
          },
        ],
      },
    },
    "cancel-batch",
  );
  await wait(() => count === 2);
  await c.cancel(batch.id);
  const cancelled = await c.wait(batch.id, { timeoutMs: 30000 });
  assert.equal(cancelled.state, "cancelled");
  await delay(1000);
  assert.equal(count, 2, "cancelled act must not submit another iteration");
  results.push({
    case: "cancel while act is executing stops subsequent atomic steps",
    passed: true,
    jobId: batch.id,
  });
  const bridgeWrite = await c.command(session.id, request, "bridge-unknown");
  await wait(() => count === 3);
  const bridgeInfo = JSON.parse(
    fs.readFileSync(path.join(cfg.home, "bridge/bridge.json")),
  );
  process.kill(bridgeInfo.pid, "SIGKILL");
  let bridgeJob;
  await wait(async () => {
    bridgeJob = await c.job(bridgeWrite.id);
    return ["suspended", "failed"].includes(bridgeJob.state);
  }, 90000);
  assert.equal(bridgeJob.effectState, "unknown");
  assert.equal(
    (await c.command(session.id, request, "bridge-unknown")).id,
    bridgeWrite.id,
  );
  await delay(3500);
  assert.equal(count, 3);
  assert.equal(
    (await c.capabilities()).profiles.find((p) => p.id === pair.profile.id)
      .quarantined,
    true,
  );
  results.push({
    case: "bridge killed after effect before reply, identity replay does not resend; profile quarantined",
    passed: true,
    jobId: bridgeWrite.id,
  });
  fs.writeFileSync(
    path.join(home, "report.json"),
    JSON.stringify({ home, results, effects }, null, 2),
  );
  console.log(JSON.stringify({ home, results }));
} finally {
  await stop(worker);
  await stop(core);
  await new Promise((r) => fixture.close(r));
}
