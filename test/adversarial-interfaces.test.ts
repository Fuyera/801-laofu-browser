import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { serveMcp } from "../src/mcp.js";
import { createServer } from "../src/server.js";
import { Fault } from "../src/errors.js";
import { Worker } from "../src/worker.js";
const run = promisify(execFile);

test("MCP lost acceptance returns the exact stable key and query guidance; deterministic refusal stays a refusal", async () => {
  const originalSet = Server.prototype.setRequestHandler,
    originalConnect = Server.prototype.connect;
  const handlers: any[] = [];
  Server.prototype.setRequestHandler = function (schema: any, handler: any) {
    handlers.push(handler);
    return originalSet.call(this, schema, handler);
  };
  Server.prototype.connect = async () => {};
  let key: string | undefined,
    calls = 0,
    refuse = false;
  try {
    await serveMcp(
      {
        session: async () => ({ id: "session" }),
        command: async (_s: string, _r: any, k: string) => {
          key = k;
          calls++;
          if (refuse) throw new Fault("FORBIDDEN", "denied", 403);
          throw Error("accepted but response lost");
        },
      } as any,
      "profile",
    );
    const handler = handlers.at(-1),
      reply = await handler({
        params: { name: "click", arguments: { selector: "#fixture" } },
      });
    const body = JSON.parse(reply.content[0].text);
    assert.equal(body.error.code, "EFFECT_UNKNOWN");
    assert.equal(body.recovery.idempotencyKey, key);
    assert.equal(body.recovery.queryTool, "laofu_jobs");
    assert.equal(body.recovery.sessionId, "session");
    assert.equal(calls, 1);
    refuse = true;
    const rejected = JSON.parse(
      (
        await handler({
          params: { name: "click", arguments: { selector: "#fixture" } },
        })
      ).content[0].text,
    );
    assert.equal(rejected.error.code, "FORBIDDEN");
    assert.equal(rejected.recovery, undefined);
  } finally {
    Server.prototype.setRequestHandler = originalSet;
    Server.prototype.connect = originalConnect;
  }
});

test("CLI upload transfers a real local file once and repeats the same command identity", async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "lb-cli-upload-"));
  const s = await createServer({ home: path.join(home, "service") });
  t.after(async () => {
    await s.app.close();
    fs.rmSync(home, { recursive: true, force: true });
  });
  const owner = s.store.createProduct("test", "owner", ["*"]);
  const headers = { authorization: `Bearer ${owner.token}` };
  const paired = (
    await s.app.inject({
      method: "POST",
      url: "/v1/admin/workers",
      headers,
      payload: { name: "test" },
    })
  ).json();
  const url = await s.app.listen({ host: "127.0.0.1", port: 0 });
  const file = path.join(home, "upload.txt");
  fs.writeFileSync(file, "synthetic upload body");
  const args = [
    "--import",
    "tsx",
    "src/cli.ts",
    "call",
    "upload",
    JSON.stringify({ path: file, selector: "#upload" }),
    "--profile",
    paired.profile.id,
    "--home",
    path.join(home, "client"),
    "--key",
    "same-upload",
  ];
  const invoke = async () =>
    JSON.parse(
      (
        await run(process.execPath, args, {
          env: { ...process.env, LAOFU_URL: url, LAOFU_TOKEN: owner.token },
        })
      ).stdout,
    );
  const first = await invoke(),
    second = await invoke();
  assert.equal(first.id, second.id);
  assert.equal(s.store.artifacts().length, 1);
  const j = s.store.job(first.id)!;
  assert.equal(j.input.args.path, "upload.txt");
  assert.equal(j.input.inputArtifacts.path, s.store.artifacts()[0].id);
  assert.equal(
    fs.readFileSync(s.artifacts.path(j.input.inputArtifacts.path), "utf8"),
    "synthetic upload body",
  );
});

test("error summary flags truncation while preserving the full original tool content", async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "lb-long-error-"));
  const w: any = new Worker({
    home,
    profileId: "p",
    workerId: "w",
    baseUrl: "http://unused",
    token: "synthetic",
  });
  t.after(() => {
    w.store.close();
    fs.rmSync(home, { recursive: true, force: true });
  });
  const text = "x".repeat(1800);
  let result: any;
  w.browser = {
    releaseClient: async () => {},
    control: async () => {},
    call: async () => ({
      isError: true,
      content: [{ type: "text", text }],
      _meta: { "laofu.error": { code: "NOT_FOUND" } },
    }),
    diagnostic() {},
  };
  w.send = (m: any) => {
    if (m.type === "result") result = m;
  };
  await w.execute({
    id: "cmd_" + "0".repeat(32),
    kind: "command",
    type: "click",
    input: { args: {} },
    attempt: 1,
    fence: 1,
    expiresAt: Date.now() + 60000,
  });
  assert.equal(result.error.message.length, 1000);
  assert.equal(result.error.messageTruncated, true);
  assert.equal(result.error.originalMessageLength, 1800);
  assert.equal(result.result.content[0].text, text);
});
