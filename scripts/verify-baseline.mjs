import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
const root = path.resolve(import.meta.dirname, "..");
const manifest = JSON.parse(
  fs.readFileSync(path.join(root, "docs/LAOFU_BROWSER_BASELINE.json"), "utf8"),
);
for (const [file, digest] of Object.entries(manifest.files)) {
  const got = createHash("sha256")
    .update(
      fs.readFileSync(path.join(root, "vendor/huashu-chrome-1.2.0", file)),
    )
    .digest("hex");
  if (got !== digest) throw new Error(`Upstream changed: ${file}`);
}
console.log(
  JSON.stringify({
    verifiedFiles: Object.keys(manifest.files).length,
    tools: manifest.tools.length,
    upstream: manifest.baseline,
  }),
);
