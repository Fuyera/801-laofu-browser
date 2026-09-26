import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { serveMcp } from "../src/mcp.js";
import { tools } from "../src/catalog.js";
import { Fault } from "../src/errors.js";

test("MCP preserves browser content and exposes evidence for every job outcome", async (t) => {
  let state = "succeeded",
    effectState = "confirmed",
    calls = 0,
    uploads = 0,
    sessions = 0;
  const [a, b] = InMemoryTransport.createLinkedPair();
  const server = await serveMcp(
    {
      capabilities: async () => ({
        tools: tools.map((x) => ({ ...x, authorized: true })),
      }),
      session: async () => {
        sessions++;
        return { id: "ses" };
      },
      command: async () => {
        calls++;
        return { id: "cmd" };
      },
      upload: async () => {
        uploads++;
        return { id: "art" };
      },
      wait: async () => ({
        id: "cmd",
        state,
        effectState,
        result: { content: [{ type: "text", text: "browser evidence" }] },
        artifacts: [],
        checkpoint: { step: 2 },
      }),
    } as any,
    "profile",
    a,
  );
  const client = new Client({ name: "test", version: "1" });
  await client.connect(b);
  t.after(async () => {
    await client.close();
    await server.close();
  });
  const listing = await client.listTools();
  assert.equal(listing.tools.length, 28);
  for (const name of [
    "snapshot",
    "read_text",
    "query",
    "laofu_job",
    "laofu_jobs",
  ])
    assert.equal(
      listing.tools.find((x) => x.name === name)?.annotations?.readOnlyHint,
      true,
    );
  for (const name of ["click", "screenshot", "tabs", "learnings", "laofu_task"])
    assert.equal(
      listing.tools.find((x) => x.name === name)?.annotations?.readOnlyHint,
      false,
    );
  const unknown = await client.callTool({
    name: "nonexistent",
    arguments: { path: "/do/not/upload" },
  });
  assert.equal(unknown.isError, true);
  assert.equal(
    (unknown.structuredContent as any).error.code,
    "CAPABILITY_UNAVAILABLE",
  );
  const invalid = await client.callTool({ name: "type", arguments: {} });
  assert.equal(invalid.isError, true);
  assert.equal(
    (invalid.structuredContent as any).error.code,
    "INVALID_ARGUMENT",
  );
  assert.deepEqual([calls, uploads, sessions], [0, 0, 0]);
  for (state of [
    "succeeded",
    "partial",
    "failed",
    "cancelled",
    "running",
    "queued",
    "waiting_user",
    "suspended",
  ]) {
    const reply = await client.callTool({ name: "snapshot", arguments: {} });
    const evidence: any = reply.structuredContent;
    assert.equal(evidence.job.id, "cmd");
    assert.equal(evidence.outcome.successful, state === "succeeded");
    assert.equal(
      evidence.outcome.terminal,
      ["succeeded", "partial", "failed", "cancelled"].includes(state),
    );
    assert.equal(
      !!reply.isError,
      ["partial", "failed", "cancelled", "suspended"].includes(state),
    );
    if (state === "succeeded")
      assert.equal((reply.content as any)[0].text, "browser evidence");
  }
  state = "succeeded";
  effectState = "unknown";
  const uncertain: any = await client.callTool({
    name: "snapshot",
    arguments: {},
  });
  assert.equal(uncertain.isError, true);
  assert.equal(uncertain.structuredContent.outcome.successful, false);
  assert.equal(
    uncertain.structuredContent.outcome.nextAction,
    "verify_effect_before_any_resubmit",
  );
  assert.equal(calls, 9); // No automatic retry, including failed or unknown outcomes.
});

test("MCP transport loss carries stable recovery identity without replay", async (t) => {
  let calls = 0,
    key = "",
    refusal = false;
  const [a, b] = InMemoryTransport.createLinkedPair();
  const server = await serveMcp(
    {
      session: async () => ({ id: "ses" }),
      command: async (_s: any, _c: any, k: string) => {
        calls++;
        key = k;
        if (refusal) throw new Fault("FORBIDDEN", "denied", 403);
        throw Error("lost response");
      },
    } as any,
    "profile",
    a,
  );
  const client = new Client({ name: "test", version: "1" });
  await client.connect(b);
  t.after(async () => {
    await client.close();
    await server.close();
  });
  const reply: any = await client.callTool({
    name: "click",
    arguments: { selector: "#button" },
  });
  assert.equal(reply.structuredContent.error.code, "EFFECT_UNKNOWN");
  assert.equal(reply.structuredContent.recovery.idempotencyKey, key);
  assert.equal(JSON.parse(reply.content[0].text).recovery.idempotencyKey, key);
  assert.equal(calls, 1);
  refusal = true;
  const denied: any = await client.callTool({
    name: "click",
    arguments: { selector: "#button" },
  });
  assert.equal(denied.structuredContent.error.code, "FORBIDDEN");
  assert.equal(denied.structuredContent.recovery, undefined);
});
