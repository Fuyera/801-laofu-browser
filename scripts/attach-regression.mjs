import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chromium } from "playwright";
import { createServer } from "../dist/server.js";
import { BrowserClient } from "../dist/client.js";
const home = fs.mkdtempSync(path.resolve("workspace/attach-")),
  core = await createServer({ home, port: 17977 }),
  identity = core.store.createProduct("attach test", "owner", ["*"]);
await core.listen();
const c = new BrowserClient("http://127.0.0.1:17977", identity.token),
  pair = await c.request("POST", "/v1/admin/workers", {
    name: "outside lifecycle",
  }),
  config = path.join(home, "worker.json"),
  workerHome = path.join(home, "worker");
fs.writeFileSync(
  config,
  JSON.stringify({
    home: workerHome,
    baseUrl: c.baseUrl,
    workerId: pair.worker.id,
    profileId: pair.profile.id,
    token: pair.token,
    attach: true,
    bridgePort: 18977,
  }),
  { mode: 0o600 },
);
const fd = fs.openSync(path.join(home, "worker.log"), "a", 0o600),
  worker = spawn(
    process.execPath,
    ["dist/cli.js", "worker", "--config", config],
    { stdio: ["ignore", fd, fd] },
  );
fs.closeSync(fd);
let ctx;
const checks = [];
try {
  for (
    let i = 0;
    i < 120 &&
    !fs.existsSync(path.join(workerHome, "engine/extension/laofu-config.js"));
    i++
  )
    await new Promise((r) => setTimeout(r, 100));
  await new Promise((r) => setTimeout(r, 1200));
  assert.equal(
    (await c.capabilities()).profiles.find((p) => p.id === pair.profile.id)
      .ready,
    false,
  );
  assert.equal(worker.exitCode, null);
  checks.push("扩展尚未加载时worker持续等待，未误报就绪");
  const extension = path.join(workerHome, "engine/extension");
  ctx = await chromium.launchPersistentContext(
    path.join(home, "external-browser"),
    {
      channel: "chromium",
      headless: true,
      chromiumSandbox: true,
      ignoreDefaultArgs: ["--disable-extensions"],
      args: [
        `--disable-extensions-except=${extension}`,
        `--load-extension=${extension}`,
      ],
    },
  );
  const page = await ctx.newPage();
  await page.goto("chrome://extensions");
  if (!(await page.locator("#devMode").evaluate((el) => !!el.checked)))
    await page.locator("#devMode").click();
  for (let i = 0; i < 80; i++) {
    if (
      (await c.capabilities()).profiles.find((p) => p.id === pair.profile.id)
        .ready
    )
      break;
    await new Promise((r) => setTimeout(r, 250));
  }
  assert.equal(
    (await c.capabilities()).profiles.find((p) => p.id === pair.profile.id)
      .ready,
    true,
  );
  const session = await c.session(pair.profile.id),
    job = await c.wait(
      (
        await c.command(
          session.id,
          { tool: "tabs", args: { action: "list" } },
          "attached-browser",
        )
      ).id,
    );
  assert.equal(job.state, "succeeded");
  checks.push("外部启动的独立Chrome加载配对扩展后，原始命令成功");
  worker.kill("SIGTERM");
  await new Promise((r) => worker.once("exit", r));
  assert.equal(page.isClosed(), false);
  assert.equal(await page.locator("#devMode").isVisible(), true);
  checks.push("停止worker保留外部浏览器及页面，不关闭用户浏览器");
  console.log(JSON.stringify({ home, checks }));
} finally {
  if (worker.exitCode === null) worker.kill("SIGTERM");
  await ctx?.close();
  await core.app.close();
  fs.writeFileSync(
    path.join(home, "report.json"),
    JSON.stringify(
      {
        home,
        environment: {
          platform: process.platform,
          arch: process.arch,
          node: process.version,
        },
        scope:
          "独立外部浏览器复现日常Chrome的接管生命周期；没有读取真实日常Chrome账号或验证其人工安装",
        checks,
      },
      null,
      2,
    ),
  );
}
