import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import WebSocket from "ws";
import { chromium } from "playwright";
import { createServer } from "../dist/server.js";
import { BrowserClient } from "../dist/client.js";
const root = path.resolve("."),
  home = fs.mkdtempSync(path.join(root, "workspace/p4-isolated-"));
const image = process.env.LAOFU_TEST_IMAGE;
if (!image)
  throw Error("LAOFU_TEST_IMAGE must explicitly identify the candidate image");
const dns = process.env.LAOFU_PUBLIC_DNS || "";
const run = (command, args, input, check = true) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "",
      stderr = "";
    child.stdout.on("data", (b) => (stdout += b));
    child.stderr.on("data", (b) => (stderr += b));
    child.on("error", reject);
    child.on("exit", (status) =>
      status && check
        ? reject(Error(stderr || stdout))
        : resolve({ status, stdout, stderr }),
    );
    child.stdin.end(input);
  });
const docker = async (args, check = true) =>
  (await run("docker", args, undefined, check)).stdout;
const wait = async (fn, timeout = 90000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = await fn();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw Error("condition timeout");
};
const server = await createServer({
    home: path.join(home, "service"),
    port: 17991,
  }),
  owner = server.store.createProduct("P4 isolated owner", "owner", ["*"]);
await server.listen();
const c = new BrowserClient("http://127.0.0.1:17991", owner.token);
fs.writeFileSync(
  path.join(home, "owner.json"),
  JSON.stringify({ ...owner, url: c.baseUrl }),
  { mode: 0o600 },
);
const deployments = [],
  identities = [],
  checks = [];
