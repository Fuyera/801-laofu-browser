import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { chromium } from "playwright";
const root = path.resolve(import.meta.dirname, ".."),
  version = JSON.parse(
    fs.readFileSync(path.join(root, "package.json")),
  ).version;
if (process.platform !== "darwin" || process.arch !== "arm64")
  throw new Error(
    "This local binary packager currently targets macOS arm64; other platforms must build natively.",
  );
const staging = process.argv.includes("--staging");
const revision = spawnSync("git", ["rev-parse", "HEAD"], {
  cwd: root,
  encoding: "utf8",
});
const changes = spawnSync("git", ["status", "--porcelain"], {
  cwd: root,
  encoding: "utf8",
});
const source = {
  commit: revision.status === 0 ? revision.stdout.trim() : null,
  dirty: changes.status === 0 ? changes.stdout.trim().length > 0 : null,
};
const dir = path.join(
  root,
  staging ? "workspace" : "releases",
  staging ? "package-candidate" : `laofu-browser-${version}-macos-arm64`,
);
if (fs.existsSync(dir))
  throw new Error("发行目录已存在；使用新的发行版本或先归档本次生成的临时目录");
fs.mkdirSync(dir, { recursive: true });
for (const name of [
  "AGENTS.md",
  "CURRENT_CONTEXT.md",
  "README.md",
  "NOTICE.md",
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "src",
  "web",
  "scripts",
  "test",
  "bin",
  "deploy",
  "docs",
  "dist",
  "vendor",
  "runtime/engine",
  "sdk",
  "examples",
  "node_modules",
]) {
  if (fs.existsSync(path.join(root, name)))
    fs.cpSync(path.join(root, name), path.join(dir, name), {
      recursive: true,
      verbatimSymlinks: true,
    });
}
fs.cpSync(
  path.dirname(path.dirname(process.execPath)),
  path.join(dir, "node"),
  { recursive: true, verbatimSymlinks: true },
);
const exe = chromium.executablePath(),
  cache = exe.slice(0, exe.indexOf("/chromium-"));
const browserDir = exe.slice(0, exe.indexOf("/chrome-mac-arm64/"));
fs.mkdirSync(path.join(dir, "browsers"));
fs.cpSync(browserDir, path.join(dir, "browsers", path.basename(browserDir)), {
  recursive: true,
  verbatimSymlinks: true,
});
for (const name of fs.readdirSync(cache).filter((n) => n.startsWith("ffmpeg-")))
  fs.cpSync(path.join(cache, name), path.join(dir, "browsers", name), {
    recursive: true,
    verbatimSymlinks: true,
  });
fs.mkdirSync(path.join(dir, "releases"), { recursive: true });
for (const file of [`laofu-browser-${version}.tgz`, "laofu_browser-0.1.0.dev1-py3-none-any.whl"]) {
  fs.copyFileSync(path.join(root, "releases", file), path.join(dir, "releases", file));
}
const entries = {};
function walk(base, rel = "") {
  for (const name of fs.readdirSync(base)) {
    const full = path.join(base, name),
      r = path.posix.join(rel, name),
      st = fs.lstatSync(full);
    if (st.isSymbolicLink()) entries[r] = { link: fs.readlinkSync(full) };
    else if (st.isDirectory()) walk(full, r);
    else
      entries[r] = {
        bytes: st.size,
        sha256: crypto
          .createHash("sha256")
          .update(fs.readFileSync(full))
          .digest("hex"),
      };
  }
}
walk(dir);
const release = {
  name: "laofu-browser",
  version,
  releaseId: `${version}-macos-arm64`,
  builtAt: new Date().toISOString(),
  platform: "darwin",
  arch: "arm64",
  node: process.version,
  playwright: "1.63.0",
  upstream: "huashu-chrome@1.2.0",
  schema: { min: 1, max: 1 },
  stage: "development; P4/P5 gates remain in acceptance report",
  source,
  entries,
};
fs.writeFileSync(
  path.join(dir, "RELEASE.json"),
  JSON.stringify(release, null, 2),
);
if (staging) {
  console.log(
    JSON.stringify({
      directory: dir,
      files: Object.keys(entries).length,
      staging: true,
    }),
  );
  process.exit(0);
}
const archive = dir + ".tar.gz",
  r = spawnSync(
    "tar",
    ["-czf", archive, "-C", path.dirname(dir), path.basename(dir)],
    { stdio: "inherit" },
  );
if (r.status !== 0) throw new Error("archive failed");
const digest = crypto.createHash("sha256");
for await (const chunk of fs.createReadStream(archive)) digest.update(chunk);
const sha = digest.digest("hex");
fs.writeFileSync(archive + ".sha256", `${sha}  ${path.basename(archive)}\n`);
console.log(
  JSON.stringify({
    directory: dir,
    archive,
    sha256: sha,
    files: Object.keys(entries).length,
  }),
);
