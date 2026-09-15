import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
const root = path.resolve(import.meta.dirname, "..");
const git = (...args) => {
  const r = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : null;
};
const version = JSON.parse(
  fs.readFileSync(path.join(root, "package.json")),
).version;
const changes = git("status", "--porcelain");
const record = {
  version,
  commit: process.env.LAOFU_BUILD_COMMIT || git("rev-parse", "HEAD"),
  dirty:
    process.env.LAOFU_BUILD_DIRTY === undefined
      ? changes === null
        ? null
        : !!changes
      : process.env.LAOFU_BUILD_DIRTY === "true",
  builtAt: new Date().toISOString(),
};
fs.mkdirSync(path.join(root, "runtime"), { recursive: true });
fs.writeFileSync(
  path.join(root, "runtime/build.json"),
  JSON.stringify(record, null, 2) + "\n",
);
console.log(JSON.stringify({ build: record }));
