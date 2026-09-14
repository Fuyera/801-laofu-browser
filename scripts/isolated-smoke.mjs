import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createServer } from "../dist/server.js";
import { BrowserClient } from "../dist/client.js";
const root = path.resolve("."),
  home = fs.mkdtempSync(path.join(root, "workspace/isolated-"));
const image = "laofu-browser:0.1.0-dev.1";
const server = await createServer({ home, port: 17911 });
const owner = server.store.createProduct("隔离探针所有者", "owner", ["*"]);
await server.listen();
const c = new BrowserClient("http://127.0.0.1:17911", owner.token);
const pair = await c.request("POST", "/v1/admin/workers", {
  name: "隔离探针",
  mode: "isolated",
});
const prefix = "laofu-" + pair.worker.id.slice(-8),
  network = prefix + "-private",
  gateway = prefix + "-gateway",
  worker = prefix + "-worker";
function docker(args, check = true) {
  const r = spawnSync("docker", args, {
    encoding: "utf8",
    maxBuffer: 5 * 1024 ** 2,
  });
  if (check && r.status !== 0) throw new Error(r.stderr || r.stdout);
  return r.stdout;
}
let keep = process.env.LAOFU_KEEP_PROBE === "1";
try {
  docker(["network", "create", "--internal", network]);
  docker([
    "run",
    "-d",
    "--name",
    gateway,
    "--init",
    "--cap-drop=ALL",
    "--security-opt",
    "no-new-privileges",
    "--read-only",
    "--tmpfs",
    "/tmp:rw,nosuid,nodev,size=64m",
    "--network",
    network,
    "--network-alias",
    "gateway",
    "-e",
    "LAOFU_CORE_URL=http://host.docker.internal:17911",
    image,
    "gateway",
  ]);
  docker(["network", "connect", "bridge", gateway]);
  const cfg = {
    home: "/data/profile",
    baseUrl: "http://gateway:18881",
    workerId: pair.worker.id,
    profileId: pair.profile.id,
    token: pair.token,
    headless: false,
    proxy: "http://gateway:18880",
    bridgePort: 18899,
    vncPort: 5901,
    display: ":98",
  };
  const file = path.join(home, "worker.json");
  fs.writeFileSync(file, JSON.stringify(cfg), { mode: 0o600 });
  docker([
    "run",
    "-d",
    "--name",
    worker,
    "--init",
    "--cap-drop=ALL",
    "--security-opt",
    "no-new-privileges",
    "--security-opt",
    `seccomp=${root}/deploy/docker/seccomp.json`,
    "--shm-size",
    "512m",
    "--network",
    network,
    "--mount",
    `type=bind,src=${file},dst=/data/worker.json`,
    "--entrypoint",
    "node",
    image,
    "scripts/container-entry.mjs",
  ]);
  let ready = false;
  for (let i = 0; i < 120; i++) {
    if ((await c.capabilities()).profiles.some((p) => p.ready)) {
      ready = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!ready)
    throw new Error("worker not ready " + docker(["logs", worker], false));
  const netReport = docker([
    "exec",
    worker,
    "node",
    "scripts/network-probe.mjs",
  ]);
  fs.writeFileSync(path.join(home, "network.json"), netReport);
  const sandbox = docker([
    "exec",
    worker,
    "node",
    "scripts/container-probe.mjs",
  ]);
  fs.writeFileSync(path.join(home, "sandbox.txt"), sandbox);
  const inspection = JSON.parse(docker(["inspect", worker]))[0];
  const checks = {
    ...JSON.parse(netReport.trim().split("\n").at(-1)).checks,
    browserSandbox: sandbox.includes("SANDBOX_PROBE_PASSED"),
    internalNetwork: JSON.parse(docker(["network", "inspect", network]))[0]
      .Internal,
    noSharedDesktop:
      inspection.HostConfig.NetworkMode === network &&
      inspection.Config.User === "node",
  };
  const report = {
    workerId: pair.worker.id,
    profileId: pair.profile.id,
    imageDigest: inspection.Image,
    bootId: (await c.request("GET", "/v1/admin/workers")).items.find(
      (w) => w.id === pair.worker.id,
    ).bootId,
    checks,
  };
  await c.request("POST", `/v1/admin/workers/${pair.worker.id}/attest`, report);
  const product = await c.request("POST", "/v1/admin/products", {
    name: "隔离真实服务调用",
  });
  await c.request("PATCH", `/v1/admin/profiles/${pair.profile.id}`, {
    productIds: [product.product.id],
  });
  const pc = new BrowserClient(c.baseUrl, product.token);
  const task = await pc.submitTask(
    {
      type: "article.capture@v1",
      execution: { profileId: pair.profile.id },
      input: { url: "https://example.com" },
    },
    "isolated-capture",
  );
  const result = await pc.wait(task.id);
  fs.writeFileSync(
    path.join(home, "result.json"),
    JSON.stringify({ report, result }, null, 2),
  );
  console.log(
    JSON.stringify({ home, checks, state: result.state, error: result.error }),
  );
  if (result.state !== "succeeded") throw new Error("isolated capture failed");
} catch (e) {
  fs.writeFileSync(
    path.join(home, "worker.log"),
    docker(["logs", worker], false),
  );
  fs.writeFileSync(
    path.join(home, "gateway.log"),
    docker(["logs", gateway], false),
  );
  throw e;
} finally {
  if (!keep) {
    docker(["rm", "-f", worker, gateway], false);
    docker(["network", "rm", network], false);
  }
  await server.app.close();
}
