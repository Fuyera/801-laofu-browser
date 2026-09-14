import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";
const { values: v, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    prefix: { type: "string" },
    source: { type: "string" },
    release: { type: "string" },
  },
});
const prefix = path.resolve(
    v.prefix || path.join(os.homedir(), ".local/share/laofu-browser"),
  ),
  state = path.join(prefix, "state"),
  selection = path.join(prefix, "current.json"),
  releases = path.join(prefix, "releases");
const command = positionals[0] || "status",
  read = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
fs.mkdirSync(releases, { recursive: true, mode: 0o700 });
const current = fs.existsSync(selection) ? read(selection) : null;
function node(dir) {
  return path.join(
    dir,
    "node",
    process.platform === "win32" ? "node.exe" : "bin/node",
  );
}
function runLocal(dir, cmd, extra = []) {
  const r = spawnSync(
    node(dir),
    [path.join(dir, "scripts/local.mjs"), cmd, "--home", state, ...extra],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        PLAYWRIGHT_BROWSERS_PATH: path.join(dir, "browsers"),
      },
    },
  );
  if (r.status !== 0) throw new Error(r.stderr || r.stdout);
  return JSON.parse(r.stdout);
}
function verify(dir) {
  const m = read(path.join(dir, "RELEASE.json")),
    base = fs.realpathSync(dir) + path.sep;
  if (
    m.name !== "laofu-browser" ||
    m.platform !== process.platform ||
    m.arch !== process.arch
  )
    throw new Error("平台/架构不匹配；请使用目标系统实际构建的发行包");
  if (
    !/^[a-zA-Z0-9._-]+$/.test(m.releaseId) ||
    !m.entries ||
    !Number.isInteger(m.schema?.min) ||
    !Number.isInteger(m.schema?.max)
  )
    throw new Error("Invalid release manifest");
  const seen = new Set();
  function walk(folder, rel = "") {
    for (const name of fs.readdirSync(folder)) {
      const file = path.join(folder, name),
        r = path.posix.join(rel, name),
        st = fs.lstatSync(file);
      if (r === "RELEASE.json") continue;
      if (st.isDirectory()) {
        walk(file, r);
        continue;
      }
      const entry = m.entries[r];
      if (!entry) throw new Error("Unlisted release file: " + r);
      if (!fs.realpathSync(file).startsWith(base))
        throw new Error("Release path escapes directory: " + r);
      if (st.isSymbolicLink()) {
        if (fs.readlinkSync(file) !== entry.link)
          throw new Error("Altered symlink: " + r);
      } else if (
        entry.link !== undefined ||
        st.size !== entry.bytes ||
        crypto
          .createHash("sha256")
          .update(fs.readFileSync(file))
          .digest("hex") !== entry.sha256
      )
        throw new Error("Integrity mismatch: " + r);
      seen.add(r);
    }
  }
  walk(dir);
  if (seen.size !== Object.keys(m.entries).length)
    throw new Error("Missing or invalid manifest file");
  return m;
}
function setCurrent(value) {
  const temp = selection + ".tmp";
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(temp, selection);
}
function compatible(dest, m) {
  if (!fs.existsSync(path.join(state, "state.sqlite"))) return;
  const r = spawnSync(
    node(dest),
    [
      "--input-type=module",
      "-e",
      `import Database from ${JSON.stringify(path.join(dest, "node_modules/better-sqlite3/lib/index.js"))};const d=new Database(${JSON.stringify(path.join(state, "state.sqlite"))},{readonly:true});const n=d.pragma('user_version',{simple:true});d.close();if(n<${m.schema.min}||n>${m.schema.max})process.exit(2);`,
    ],
    { encoding: "utf8" },
  );
  if (r.status !== 0)
    throw new Error("现存数据版本不兼容；未切换程序或停止旧服务");
}
if (command === "install") {
  if (!v.source)
    throw new Error("install requires --source extracted-release-directory");
  const source = path.resolve(v.source),
    m = verify(source),
    dest = path.join(releases, m.releaseId);
  if (fs.existsSync(dest)) {
    const existing = verify(dest);
    if (JSON.stringify(existing) !== JSON.stringify(m))
      throw new Error("相同 releaseId 内容不同；拒绝覆盖固定版本");
  } else {
    const stage = dest + ".staging";
    if (fs.existsSync(stage))
      throw new Error("残留 staging 需先核验；不会覆盖");
    fs.cpSync(source, stage, { recursive: true, verbatimSymlinks: true });
    verify(stage);
    fs.renameSync(stage, dest);
  }
  compatible(dest, m);
  if (current?.releaseId === m.releaseId) {
    console.log(
      JSON.stringify({
        installed: m.releaseId,
        unchanged: true,
        prefix,
        state,
      }),
    );
    process.exit(0);
  }
  const wasRunning =
    current &&
    runLocal(current.directory, "status").processes.some((p) => p.running);
  if (current) {
    runLocal(current.directory, "stop");
    runLocal(current.directory, "backup");
  }
  setCurrent({
    releaseId: m.releaseId,
    directory: dest,
    previous: current?.releaseId || null,
  });
  if (wasRunning) {
    try {
      runLocal(dest, "start");
    } catch (e) {
      runLocal(dest, "stop");
      setCurrent(current);
      runLocal(current.directory, "start");
      throw e;
    }
  }
  console.log(
    JSON.stringify({
      installed: m.releaseId,
      prefix,
      state,
      started: !!wasRunning,
    }),
  );
} else if (command === "rollback") {
  const id = v.release || current?.previous;
  if (!id || !/^[a-zA-Z0-9._-]+$/.test(id)) throw new Error("没有可回退版本");
  const target = path.join(releases, id);
  verify(target);
  const r = spawnSync(
    process.execPath,
    [import.meta.filename, "install", "--prefix", prefix, "--source", target],
    { stdio: "inherit" },
  );
  process.exitCode = r.status || 0;
} else if (command === "status") {
  console.log(JSON.stringify({ prefix, state, current }));
} else if (["start", "stop", "backup"].includes(command)) {
  if (!current) throw new Error("尚未安装");
  console.log(
    JSON.stringify(
      runLocal(
        current.directory,
        command,
        command === "start" ? ["--browser"] : [],
      ),
    ),
  );
} else
  throw new Error(
    "Use install --source DIR, start, stop, status, backup, rollback [--release ID]",
  );
