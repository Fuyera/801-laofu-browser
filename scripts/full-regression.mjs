import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
const out = fs.mkdtempSync(path.resolve("workspace/full-regression-"));
if (!process.env.LAOFU_TEST_IMAGE || !process.env.LAOFU_PACKAGE_CANDIDATE)
  throw Error(
    "Set LAOFU_TEST_IMAGE and LAOFU_PACKAGE_CANDIDATE to explicit test candidates",
  );
const sourceCommit = spawnSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
}).stdout.trim();
const results = [];
const sourceDirty = !!spawnSync("git", ["status", "--porcelain"], {
  encoding: "utf8",
}).stdout.trim();
const save = (active = null) =>
  fs.writeFileSync(
    path.join(out, "report.json"),
    JSON.stringify(
      { home: out, sourceCommit, sourceDirty, active, results },
      null,
      2,
    ),
  );
async function run(name, args, prefix, report, env = {}) {
  const before = new Set(fs.readdirSync("workspace")),
    startedAt = new Date().toISOString();
  console.log(JSON.stringify({ name, state: "running", startedAt }));
  save({ name, startedAt, log: name + ".log" });
  const fd = fs.openSync(path.join(out, name + ".log"), "w", 0o600);
  const child = spawn(process.execPath, args, {
    stdio: ["ignore", fd, fd],
    env: {
      ...process.env,
      PATH: path.dirname(process.execPath) + ":" + process.env.PATH,
      ...env,
    },
  });
  fs.closeSync(fd);
  const exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
  const directories = prefix
    ? fs
        .readdirSync("workspace")
        .filter((name) => name.startsWith(prefix) && !before.has(name))
        .map((name) => "workspace/" + name)
    : [];
  const row = {
    name,
    args,
    sourceCommit,
    startedAt,
    finishedAt: new Date().toISOString(),
    exitCode,
    status: exitCode === 0 ? "passed" : "failed",
    reports: directories
      .map((dir) => dir + "/" + report)
      .filter((file) => fs.existsSync(file)),
  };
  results.push(row);
  save();
  console.log(JSON.stringify(row));
  return exitCode;
}
await run("typecheck", ["node_modules/typescript/bin/tsc", "--noEmit"]);
await run("baseline", ["scripts/verify-baseline.mjs"]);
await run("unit", [
  "--import",
  "tsx",
  "--test",
  ...fs
    .readdirSync("test")
    .filter((name) => name.endsWith(".test.ts"))
    .map((name) => "test/" + name),
]);
await run("contract", ["scripts/export-contract.mjs"]);
await run("adversarial-browser", ["--import", "tsx", "scripts/adversarial-browser-regression.mjs"], "adversarial-fixes-browser-", "report.json");
await run("adversarial-docker", ["scripts/adversarial-docker-regression.mjs"]);
for (const [name, script, prefix, file] of [
  ["smoke", "smoke", "smoke-", "result.json"],
  ["tools", "tool-regression", "tools-", "report.json"],
  ["parity", "upstream-parity", "parity-", "report.json"],
  ["article", "article-console-regression", "article-console-", "report.json"],
  ["faults", "fault-regression", "faults-", "report.json"],
  ["sdk", "sdk-smoke", "sdk-", "report.json"],
  ["attach", "attach-regression", "attach-", "report.json"],
  [
    "compatibility-edge",
    "compatibility-edge-regression",
    "compat-edge-",
    "report.json",
  ],
  ["downloads", "download-regression", "download-", "report.json"],
  ["handoff", "handoff-regression", "handoff-", "report.json"],
  ["p4-runtime", "p4-runtime-regression", "p4-runtime-", "report.json"],
  ["p4-isolated", "p4-isolated-regression", "p4-isolated-", "report.json"],
  ["install", "install-regression", "install-", "report.json"],
])
  await run(name, ["scripts/" + script + ".mjs"], prefix, file);
if (process.env.LAOFU_CODEX_BINARY)
  await run(
    "codex-host",
    ["scripts/codex-host-regression.mjs"],
    "codex-host-",
    "report.json",
  );
const state = path.join(out, "performance-state");
await run("performance-init", [
  "dist/cli.js",
  "init",
  "--home",
  state,
  "--url",
  "http://127.0.0.1:17989",
]);
try {
  if (
    (await run("performance-start", [
      "scripts/local.mjs",
      "start",
      "--browser",
      "--headless",
      "--home",
      state,
    ])) === 0
  )
    await run(
      "performance",
      ["scripts/performance-probe.mjs"],
      "performance-",
      "report.json",
      { LAOFU_TEST_STATE: state },
    );
} finally {
  await run("performance-stop", ["scripts/local.mjs", "stop", "--home", state]);
}
console.log(
  JSON.stringify({
    home: out,
    passed: results.filter((r) => r.status === "passed").length,
    total: results.length,
  }),
);
if (results.some((r) => r.status !== "passed")) process.exitCode = 1;
