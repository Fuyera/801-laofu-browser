import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chromium } from "playwright";
import { createServer } from "../dist/server.js";
import { BrowserClient } from "../dist/client.js";
const root = path.resolve("."),
  home = fs.mkdtempSync(path.join(root, "workspace/handoff-")),
  name = "lb-handoff-" + Date.now(),
  image = process.env.LAOFU_TEST_IMAGE || "laofu-browser:0.1.0-dev.1";
let clicks = 0;
const fixture = http.createServer((req, res) => {
  res.setHeader("content-type", "text/html; charset=utf-8");
  if (req.url === "/article") {
    clicks++;
    res.end(
      "<title>接手后文章</title><article><h1>接手验证完成</h1><p>" +
        "这篇本机测试文章验证远程接手后的同一浏览器状态。".repeat(20) +
        "</p></article>",
    );
  } else
    res.end(
      "<title>请先登录</title><style>body{font:24px system-ui;padding:50px;background:#e4f3f4}button{font:24px system-ui;padding:20px;background:#176d80;color:white}</style><h1>请先登录</h1><p>这是自建接手测试，不使用真实账号。</p><button autofocus onclick=\"location.href='/article'\">进入测试文章</button>",
    );
});
await new Promise((r) => fixture.listen(17972, "127.0.0.1", r));
const server = await createServer({ home, port: 17971 }),
  o = server.store.createProduct("接手验收", "owner", ["*"]);
await server.listen();
const c = new BrowserClient("http://127.0.0.1:17971", o.token),
  results = [];
function docker(args, check = true) {
  const r = spawnSync("docker", args, {
    encoding: "utf8",
    maxBuffer: 1024 ** 2 * 4,
  });
  if (check && r.status !== 0) throw new Error(r.stderr || r.stdout);
  return r.stdout;
}
const wait = async (fn, ms = 60000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("timeout");
};
let browser;
try {
  const pair = await c.request("POST", "/v1/admin/workers", {
    name: "容器接手浏览器",
    mode: "owner",
  });
  const cfg = {
    home: "/data/profile",
    baseUrl: "http://host.docker.internal:17971",
    workerId: pair.worker.id,
    profileId: pair.profile.id,
    token: pair.token,
    headless: false,
    bridgePort: 18899,
    display: ":98",
    vncPort: 5901,
  };
  const file = path.join(home, "worker.json");
  fs.writeFileSync(file, JSON.stringify(cfg), { mode: 0o600 });
  docker([
    "run",
    "-d",
    "--name",
    name,
    "--init",
    "--cap-drop=ALL",
    "--security-opt",
    "no-new-privileges",
    "--security-opt",
    `seccomp=${root}/deploy/docker/seccomp.json`,
    "--shm-size",
    "512m",
    "--mount",
    `type=bind,src=${file},dst=/data/worker.json`,
    "--entrypoint",
    "node",
    image,
    "scripts/container-entry.mjs",
  ]);
  await wait(async () =>
    (await c.capabilities()).profiles.some((p) => p.ready),
  );
  const j = await c.submitTask(
    {
      type: "article.capture@v1",
      execution: { profileId: pair.profile.id },
      input: { url: "http://host.docker.internal:17972/login" },
    },
    "handoff",
  );
  let waiting;
  await wait(async () => {
    waiting = await c.job(j.id);
    return waiting.state === "waiting_user";
  });
  assert.equal(clicks, 0);
  browser = await chromium.launch({ channel: "chromium", headless: true });
  const context = await browser.newContext({
      locale: "zh-CN",
      viewport: { width: 1600, height: 1200 },
    }),
    page = await context.newPage();
  await page.goto(
    c.baseUrl +
      "/#bootstrap=" +
      server.store.credential("bootstrap", o.product.id, 600000),
  );
  await page.getByRole("button", { name: /等待你接手/ }).click();
  await page.getByRole("button", { name: "打开接手窗口" }).click();
  const canvas = page.locator(".remote canvas");
  await canvas.waitFor({ state: "visible" });
  await wait(
    async () =>
      await canvas.evaluate((el) => el.width > 100 && el.height > 100),
  );
  await page.screenshot({
    path: path.join(home, "vnc-connected.png"),
    fullPage: true,
  });
  await canvas.focus();
  await page.keyboard.press("Enter");
  await wait(() => clicks === 1);
  assert.equal(
    (await c.job(j.id)).state,
    "waiting_user",
    "human input must not implicitly resume automation",
  );
  await page.getByRole("button", { name: "关闭接手", exact: true }).click();
  assert.equal((await c.job(j.id)).state, "waiting_user");
  await page.getByRole("button", { name: "打开接手窗口" }).click();
  await page.locator(".remote canvas").waitFor({ state: "visible" });
  assert.equal(clicks, 1);
  await page.getByRole("button", { name: "关闭接手", exact: true }).click();
  await page.getByRole("button", { name: "已完成，继续任务" }).click();
  const completed = await c.wait(j.id);
  assert.equal(completed.state, "succeeded", JSON.stringify(completed.error));
  assert.equal(completed.result.manifest.title, "接手后文章");
  assert.equal(clicks, 1);
  assert.equal(server.broker.viewers.size, 0);
  results.push({
    case: "real noVNC keyboard input, disconnect/reconnect same headed browser, explicit resume, no duplicated fixture action",
    passed: true,
    jobId: j.id,
  });
  console.log("noVNC input, reconnect and explicit resume passed");
  const session = await c.session(pair.profile.id);
  const askTab = await c.wait(
    (
      await c.command(
        session.id,
        {
          tool: "tabs",
          args: {
            action: "new",
            url: "http://host.docker.internal:17972/article",
            label: "ask 验收",
          },
        },
        "ask-tab",
      )
    ).id,
  );
  const askTabId = Number(
    /\[(\d+)\]/.exec(
      askTab.result.content.map((x) => x.text || "").join("\n"),
    )?.[1],
  );
  assert.ok(askTabId);
  const ask = await c.command(
    session.id,
    {
      tool: "ask",
      args: {
        prompt: "确认接手状态",
        timeout: 30000,
        tabId: askTabId,
      },
    },
    "ask-handoff",
  );
  await wait(async () => (await c.job(ask.id)).state === "waiting_user");
  await c.request("POST", `/v1/tasks/${ask.id}/resume`, {});
  let ended;
  await wait(async () => {
    ended = await c.job(ask.id);
    return ["succeeded", "failed", "cancelled"].includes(ended.state);
  });
  assert.equal(ended.state, "succeeded");
  assert.equal(ended.result._meta["laofu.output"].outcome, "continued");
  const askCancel = await c.command(
    session.id,
    {
      tool: "ask",
      args: {
        prompt: "取消测试",
        timeout: 30000,
        tabId: askTabId,
      },
    },
    "ask-cancel",
  );
  await wait(async () => (await c.job(askCancel.id)).state === "waiting_user");
  await c.cancel(askCancel.id);
  await wait(async () => (await c.job(askCancel.id)).state === "cancelled");
  results.push({
    case: "raw ask durable wait, explicit continue, cancellation mapped to command outcome",
    passed: true,
  });
  fs.writeFileSync(
    path.join(home, "report.json"),
    JSON.stringify(
      {
        home,
        scope:
          "owner container handoff only; not a restricted product network attestation",
        results,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ home, results }));
} finally {
  await browser?.close();
  fs.writeFileSync(
    path.join(home, "worker.log"),
    docker(["logs", name], false),
  );
  docker(["rm", "-f", name], false);
  await server.app.close();
  await new Promise((r) => fixture.close(r));
}
