import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn, spawnSync } from "node:child_process";
import { parseArgs } from "node:util";
import { Store } from "../dist/store.js";
import { BrowserClient } from "../dist/client.js";
import { mkdir, privateFile } from "../dist/util.js";
const root = path.resolve(import.meta.dirname, "..");
const { values: v, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    home: { type: "string" },
    port: { type: "string" },
    headless: { type: "boolean" },
    browser: { type: "boolean" },
    output: { type: "string" },
  },
});
const command = positionals[0] || "status",
  home = path.resolve(
    v.home ||
      process.env.LAOFU_HOME ||
      path.join(os.homedir(), ".laofu-browser"),
  ),
  port = Number(
    v.port ||
      (fs.existsSync(path.join(home, "owner.json"))
        ? new URL(
            JSON.parse(fs.readFileSync(path.join(home, "owner.json"))).url,
          ).port
        : null) ||
      17889,
  ),
  registry = path.join(home, "processes.json");
const read = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
const cli = path.join(root, "dist/cli.js");
function cliCall(args) {
  const r = spawnSync(process.execPath, [cli, ...args, "--home", home], {
    encoding: "utf8",
  });
  if (r.status !== 0) throw new Error(r.stderr || r.stdout);
  return JSON.parse(r.stdout);
}
function live(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    if (e.code === "ESRCH") return false;
    throw e;
  }
}
function ownedLive(record) {
  if (!live(record.pid)) return false;
  if (process.platform !== "win32") {
    const check = spawnSync(
      "ps",
      ["-p", String(record.pid), "-o", "command="],
      {
        encoding: "utf8",
      },
    );
    if (check.error) throw check.error;
    if (check.status !== 0) {
      if (!live(record.pid)) return false;
      throw new Error(`PID ${record.pid} 身份无法核验`);
    }
    const args =
      record.args ||
      (record.name === "service"
        ? ["serve", "--home", home]
        : ["worker", "--config", path.join(home, record.name)]);
    return check.stdout.includes(
      [path.join(record.root, "dist/cli.js"), ...args].join(" "),
    );
  }
  return true; // Existing Windows behavior; not part of the macOS preview acceptance.
}
async function stopped(record) {
  const { pid } = record;
  if (!ownedLive(record)) return;
  process.kill(pid, "SIGTERM");
  const end = Date.now() + 20000;
  while (ownedLive(record) && Date.now() < end)
    await new Promise((r) => setTimeout(r, 200));
  if (ownedLive(record))
    throw new Error(
      `进程 ${pid} 未确认退出；保留现场，不发送强制信号或切换版本`,
    );
}
function run(args, name) {
  mkdir(path.join(home, "logs"));
  const log = fs.openSync(
    path.join(
      home,
      "logs",
      `operations-${new Date().toISOString().slice(0, 10)}.jsonl`,
    ),
    "a",
    0o600,
  );
  const p = spawn(process.execPath, [cli, ...args], {
    cwd: root,
    detached: true,
    stdio: ["ignore", log, log],
    env: {
      ...process.env,
      ...(fs.existsSync(path.join(root, "browsers"))
        ? { PLAYWRIGHT_BROWSERS_PATH: path.join(root, "browsers") }
        : {}),
    },
  });
  fs.closeSync(log);
  p.unref();
  return { pid: p.pid, name, root, args };
}
const records = fs.existsSync(registry) ? read(registry) : [];
if (command === "start") {
  mkdir(home);
  if (records.some(ownedLive)) {
    console.log(JSON.stringify({ alreadyRunning: true, processes: records }));
    process.exit(0);
  }
  if (!fs.existsSync(path.join(home, "owner.json")))
    cliCall(["init", "--url", `http://127.0.0.1:${port}`]);
  const owned = read(path.join(home, "owner.json")),
    c = new BrowserClient(owned.url, owned.token),
    created = [];
  try {
    created.push(
      run(["serve", "--home", home, "--port", String(port)], "service"),
    );
    privateFile(registry, JSON.stringify(created));
    let ready = false;
    for (let i = 0; i < 100; i++) {
      try {
        if ((await fetch(owned.url + "/healthz")).ok) {
          ready = true;
          break;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 100));
    }
    if (!ready) throw new Error("本机服务未就绪");
    let configs = fs
      .readdirSync(home)
      .filter((n) => /^worker-.*\.json$/.test(n));
    if (v.browser && !configs.length) {
      const p = cliCall([
        "pair",
        "--name",
        "本人专用浏览器",
        ...(v.headless ? ["--headless"] : []),
      ]);
      configs = [path.basename(p.configFile)];
    }
    for (const file of configs) {
      const cfg = read(path.join(home, file));
      if (cfg.autoStart === false) continue;
      created.push(run(["worker", "--config", path.join(home, file)], file));
      privateFile(registry, JSON.stringify(created));
    }
    const expected = configs
      .map((file) => read(path.join(home, file)))
      .filter((cfg) => cfg.autoStart !== false && !cfg.attach);
    for (let i = 0; expected.length && i < 120; i++) {
      const profiles = (await c.capabilities()).profiles;
      if (
        expected.every((cfg) =>
          profiles.some((p) => p.id === cfg.profileId && p.ready),
        )
      )
        break;
      if (created.some((p) => !ownedLive(p)))
        throw new Error("启动进程提前退出");
      if (i === 119) throw new Error("执行端未在60秒内就绪");
      await new Promise((r) => setTimeout(r, 500));
    }
    console.log(
      JSON.stringify({
        started: true,
        url: owned.url,
        processes: created,
        consoleLoginCommand: "bin/laofu-browser console-login --home " + home,
      }),
    );
  } catch (e) {
    for (const p of created.reverse()) await stopped(p).catch(() => {});
    throw e;
  }
} else if (command === "stop") {
  // A registry PID can be reused after reboot; never signal a different process.
  for (const p of [...records].reverse()) await stopped(p);
  privateFile(registry, "[]");
  console.log(JSON.stringify({ stopped: true }));
} else if (command === "status") {
  console.log(
    JSON.stringify({
      home,
      processes: records.map((p) => ({ ...p, running: ownedLive(p) })),
    }),
  );
} else if (command === "backup") {
  if (records.some(ownedLive))
    throw new Error("先停止本安装的服务和执行端，再备份用于升级的状态");
  for (const file of [
    "server.lock",
    ...fs
      .readdirSync(home)
      .filter((n) => /^worker-.*\.json$/.test(n))
      .map((n) =>
        path.relative(
          home,
          path.join(read(path.join(home, n)).home, "worker.lock"),
        ),
      ),
  ]) {
    const lock = path.join(home, file);
    if (fs.existsSync(lock) && live(read(lock).pid))
      throw new Error("发现仍运行的状态持有者；未备份");
  }
  const destination = path.resolve(
    v.output ||
      path.join(home, "backups", new Date().toISOString().replaceAll(":", "-")),
  );
  mkdir(destination);
  const store = new Store(home);
  await store.db.backup(path.join(destination, "state.sqlite"));
  store.close();
  for (const name of fs
    .readdirSync(home)
    .filter((n) => n === "owner.json" || /^worker-.*\.json$/.test(n)))
    fs.copyFileSync(path.join(home, name), path.join(destination, name));
  privateFile(
    path.join(destination, "BACKUP.json"),
    JSON.stringify({
      at: new Date().toISOString(),
      schema: 1,
      includes: ["service database", "credentials", "worker configurations"],
      excludes: ["browser profiles", "artifacts", "worker command journals"],
      purpose:
        "升级数据库保护；产物、浏览器配置和命令记录仍保留原路径，回退程序不得回滚效果/幂等记录",
    }),
  );
  console.log(JSON.stringify({ backup: destination }));
} else
  throw new Error("Use start [--browser --headless], stop, status, backup");
