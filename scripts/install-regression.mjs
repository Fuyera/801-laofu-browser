import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import http from "node:http";
import { spawnSync } from "node:child_process";
import { BrowserClient } from "../dist/client.js";
const root = path.resolve("."),
  source = path.join(root, "workspace/package-candidate"),
  home = fs.mkdtempSync(path.join(root, "workspace/install-")),
  prefix = path.join(home, "installation"),
  state = path.join(prefix, "state"),
  report = {
    home,
    environment: {
      platform: process.platform,
      arch: process.arch,
      node: process.version,
    },
    checks: [],
  };
const manifest = () =>
    JSON.parse(fs.readFileSync(path.join(source, "RELEASE.json"))),
  original = fs.readFileSync(path.join(source, "RELEASE.json")),
  baseId = manifest().releaseId;
const run = (args, ok = true) => {
  const r = spawnSync(
    process.execPath,
    [path.join(source, "deploy/manage.mjs"), ...args, "--prefix", prefix],
    { encoding: "utf8" },
  );
  if (ok && r.status !== 0) throw new Error(r.stderr || r.stdout);
  return r;
};
const record = (name) => {
  report.checks.push({ name, status: "passed" });
  fs.writeFileSync(
    path.join(home, "report.json"),
    JSON.stringify(report, null, 2),
  );
  console.log("PASS " + name);
};
const server = http.createServer((req, res) => {
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.end(
    "<article><h1>固定包安装验证</h1><p>安装包中的浏览器、扩展和服务需要真实完成采集。</p></article>",
  );
});
await new Promise((r) => server.listen(17968, "127.0.0.1", r));
try {
  run(["install", "--source", source]);
  record("完整性校验和独立目录安装");
  const installed = path.join(prefix, "releases", baseId),
    node = path.join(installed, "node/bin/node"),
    cli = path.join(installed, "dist/cli.js");
  const init = spawnSync(
    node,
    [cli, "init", "--home", state, "--url", "http://127.0.0.1:17967"],
    { encoding: "utf8" },
  );
  assert.equal(init.status, 0, init.stderr);
  run(["start"]);
  record("固定Node/Chromium/扩展启动并实际就绪");
  const owner = JSON.parse(fs.readFileSync(path.join(state, "owner.json"))),
    c = new BrowserClient(owner.url, owner.token),
    profile = (await c.capabilities()).profiles.find((p) => p.ready);
  assert.ok(profile);
  const request = await c.submitTask(
    {
      type: "article.capture@v1",
      profileId: profile.id,
      input: { url: "http://127.0.0.1:17968" },
    },
    "install-capture",
  );
  const job = await c.wait(request.id);
  assert.equal(job.state, "succeeded");
  report.jobId = job.id;
  const upload = path.join(home, "sentinel.txt");
  fs.writeFileSync(upload, "保留文件和已完成任务");
  const artifact = await c.upload(upload);
  record("从安装包运行真实HTTP图文采集和上传");
  const originalReadme = fs.readFileSync(path.join(source, "README.md"));
  fs.appendFileSync(path.join(source, "README.md"), "\nCORRUPTED");
  assert.notEqual(run(["install", "--source", source], false).status, 0);
  fs.writeFileSync(path.join(source, "README.md"), originalReadme);
  assert.equal((await c.job(job.id)).state, "succeeded");
  record("篡改制品拒绝且运行服务不受影响");
  fs.writeFileSync(path.join(source, "unexpected.txt"), "unlisted");
  assert.notEqual(run(["install", "--source", source], false).status, 0);
  fs.unlinkSync(path.join(source, "unexpected.txt"));
  record("清单以外文件拒绝");
  const modified = { ...manifest(), releaseId: baseId + "-upgrade-fixture" };
  fs.writeFileSync(path.join(source, "RELEASE.json"), JSON.stringify(modified));
  run(["install", "--source", source]);
  assert.equal((await c.job(job.id)).state, "succeeded");
  await c.download(artifact.id, path.join(home, "after-upgrade.txt"));
  assert.equal(
    fs.readFileSync(path.join(home, "after-upgrade.txt"), "utf8"),
    "保留文件和已完成任务",
  );
  record("兼容版本切换后任务和产物保留");
  run(["rollback", "--release", baseId]);
  assert.equal((await c.job(job.id)).state, "succeeded");
  record("程序回退保留当前幂等和效果记录");
  const cliFile = path.join(source, "dist/cli.js"),
    beforeCli = fs.readFileSync(cliFile);
  try {
    fs.writeFileSync(cliFile, "throw new Error('simulated-start-failure');");
    const bad = {
      ...modified,
      releaseId: baseId + "-startup-failure-fixture",
      entries: {
        ...modified.entries,
        "dist/cli.js": {
          bytes: fs.statSync(cliFile).size,
          sha256: crypto
            .createHash("sha256")
            .update(fs.readFileSync(cliFile))
            .digest("hex"),
        },
      },
    };
    fs.writeFileSync(path.join(source, "RELEASE.json"), JSON.stringify(bad));
    assert.notEqual(run(["install", "--source", source], false).status, 0);
    assert.equal((await c.job(job.id)).state, "succeeded");
    assert.equal(JSON.parse(run(["status"]).stdout).current.releaseId, baseId);
    record("新版本启动失败自动恢复旧程序");
  } finally {
    fs.writeFileSync(cliFile, beforeCli);
    fs.writeFileSync(path.join(source, "RELEASE.json"), original);
  }
  run(["stop"]);
  run(["backup"]);
  assert.ok(fs.readdirSync(path.join(state, "backups")).length);
  record("确认停止与SQLite在线备份文件生成");
  const serviceOut = path.join(home, "service-files"),
    cfg = fs.readdirSync(state).find((n) => /^worker-.*\.json$/.test(n));
  const generated = spawnSync(
    process.execPath,
    [
      "deploy/service-files.mjs",
      "--root",
      installed,
      "--home",
      state,
      "--config",
      path.join(state, cfg),
      "--output",
      serviceOut,
    ],
    { encoding: "utf8" },
  );
  assert.equal(generated.status, 0, generated.stderr);
  for (const name of fs.readdirSync(serviceOut)) {
    const r = spawnSync("plutil", ["-lint", path.join(serviceOut, name)], {
      encoding: "utf8",
    });
    assert.equal(r.status, 0, r.stdout);
  }
  record("Mac自启动配置语法校验，未注册自启动");
  report.versionFixtures =
    "同一固定程序的两个合成发行标识，以及故意启动失败的测试程序；未声称已有历史正式版本";
  console.log(JSON.stringify(report));
} catch (e) {
  report.error = String(e);
  throw e;
} finally {
  fs.writeFileSync(path.join(source, "RELEASE.json"), original);
  try {
    run(["stop"]);
  } catch {}
  server.close();
  fs.writeFileSync(
    path.join(home, "report.json"),
    JSON.stringify(report, null, 2),
  );
}
