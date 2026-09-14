import fs from "node:fs";
import path from "node:path";
import { BrowserClient } from "@laofu/browser";
const c = new BrowserClient(process.env.LAOFU_URL, process.env.LAOFU_TOKEN),
  profileId = process.env.LAOFU_PROFILE;
const source = process.env.LAOFU_SAMPLE_URL;
const file = "upload.bin";
fs.writeFileSync(file, Buffer.alloc(12 * 1024 ** 2, 42));
const uploaded = await c.upload(file);
await c.download(uploaded.id, "uploaded-copy.bin");
const capture = await c.submitTask(
  {
    type: "article.capture@v1",
    execution: { profileId },
    input: { url: source + "/article" },
  },
  "ts-capture",
);
const done = await c.wait(capture.id);
if (done.state !== "succeeded") throw new Error(JSON.stringify(done.error));
await c.download(
  done.artifacts.find((a) => a.filename.endsWith(".zip")).id,
  "article.zip",
);
const gate = await c.submitTask(
  {
    type: "article.capture@v1",
    execution: { profileId },
    input: { url: source + "/gate?client=ts" },
  },
  "ts-gate",
);
const waiting = await c.wait(gate.id);
if (waiting.state !== "waiting_user") throw new Error("expected waiting_user");
await fetch(source + "/unlock?client=ts");
await new Promise((r) => setTimeout(r, 800));
await c.resume(gate.id);
const resumed = await c.wait(gate.id);
if (resumed.state !== "succeeded") throw new Error("resume did not finish");
const cancelled = await c.submitTask(
  {
    type: "article.capture@v1",
    execution: { profileId: process.env.LAOFU_OFFLINE_PROFILE },
    input: { url: source + "/article" },
  },
  "ts-cancel",
);
if ((await c.cancel(cancelled.id)).state !== "cancelled")
  throw new Error("queued cancel failed");
fs.writeFileSync(
  "result.json",
  JSON.stringify({
    sdk: "typescript",
    capture: done.id,
    resumed: resumed.id,
    cancelled: cancelled.id,
    upload: uploaded.id,
    state: done.state,
  }),
);
console.log(
  "TS installed package: capture/upload/download/query/cancel/resume passed",
);
