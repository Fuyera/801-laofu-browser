import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import assert from "node:assert/strict";
const directory = path.resolve(process.argv[2] || "");
if (!process.argv[2])
  throw Error("Usage: node scripts/verify-release.mjs RELEASE_DIRECTORY");
const release = JSON.parse(
  fs.readFileSync(path.join(directory, "RELEASE.json")),
);
const seen = new Set();
function walk(base, prefix = "") {
  for (const name of fs.readdirSync(base)) {
    const rel = path.posix.join(prefix, name),
      full = path.join(base, name);
    if (rel === "RELEASE.json") continue;
    const stat = fs.lstatSync(full);
    if (stat.isDirectory()) {
      walk(full, rel);
      continue;
    }
    const entry = release.entries[rel];
    assert.ok(entry, "unlisted file: " + rel);
    seen.add(rel);
    if (stat.isSymbolicLink())
      assert.equal(fs.readlinkSync(full), entry.link, rel);
    else {
      assert.equal(stat.size, entry.bytes, rel);
      assert.equal(
        crypto.createHash("sha256").update(fs.readFileSync(full)).digest("hex"),
        entry.sha256,
        rel,
      );
    }
  }
}
walk(directory);
assert.equal(
  seen.size,
  Object.keys(release.entries).length,
  "missing release entries",
);
const pkg = JSON.parse(fs.readFileSync(path.join(directory, "package.json")));
assert.equal(pkg.version, release.version);
assert.ok(release.source.commit);
const build = JSON.parse(
  fs.readFileSync(path.join(directory, "runtime/build.json")),
);
assert.equal(build.version, release.version);
assert.equal(build.commit, release.source.commit);
assert.equal(build.dirty, release.source.dirty);
console.log(
  JSON.stringify({
    directory,
    releaseId: release.releaseId,
    source: release.source,
    verifiedFiles: seen.size,
    status: "passed",
  }),
);
