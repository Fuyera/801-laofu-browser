import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";
const { values: v } = parseArgs({
  options: {
    base: { type: "string" },
    tag: { type: "string" },
    commit: { type: "string" },
  },
});
if (![v.base, v.tag].every((x) => x && /^[a-zA-Z0-9_.:/@-]+$/.test(x)))
  throw Error("--base EXISTING_IMAGE --tag CANDIDATE_TAG required");
const run = (command, args) => {
  const r = spawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: 8 * 1024 ** 2,
  });
  if (r.status !== 0) throw Error(r.stderr || r.stdout);
  return r.stdout;
};
const commit = v.commit || run("git", ["rev-parse", "HEAD"]).trim();
const sourceDirty = !!run("git", ["status", "--porcelain"]).trim();
if (!/^[a-f0-9]{40}$/.test(commit))
  throw Error("explicit source commit must be a full git hash");
if (commit !== run("git", ["rev-parse", "HEAD"]).trim())
  throw Error(
    "source commit must match the current checkout; switch checkout before building another commit",
  );
const base = JSON.parse(run("docker", ["image", "inspect", v.base]))[0];
const dependencies = JSON.parse(
  run("docker", [
    "run",
    "--rm",
    "--network",
    "none",
    "--entrypoint",
    "node",
    v.base,
    "-e",
    "const p=require('/app/package.json');console.log(JSON.stringify({dependencies:p.dependencies,devDependencies:p.devDependencies}));",
  ]),
);
const pkg = JSON.parse(fs.readFileSync("package.json"));
if (
  JSON.stringify(dependencies) !==
  JSON.stringify({
    dependencies: pkg.dependencies,
    devDependencies: pkg.devDependencies,
  })
)
  throw Error(
    "offline base dependencies differ; build from deploy/docker/Dockerfile instead",
  );
const out = fs.mkdtempSync(path.resolve("workspace/container-build-"));
const file = path.join(out, "Dockerfile");
fs.writeFileSync(
  file,
  `FROM ${v.base}\nUSER root\nENV LAOFU_BUILD_COMMIT=${commit} LAOFU_BUILD_DIRTY=${sourceDirty}\nCOPY package.json package-lock.json tsconfig.json AGENTS.md README.md CURRENT_CONTEXT.md NOTICE.md /app/\nCOPY src /app/src\nCOPY web /app/web\nCOPY scripts /app/scripts\nCOPY docs /app/docs\nCOPY vendor /app/vendor\nCOPY sdk /app/sdk\nCOPY deploy /app/deploy\nCOPY test /app/test\nCOPY examples /app/examples\nCOPY bin /app/bin\nRUN npm run build\nUSER node\nLABEL org.opencontainers.image.revision="${commit}"\n`,
);
const build = run("docker", [
  "build",
  "--pull=false",
  "--network=none",
  "-f",
  file,
  "-t",
  v.tag,
  ".",
]);
fs.writeFileSync(path.join(out, "build.log"), build);
if (JSON.parse(run("docker", ["image", "inspect", v.base]))[0].Id !== base.Id)
  throw Error("base image changed during build");
const result = JSON.parse(run("docker", ["image", "inspect", v.tag]))[0];
const report = {
  sourceCommit: commit,
  sourceDirty: !!run("git", ["status", "--porcelain"]).trim(),
  baseImage: base.Id,
  image: result.Id,
  tag: v.tag,
  directory: out,
};
fs.writeFileSync(
  path.join(out, "report.json"),
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report));
