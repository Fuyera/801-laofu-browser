import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import net from "node:net";
import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";
import { BrowserClient } from "../dist/client.js";
const { values: v, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    home: { type: "string" },
    name: { type: "string" },
    id: { type: "string" },
    image: { type: "string" },
    dns: { type: "string" },
  },
});
const root = path.resolve(import.meta.dirname, ".."),
  home = path.resolve(
    v.home ||
      process.env.LAOFU_HOME ||
      path.join(os.homedir(), ".laofu-browser"),
  ),
  command = positionals[0] || "list",
  dir = path.join(home, "isolated");
fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
const read = (f) => JSON.parse(fs.readFileSync(f, "utf8")),
  owner = read(path.join(home, "owner.json")),
  c = new BrowserClient(owner.url, owner.token);
function docker(args, check = true, input) {
  const r = spawnSync("docker", args, {
    encoding: "utf8",
    input,
    maxBuffer: 10 * 1024 ** 2,
  });
  if (check && r.status !== 0) throw new Error(r.stderr || r.stdout);
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}
function record() {
  if (!v.id || !/^wrk_[a-f0-9]+$/.test(v.id))
    throw new Error("--id WORKER_ID required");
  return read(path.join(dir, v.id + ".json"));
}
if (command === "create") {
  if (process.platform !== "darwin")
    throw new Error(
      "本部署器当前仅验收 Docker Desktop/macOS；Linux服务器须先完成P5网络入口验收",
    );
  const image = v.image || "laofu-browser:0.1.0-dev.1";
  const dnsServers = v.dns ? v.dns.split(",").map((x) => x.trim()) : [];
  if (dnsServers.some((x) => !net.isIP(x)))
    throw new Error("--dns 只接受明确配置的 DNS IP 地址，以逗号分隔");
  const imageId = JSON.parse(docker(["image", "inspect", image]).stdout)[0].Id;
  const pair = await c.request("POST", "/v1/admin/workers", {
      name: v.name || "受限产品浏览器",
      mode: "isolated",
    }),
    prefix = "laofu-" + pair.worker.id.slice(-12),
    network = prefix + "-private",
    gateway = prefix + "-gateway",
    worker = prefix + "-worker",
    volume = prefix + "-data";
  const deployment = {
    id: pair.worker.id,
    profileId: pair.profile.id,
    image,
    imageId,
    dnsServers,
    network,
    gateway,
    worker,
    volume,
    createdAt: new Date().toISOString(),
  };
  const file = path.join(dir, pair.worker.id + ".json");
  fs.writeFileSync(file, JSON.stringify(deployment, null, 2), { mode: 0o600 });
  try {
    docker(["network", "create", "--internal", network]);
    docker(["volume", "create", volume]);
    const config = {
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
    docker(
      [
        "run",
        "--rm",
        "-i",
        "--network",
        "none",
        "--mount",
        `type=volume,src=${volume},dst=/data`,
        "--entrypoint",
        "node",
        image,
        "-e",
        "const fs=require('fs');let s='';process.stdin.on('data',c=>s+=c);process.stdin.on('end',()=>fs.writeFileSync('/data/worker.json',s,{mode:0o600}));",
      ],
      true,
      JSON.stringify(config),
    );
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
      "--memory",
      "256m",
      "--cpus",
      "1",
      "--network",
      network,
      "--network-alias",
      "gateway",
      "-e",
      "LAOFU_GATEWAY_INTERFACE=eth0",
      ...(dnsServers.length
        ? ["-e", `LAOFU_PUBLIC_DNS=${dnsServers.join(",")}`]
        : []),
      "-e",
      `LAOFU_CORE_URL=http://host.docker.internal:${new URL(owner.url).port || 17889}`,
      image,
      "gateway",
    ]);
    docker(["network", "connect", "bridge", gateway]);
    docker([
      "run",
      "-d",
      "--name",
      worker,
      "--hostname",
      worker,
      "--init",
      "--cap-drop=ALL",
      "--security-opt",
      "no-new-privileges",
      "--security-opt",
      `seccomp=${root}/deploy/docker/seccomp.json`,
      "--memory",
      "2g",
      "--cpus",
      "2",
      "--pids-limit",
      "512",
      "--shm-size",
      "512m",
      "--network",
      network,
      "--mount",
      `type=volume,src=${volume},dst=/data`,
      "--entrypoint",
      "node",
      ...(process.env.LAOFU_DEBUG ? ["-e", "LAOFU_DEBUG=1"] : []),
      image,
      "scripts/container-entry.mjs",
    ]);
    console.log(
      JSON.stringify({
        ...deployment,
        enabledForProducts: false,
        next: `verify --id ${pair.worker.id}`,
      }),
    );
  } catch (e) {
    console.error(
      JSON.stringify({
        deployment: file,
        note: "未自动删除已建立的配置和数据，按此记录核查；受限入口未开放",
      }),
    );
    throw e;
  }
} else if (command === "verify") {
  const d = record();
  const network = docker(
      ["exec", d.worker, "node", "scripts/network-probe.mjs"],
      false,
    ),
    sandbox = docker(
      ["exec", d.worker, "node", "scripts/container-probe.mjs"],
      false,
    );
  const inspect = JSON.parse(docker(["inspect", d.worker]).stdout)[0];
  let checks = {};
  try {
    checks = JSON.parse(network.stdout.trim().split("\n").at(-1)).checks;
  } catch {}
  const report = {
    workerId: d.id,
    profileId: d.profileId,
    bootId: (await c.request("GET", "/v1/admin/workers")).items.find(
      (w) => w.id === d.id,
    )?.bootId,
    imageDigest: inspect.Image,
    checks: {
      ...checks,
      browserSandbox:
        sandbox.status === 0 && sandbox.stdout.includes("SANDBOX_PROBE_PASSED"),
      internalNetwork: JSON.parse(
        docker(["network", "inspect", d.network]).stdout,
      )[0].Internal,
      noSharedDesktop:
        inspect.Config.User === "node" &&
        inspect.HostConfig.NetworkMode === d.network,
    },
    network: {
      status: network.status,
      output: network.stdout,
      error: network.stderr,
    },
    sandbox: {
      status: sandbox.status,
      output: sandbox.stdout,
      error: sandbox.stderr,
    },
  };
  const output = path.join(dir, d.id + "-verification.json");
  fs.writeFileSync(output, JSON.stringify(report, null, 2), { mode: 0o600 });
  if (network.status !== 0 || sandbox.status !== 0)
    throw new Error(
      "实际隔离验收未通过；报告 " + output + "，受限入口保持关闭",
    );
  await c.request("POST", `/v1/admin/workers/${d.id}/attest`, report);
  console.log(
    JSON.stringify({ verified: true, profileId: d.profileId, report: output }),
  );
} else if (command === "stop" || command === "start") {
  const d = record();
  for (const name of command === "stop"
    ? [d.worker, d.gateway]
    : [d.gateway, d.worker])
    docker([command, name]);
  console.log(
    JSON.stringify({
      [command]: true,
      dataRetained: true,
      reverifyRequired: command === "start",
    }),
  );
} else if (command === "list")
  console.log(
    JSON.stringify(
      fs
        .readdirSync(dir)
        .filter((n) => /^wrk_[a-f0-9]+\.json$/.test(n))
        .map((n) => read(path.join(dir, n))),
    ),
  );
else
  throw new Error(
    "Use create, verify --id WORKER, stop --id WORKER, start --id WORKER, list",
  );