const record = (name, evidence = {}) => {
  checks.push({ name, status: "passed", ...evidence });
  fs.writeFileSync(
    path.join(home, "report.json"),
    JSON.stringify({ home, image, publicDns: dns, checks }, null, 2),
  );
  console.log("PASS " + name);
};
let browser;
try {
  const version = JSON.parse(fs.readFileSync("package.json")).version;
  const sdkDir = path.join(home, "typescript");
  fs.mkdirSync(sdkDir);
  await run("tar", [
    "-xzf",
    path.join(root, "releases", `laofu-browser-${version}.tgz`),
    "-C",
    sdkDir,
  ]);
  const { BrowserClient: PackagedClient } = await import(
    pathToFileURL(path.join(sdkDir, "package/dist/client.js")).href
  );
  await run("python3", ["-m", "venv", path.join(home, "python")]);
  const python = path.join(home, "python/bin/python");
  await run(python, [
    "-m",
    "pip",
    "install",
    "--no-index",
    "--no-deps",
    path.join(
      root,
      "releases",
      `laofu_browser-${version.replace("-dev.", ".dev")}-py3-none-any.whl`,
    ),
  ]);
  const py = async (token, method, args) => {
    const result = await run(
      python,
      [
        "-c",
        "import json,sys;from laofu_browser import BrowserClient,BrowserError\nx=json.load(sys.stdin)\ntry: print(json.dumps({'result':getattr(BrowserClient(x['url'],x['token']),x['method'])(*x['args'])}))\nexcept BrowserError as e: print(json.dumps({'error':{'code':e.code,'status':e.status}}))",
      ],
      JSON.stringify({ url: c.baseUrl, token, method, args }),
    );
    const data = JSON.parse(result.stdout);
    if (data.error) throw Object.assign(Error(data.error.code), data.error);
    return data.result;
  };
  for (const identity of ["A", "B"]) {
    const created = await run(process.execPath, [
      "deploy/isolated.mjs",
      "create",
      "--home",
      home,
      "--name",
      `P4 identity ${identity}`,
      "--image",
      image,
      ...(dns ? ["--dns", dns] : []),
    ]);
    const d = JSON.parse(created.stdout);
    deployments.push(d);
    await wait(async () =>
      (await c.capabilities()).profiles.some(
        (p) => p.id === d.profileId && p.ready,
      ),
    );
    await run(process.execPath, [
      "deploy/isolated.mjs",
      "verify",
      "--home",
      home,
      "--id",
      d.id,
    ]);
    const initial = JSON.parse(
      fs.readFileSync(path.join(home, "isolated", d.id + "-verification.json")),
    );
    assert.equal(Object.values(initial.checks).filter(Boolean).length, 8);
    // Replace only this disposable test worker with the synthetic-page harness; same isolated network and volume.
    await docker(["stop", "--time", "20", d.worker]);
    const stopped = JSON.parse(await docker(["inspect", d.worker]))[0];
    const stopLog = await run("docker", ["logs", d.worker], undefined, false);
    fs.writeFileSync(
      path.join(home, d.id + "-initial-stop.log"),
      stopLog.stdout + stopLog.stderr,
    );
    assert.equal(
      stopped.State.ExitCode,
      0,
      "worker must stop gracefully before profile reuse",
    );
    await docker(["rm", d.worker]);
    await docker([
      "run",
      "-d",
      "--name",
      d.worker,
      "--hostname",
      d.worker,
      "--init",
      "--cap-drop=ALL",
      "--security-opt",
      "no-new-privileges",
      "--security-opt",
      `seccomp=${root}/deploy/docker/seccomp.json`,
      "--shm-size",
      "512m",
      "--memory",
      "2g",
      "--pids-limit",
      "512",
      "--network",
      d.network,
      "--mount",
      `type=volume,src=${d.volume},dst=/data`,
      "-e",
      `LAOFU_FIXTURE_ID=${identity}`,
      "--entrypoint",
      "node",
      image,
      "scripts/fixtures/isolated-worker.mjs",
    ]);
    await wait(async () =>
      (await c.request("GET", "/v1/admin/workers")).items.some(
        (w) =>
          w.id === d.id &&
          w.bootId &&
          w.bootId !== initial.bootId &&
          w.connected,
      ),
    );
    assert.equal(
      (await c.request("GET", "/v1/admin/workers")).items.find(
        (w) => w.id === d.id,
      ).isolationVerified,
      false,
    );
    await run(process.execPath, [
      "deploy/isolated.mjs",
      "verify",
      "--home",
      home,
      "--id",
      d.id,
    ]);
    const report = JSON.parse(
      fs.readFileSync(path.join(home, "isolated", d.id + "-verification.json")),
    );
    record(
      `identity ${identity}: real eight isolation checks and stale boot attestation rejected`,
      {
        checks: report.checks,
        bootId: report.bootId,
        imageDigest: report.imageDigest,
      },
    );
    const p = await c.request("POST", "/v1/admin/products", {
      name: `P4 product ${identity}`,
      limits: { artifactBytes: 16 * 1024 ** 2, maxQueued: 2, maxResident: 3 },
    });
    await c.request("PATCH", `/v1/admin/profiles/${d.profileId}`, {
      productIds: [p.product.id],
    });
    const client =
      identity === "A"
        ? new PackagedClient(c.baseUrl, p.token)
        : {
            request: (...args) => py(p.token, "request", args),
            submitTask: (...args) => py(p.token, "submit_task", args),
            job: (...args) => py(p.token, "job", args),
            wait: (...args) => py(p.token, "wait", args),
            upload: (...args) => py(p.token, "upload", args),
            download: (...args) => py(p.token, "download", args),
            cancel: (...args) => py(p.token, "cancel", args),
            resume: (...args) => py(p.token, "resume", args),
          };
    identities.push({ identity, d, p, client });
    const task = await client.submitTask(
      {
        type: "article.capture@v1",
        execution: { profileId: d.profileId },
        input: { url: "https://example.com" },
      },
      `public-${identity}`,
    );
    const result = await client.wait(task.id);
    assert.equal(result.state, "succeeded", JSON.stringify(result.error));
    record(
      `packaged ${identity === "A" ? "TypeScript" : "Python"} SDK: restricted identity captures actual public website`,
      { jobId: task.id, url: "https://example.com" },
    );
  }
  const [a, b] = identities;
  for (const x of identities)
    await c.request(
      "PUT",
      `/v1/admin/profiles/${x.d.profileId}/account-policy`,
      {
        mode: "required",
        origins: ["https://example.com"],
        selector: "#account",
        expectedHash: crypto
          .createHash("sha256")
          .update(x.identity)
          .digest("hex"),
      },
    );
  const capture = (x, route, key) =>
    x.client.submitTask(
      {
        type: "article.capture@v1",
        execution: { profileId: x.d.profileId },
        input: { url: "https://example.com/__lb_test/" + route },
      },
      key,
    );
  const waiting = await a.client.wait(
    (await capture(a, "login", "login-A")).id,
  );
  assert.equal(waiting.state, "waiting_user");
  await c.request("PUT", `/v1/admin/profiles/${b.d.profileId}/account-policy`, {
    mode: "anonymous",
    origins: [],
  });
  const bResult = await b.client.wait(
    (await capture(b, "article", "parallel-B")).id,
  );
  assert.equal(bResult.state, "succeeded");
  assert.equal(bResult.result.manifest.account.status, "anonymous");
  record(
    "one restricted identity waits for a user while another completes a legal task",
  );
  await assert.rejects(b.client.job(waiting.id), { code: "FORBIDDEN" });
  await assert.rejects(
    b.client.request("POST", "/v1/sessions", { profileId: a.d.profileId }),
    { code: "FORBIDDEN" },
  );
  await assert.rejects(
    b.client.request("POST", `/v1/tasks/${waiting.id}/handoffs`, {}),
    { code: "FORBIDDEN" },
  );
  browser = await chromium.launch({ channel: "chromium", headless: true });
  for (const x of identities) {
    await c.request(
      "PUT",
      `/v1/admin/profiles/${x.d.profileId}/account-policy`,
      {
        mode: "required",
        origins: ["https://example.com"],
        selector: "#account",
        expectedHash: crypto
          .createHash("sha256")
          .update(x.identity)
          .digest("hex"),
      },
    );
    const job =
      x === a
        ? waiting
        : await x.client.wait((await capture(x, "login", "login-B")).id);
    assert.equal(job.state, "waiting_user");
    const context = await browser.newContext({
      locale: "zh-CN",
      viewport: { width: 1600, height: 1200 },
    });
    const page = await context.newPage();
    const issued = [];
    page.on("response", async (response) => {
      if (
        response.url().endsWith(`/tasks/${job.id}/handoffs`) &&
        response.request().method() === "POST" &&
        response.ok()
      )
        issued.push(await response.json());
    });
    await page.goto(
      c.baseUrl +
        "/#bootstrap=" +
        server.store.credential("bootstrap", x.p.product.id, 600000),
    );
    await page.getByRole("button", { name: /等待你接手/ }).click();
    await page.getByRole("button", { name: "打开接手窗口" }).click();
    const canvas = page.locator(".remote canvas");
    await canvas.waitFor({ state: "visible" });
    await wait(async () =>
      canvas.evaluate((el) => el.width > 100 && el.height > 100),
    );
    await canvas.focus();
    await page.keyboard.press("Enter");
    await new Promise((r) => setTimeout(r, 1200));
    assert.equal((await x.client.job(job.id)).state, "waiting_user");
    await page.screenshot({
      path: path.join(home, `handoff-${x.identity}.png`),
      fullPage: true,
    });
    // Simulate transport loss without revoking the handoff: replay must fail because the ticket was consumed.
    for (const viewer of server.broker.viewers.values())
      if (viewer.jobId === job.id) viewer.socket.close();
    await wait(() => server.broker.viewers.size === 0);
    const old = issued[0];
    assert.ok(old?.ticket);
    assert.equal(server.store.get("handoff", old.id).revoked, false);
    const code = await new Promise((resolve, reject) => {
      const ws = new WebSocket(
        c.baseUrl.replace("http", "ws") + `/v1/handoffs/${old.id}/socket`,
        {
          headers: {
            authorization: "Bearer " + x.p.token,
            "x-handoff-ticket": old.ticket,
          },
        },
      );
      ws.once("close", resolve);
      ws.once("error", reject);
    });
    assert.equal(code, 4003);
    await page.getByRole("button", { name: "关闭接手", exact: true }).click();
    await page.getByRole("button", { name: "打开接手窗口" }).click();
    await page.locator(".remote canvas").waitFor({ state: "visible" });
    await page.getByRole("button", { name: "关闭接手", exact: true }).click();
    await x.client.resume(job.id);
    const result = await x.client.wait(job.id);
    assert.equal(result.state, "succeeded", JSON.stringify(result.error));
    assert.equal(result.result.manifest.title, `身份 ${x.identity} 正文`);
    const file = result.artifacts.find((f) => f.filename === "article.md");
    await x.client.download(file.id, path.join(home, `${x.identity}.md`));
    const text = fs.readFileSync(path.join(home, `${x.identity}.md`), "utf8");
    assert.match(text, new RegExp(`仅属于身份 ${x.identity}`));
    assert.doesNotMatch(
      text,
      new RegExp(`仅属于身份 ${x.identity === "A" ? "B" : "A"}`),
    );
    const other = x === a ? b : a;
    await assert.rejects(
      other.client.request("GET", `/v1/artifacts/${file.id}/content`),
      { code: "FORBIDDEN" },
    );
    const input = path.join(home, `${x.identity}.txt`);
    fs.writeFileSync(input, "owned by " + x.identity);
    const uploaded = await x.client.upload(input);
    await x.client.download(
      uploaded.id,
      path.join(home, `${x.identity}-download.txt`),
    );
    assert.equal(
      fs.readFileSync(path.join(home, `${x.identity}-download.txt`), "utf8"),
      "owned by " + x.identity,
    );
    await x.client.request("DELETE", `/v1/artifacts/${uploaded.id}`);
    await assert.rejects(
      x.client.request("GET", `/v1/artifacts/${uploaded.id}/content`),
      { code: "FORBIDDEN" },
    );
    record(
      `identity ${x.identity}: real noVNC input, fresh ticket reconnect, same-task resume, own synthetic cookie/content/file and cross-identity rejection`,
      {
        jobId: job.id,
        evidenceKind: "synthetic fixture rendered in actual isolated Chromium",
      },
    );
    await context.close();
  }
  await c.request("PUT", `/v1/admin/profiles/${a.d.profileId}/account-policy`, {
    mode: "required",
    origins: ["https://example.com"],
    selector: "#account",
    expectedHash: crypto
      .createHash("sha256")
      .update("wrong-account")
      .digest("hex"),
  });
  const mismatch = await a.client.wait(
    (await capture(a, "article", "mismatch")).id,
  );
  assert.equal(mismatch.state, "waiting_user");
  assert.equal(mismatch.artifacts.length, 0);
  const h = await a.client.request(
    "POST",
    `/v1/tasks/${mismatch.id}/handoffs`,
    {},
  );
  await c.request("DELETE", `/v1/admin/products/${a.p.product.id}`);
  await assert.rejects(
    a.client.request("POST", `/v1/tasks/${mismatch.id}/resume`, {}),
    { code: "UNAUTHORIZED" },
  );
  await wait(async () => (await c.job(mismatch.id)).state === "cancelled");
  assert.equal(server.broker.viewers.size, 0);
  const revoked = await new Promise((resolve) => {
    const ws = new WebSocket(
      c.baseUrl.replace("http", "ws") + `/v1/handoffs/${h.id}/socket`,
      {
        headers: {
          authorization: "Bearer " + a.p.token,
          "x-handoff-ticket": h.ticket,
        },
      },
    );
    ws.once("close", resolve);
    ws.once("unexpected-response", (_req, res) => {
      res.resume();
      resolve(res.statusCode);
    });
    ws.on("error", () => {});
  });
  assert.ok([401, 4003, 1006].includes(revoked));
  assert.equal(
    (await b.client.request("GET", "/v1/me")).product.revoked,
    false,
  );
  record(
    "account mismatch publishes no content; identity revocation cancels its task and invalidates old ticket without revoking peer",
  );
} finally {
  await browser?.close();
  for (const d of deployments) {
    for (const kind of ["worker", "gateway"]) {
      const log = await run("docker", ["logs", d[kind]], undefined, false);
      fs.writeFileSync(
        path.join(home, d.id + "-" + kind + ".log"),
        log.stdout + log.stderr,
        { mode: 0o600 },
      );
    }
    await docker(
      [
        "cp",
        `${d.worker}:/data/profile/logs`,
        path.join(home, d.id + "-internal-logs"),
      ],
      false,
    );
    await docker(["rm", "-f", d.worker, d.gateway], false);
    await docker(["network", "rm", d.network], false);
    await docker(["volume", "rm", d.volume], false);
  }
  await server.app.close();
}
console.log(JSON.stringify({ home, passed: checks.length }));
