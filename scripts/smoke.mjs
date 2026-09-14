import fs from "node:fs";
import sharp from "sharp";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { createServer } from "../dist/server.js";
import { BrowserClient } from "../dist/client.js";
const home = fs.mkdtempSync(path.resolve("workspace/smoke-"));
const s = await createServer({ home, port: 17901 });
const owner = s.store.createProduct("smoke", "owner", ["*"]);
await s.listen();
const client = new BrowserClient("http://127.0.0.1:17901", owner.token);
let child;
const png = await sharp({
  create: { width: 16, height: 16, channels: 3, background: "#176d80" },
})
  .png()
  .toBuffer();
const fixture = http.createServer((req, res) => {
  if (req.url === "/image.png") {
    res.setHeader("content-type", "image/png");
    res.end(png);
    return;
  }
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.end(
    "<!doctype html><title>真实采集测试</title><article><h1>真实采集测试</h1><p>" +
      "这是采集验证正文，保留段落与顺序。".repeat(15) +
      '</p><img src="/image.png" alt="测试图片"><pre><code>const answer = 42;</code></pre><table><tr><th>项目</th><th>结果</th></tr><tr><td>采集</td><td>已执行</td></tr></table></article>',
  );
});
await new Promise((r) => fixture.listen(17902, "127.0.0.1", r));
try {
  const pair = await client.request("POST", "/v1/admin/workers", {
    name: "smoke owner",
    mode: "owner",
  });
  const config = {
    home: path.join(home, "worker"),
    baseUrl: client.baseUrl,
    workerId: pair.worker.id,
    profileId: pair.profile.id,
    token: pair.token,
    headless: true,
    bridgePort: 18901,
  };
  fs.writeFileSync(path.join(home, "worker.json"), JSON.stringify(config), {
    mode: 0o600,
  });
  const log = fs.openSync(path.join(home, "worker.log"), "a");
  child = spawn(
    process.execPath,
    ["dist/cli.js", "worker", "--config", path.join(home, "worker.json")],
    { stdio: ["ignore", log, log], env: { ...process.env, LAOFU_DEBUG: "1" } },
  );
  fs.closeSync(log);
  let ready = false;
  for (let i = 0; i < 180; i++) {
    if (child.exitCode !== null)
      throw new Error(
        "worker exited: " +
          fs.readFileSync(path.join(home, "worker.log"), "utf8"),
      );
    if ((await client.capabilities()).profiles.some((p) => p.ready)) {
      ready = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!ready)
    throw new Error(
      "worker not ready " +
        fs.readFileSync(path.join(home, "worker.log"), "utf8"),
    );
  const session = await client.session(pair.profile.id);
  const status = await client.command(
    session.id,
    { tool: "status", args: { text: "采集测试" } },
    "status",
  );
  console.log("status", JSON.stringify(await client.wait(status.id)));
  const task = await client.submitTask(
    {
      type: "article.capture@v1",
      execution: { profileId: pair.profile.id },
      input: { url: "http://127.0.0.1:17902" },
      limits: { maxSteps: 100 },
    },
    "capture",
  );
  const result = await client.wait(task.id);
  fs.writeFileSync(
    path.join(home, "result.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(
    JSON.stringify({
      home,
      state: result.state,
      error: result.error,
      manifest: result.result?.manifest,
    }),
  );
  if (result.state !== "succeeded") throw new Error("capture did not succeed");
  const zip = result.artifacts.find((a) => a.filename.endsWith(".zip"));
  await client.download(zip.id, path.join(home, "article.zip"));
  console.log("real service capture and artifact hash passed");
} finally {
  if (child && child.exitCode === null) {
    child.kill("SIGTERM");
    await new Promise((r) => {
      child.once("exit", r);
      setTimeout(() => {
        child.kill("SIGKILL");
        r();
      }, 10000).unref();
    });
  }
  await s.app.close();
  await new Promise((r) => fixture.close(r));
}
