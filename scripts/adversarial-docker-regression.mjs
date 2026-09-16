// Two new disposable containers; no existing service or worker is changed.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
const suffix = process.pid + "-" + Date.now();
const network = "lb-adversarial-" + suffix;
const gateway = network + "-gateway";
const neighbor = network + "-neighbor";
const image =
  process.env.LAOFU_TEST_IMAGE || "laofu-browser:0.1.0-dev.2-p4-580a6cf";
const peer = network + "-peer";
const run = (args) =>
  execFileSync("docker", args, { encoding: "utf8", timeout: 60000 }).trim();
const cleanup = (args) => {
  try {
    run(args);
  } catch {}
};
let created = false;
try {
  run(["network", "create", "--internal", network]);
  created = true;
  run([
    "run",
    "-d",
    "--name",
    gateway,
    "--network",
    network,
    "-e",
    "LAOFU_GATEWAY_INTERFACE=eth0",
    "--cap-drop=ALL",
    "--security-opt",
    "no-new-privileges",
    "--read-only",
    "--tmpfs",
    "/tmp:rw,nosuid,nodev,size=64m",
    "--memory",
    "256m",
    "--mount",
    `type=bind,source=${path.resolve("src")},target=/app/probe,readonly`,
    "--entrypoint",
    "node",
    image,
    "--import",
    "tsx",
    "--input-type=module",
    "-e",
    "import {gateway} from './probe/relay.ts'; gateway('http://127.0.0.1:9');",
  ]);
  run(["network", "connect", "bridge", gateway]);
  const bridgeIp = run([
    "inspect",
    "--format",
    "{{.NetworkSettings.Networks.bridge.IPAddress}}",
    gateway,
  ]);
  const ip = run([
    "inspect",
    "--format",
    `{{(index .NetworkSettings.Networks ${JSON.stringify(network)}).IPAddress}}`,
    gateway,
  ]);
  const script = `const http=require('node:http');const get=(port,p)=>new Promise((resolve,reject)=>{const r=http.get({host:${JSON.stringify(ip)},port,path:p},s=>{s.resume();s.on('end',()=>resolve(s.statusCode));});r.setTimeout(8000,()=>r.destroy(Error('timeout')));r.on('error',reject)});const connect=()=>new Promise((resolve,reject)=>{const r=http.request({host:${JSON.stringify(ip)},port:18880,method:'CONNECT',path:'1.1.1.1:443'});r.on('connect',(res,socket)=>{socket.destroy();resolve(res.statusCode)});r.setTimeout(10000,()=>r.destroy(Error('timeout')));r.on('error',reject);r.end()});(async()=>{let connected=false;for(let i=0;i<30;i++){try{await get(18881,'/');connected=true;break}catch{await new Promise(r=>setTimeout(r,200))}}if(!connected)throw Error('gateway not ready');console.log(JSON.stringify({anonymousPublicConnect:await connect(),privateTarget:await get(18880,'http://127.0.0.1/'),blockedControlRoute:await get(18881,'/v1/admin/products'),allowedRelayNoCredential:await get(18881,'/v1/worker/learnings')}))})().catch(e=>{console.error(e);process.exitCode=1});`;
  const evidence = JSON.parse(
    run([
      "run",
      "--rm",
      "--name",
      peer,
      "--network",
      network,
      "--entrypoint",
      "node",
      image,
      "-e",
      script,
    ]),
  );
  assert.equal(evidence.anonymousPublicConnect, 200);
  assert.equal(evidence.privateTarget, 403);
  assert.equal(evidence.blockedControlRoute, 403);
  assert.equal(evidence.allowedRelayNoCredential, 502);
  const blockedScript = `const net=require('node:net');const probe=(host,port)=>new Promise(resolve=>{const s=net.connect({host,port});s.setTimeout(2500);s.on('connect',()=>{s.destroy();resolve({host,port,connected:true})});s.on('error',()=>resolve({host,port,connected:false}));s.on('timeout',()=>{s.destroy();resolve({host,port,connected:false})});});Promise.all(${JSON.stringify([bridgeIp, ip])}.flatMap(ip=>[18880,18881].map(port=>probe(ip,port)))).then(x=>console.log(JSON.stringify(x)));`;
  const blocked = JSON.parse(
    run([
      "run",
      "--rm",
      "--name",
      neighbor,
      "--network",
      "bridge",
      "--entrypoint",
      "node",
      image,
      "-e",
      blockedScript,
    ]),
  );
  assert.ok(
    blocked.every((x) => !x.connected),
    JSON.stringify(blocked),
  );
  const report = {
    blocked,
    at: new Date().toISOString(),
    id: "AT-P2-19",
    kind: "real disposable Docker containers; current src mounted read-only; same topology as deployer",
    image,
    evidence,
    limits:
      "TCP CONNECT only to public 1.1.1.1:443; no account or token used. No sniffing or core authorization bypass tested.",
  };
  fs.writeFileSync(
    "workspace/adversarial-fixes-docker.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report));
} finally {
  cleanup(["rm", "-f", neighbor]);
  cleanup(["rm", "-f", peer]);
  cleanup(["rm", "-f", gateway]);
  if (created) cleanup(["network", "rm", network]);
}
