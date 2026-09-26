import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);
test("local status/start/stop reject a reused PID and leave its unrelated owner alive", async (t) => {
  if (process.platform === "win32") {
    t.skip("macOS/Linux ps identity check");
    return;
  }
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "lb-pid-"));
  const sentinel = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
    stdio: "ignore",
  });
  const run = async (cmd: string, extra: string[] = []) =>
    JSON.parse(
      (
        await exec(process.execPath, [
          "scripts/local.mjs",
          cmd,
          "--home",
          home,
          ...extra,
        ])
      ).stdout,
    );
  t.after(async () => {
    await run("stop").catch(() => {});
    sentinel.kill();
    fs.rmSync(home, { recursive: true, force: true });
  });
  const stale = () =>
    fs.writeFileSync(
      path.join(home, "processes.json"),
      JSON.stringify([
        { pid: sentinel.pid, name: "service", root: process.cwd() },
      ]),
    );
  stale();
  assert.equal((await run("status")).processes[0].running, false);
  await run("stop");
  process.kill(sentinel.pid!, 0);
  stale();
  const s = net.createServer();
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  const port = (s.address() as net.AddressInfo).port;
  await new Promise<void>((r) => s.close(() => r()));
  const started = await run("start", ["--port", String(port)]);
  assert.equal(started.started, true);
  assert.notEqual(started.processes[0].pid, sentinel.pid);
  assert.equal((await run("status")).processes[0].running, true);
  assert.equal((await fetch(`http://127.0.0.1:${port}/healthz`)).status, 200);
  await run("stop");
  assert.deepEqual((await run("status")).processes, []);
  process.kill(sentinel.pid!, 0);
});
