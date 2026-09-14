import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
const root = path.resolve(import.meta.dirname, ".."),
  out = path.join(root, "sdk/typescript");
fs.mkdirSync(path.join(out, "dist"), { recursive: true });
for (const name of ["client", "errors", "util", "types"])
  for (const ext of [".js", ".d.ts"])
    fs.copyFileSync(
      path.join(root, "dist", name + ext),
      path.join(out, "dist", name + ext),
    );
fs.writeFileSync(
  path.join(out, "package.json"),
  JSON.stringify(
    {
      name: "@laofu/browser",
      version: "0.1.0-dev.1",
      type: "module",
      description: "TypeScript client for laofu-browser",
      exports: {
        ".": { types: "./dist/client.d.ts", import: "./dist/client.js" },
      },
      files: ["dist"],
      engines: { node: ">=22" },
      license: "UNLICENSED",
    },
    null,
    2,
  ),
);
const releases = path.join(root, "releases");
fs.mkdirSync(releases, { recursive: true });
const packed = spawnSync("npm", ["pack", "--pack-destination", releases], {
  cwd: out,
  encoding: "utf8",
});
if (packed.status !== 0) throw new Error(packed.stderr);
console.log(packed.stdout.trim());
