import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
const input = process.argv[2],
  output = process.argv[3];
if (!input || !output)
  throw Error("Usage: collect-evidence.mjs RUN_MANIFEST.json OUTPUT_DIRECTORY");
const manifest = JSON.parse(fs.readFileSync(input));
if (!Array.isArray(manifest.reports) || !manifest.reports.length)
  throw Error("explicit reports list required");
const out = path.resolve(output);
fs.mkdirSync(out, { recursive: true });
const index = [];
for (const entry of manifest.reports) {
  if (
    !/^[a-zA-Z0-9_-]+$/.test(entry.name) ||
    !entry.source ||
    !entry.scope ||
    !["passed", "failed", "partial", "not_run"].includes(entry.status)
  )
    throw Error("report must declare name, source, scope and verified status");
  const bytes = fs.readFileSync(entry.source);
  JSON.parse(bytes);
  fs.writeFileSync(path.join(out, entry.name + ".json"), bytes);
  index.push({
    ...entry,
    file: entry.name + ".json",
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
  });
}
fs.writeFileSync(
  path.join(out, "index.json"),
  JSON.stringify(
    {
      collectedAt: new Date().toISOString(),
      sourceCommit: manifest.sourceCommit || null,
      reports: index,
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    reports: index.length,
    output: out,
    requirementStatusChanged: false,
  }),
);
