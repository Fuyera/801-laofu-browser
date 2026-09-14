import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { publicAddress, publicTarget } from "../src/network.js";
import { Store } from "../src/store.js";
import { Artifacts } from "../src/artifacts.js";
test("public egress denies localhost, metadata, private IPv4 and mapped IPv6", async () => {
  for (const ip of [
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "::1",
    "::ffff:127.0.0.1",
    "fc00::1",
    "0.0.0.0",
    "224.0.0.1",
  ])
    assert.equal(publicAddress(ip), false, ip);
  assert.equal(publicAddress("1.1.1.1"), true);
  await assert.rejects(publicTarget("127.0.0.1", 80), {
    code: "NETWORK_DENIED",
  });
});
test("incomplete or over-budget upload leaves no published artifact or partial file", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lb-art-"));
  const store = new Store(dir),
    art = new Artifacts(store, 100);
  t.after(() => {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  await assert.rejects(
    art.write(
      "A",
      "x.bin",
      "application/octet-stream",
      Readable.from([Buffer.alloc(11)]),
      { maxBytes: 10 },
    ),
    { code: "LIMIT_EXCEEDED" },
  );
  assert.equal(store.artifacts().length, 0);
  assert.deepEqual(fs.readdirSync(art.directory), []);
  await assert.rejects(
    art.write("A", "../escape", "text/plain", Readable.from(["x"])),
    { code: "INVALID_ARGUMENT" },
  );
});
test("artifact ownership and deletion invalidate subsequent reads", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lb-art-"));
  const store = new Store(dir),
    art = new Artifacts(store);
  t.after(() => {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const { product: a } = store.createProduct("A"),
    { product: b } = store.createProduct("B");
  const item = await art.write(
    a.id,
    "hello.txt",
    "text/plain",
    Readable.from(["hello"]),
  );
  assert.equal(
    item.sha256,
    "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
  );
  assert.throws(() => art.owned(b, item.id), { code: "FORBIDDEN" });
  art.remove(a, item.id);
  assert.throws(() => art.owned(a, item.id), { code: "FORBIDDEN" });
  assert.equal(fs.existsSync(art.path(item.id)), false);
});
test("parallel streaming uploads reserve quota before async disk writes", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lb-quota-"));
  const store = new Store(dir),
    art = new Artifacts(store, 100);
  t.after(() => {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const results = await Promise.allSettled([
    art.write(
      "A",
      "a.bin",
      "application/octet-stream",
      Readable.from([Buffer.alloc(80)]),
    ),
    art.write(
      "B",
      "b.bin",
      "application/octet-stream",
      Readable.from([Buffer.alloc(80)]),
    ),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(
    store.artifacts().reduce((n, a) => n + a.bytes, 0),
    80,
  );
  assert.equal(
    fs.readdirSync(art.directory).filter((x) => x.endsWith(".partial")).length,
    0,
  );
});
test("retained interrupted files consume quota and broken streams cannot publish files", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lb-retained-")),
    s = new Store(dir),
    a = new Artifacts(s, 100);
  t.after(() => {
    s.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  fs.writeFileSync(
    path.join(a.directory, "art_stale.partial"),
    Buffer.alloc(95),
  );
  await assert.rejects(
    a.write(
      "A",
      "full.bin",
      "application/octet-stream",
      Readable.from([Buffer.alloc(10)]),
    ),
    { code: "QUOTA_EXCEEDED" },
  );
  assert.equal(s.artifacts().length, 0);
  fs.rmSync(path.join(a.directory, "art_stale.partial"));
  async function* diskFailure() {
    yield Buffer.alloc(20);
    throw Object.assign(new Error("injected disk failure"), { code: "ENOSPC" });
  }
  await assert.rejects(
    a.write("A", "disk.bin", "application/octet-stream", diskFailure()),
    { code: "ENOSPC" },
  );
  assert.equal(s.artifacts().length, 0);
  assert.deepEqual(fs.readdirSync(a.directory), []);
});
