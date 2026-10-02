import test from "node:test";
import assert from "node:assert/strict";
import { ClientPool } from "../src/client-pool.js";
const deferred = <T = void>() => {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
test("100 transient jobs release clients without growing the pool", async () => {
  let created = 0, closed = 0;
  const pool = new ClientPool(async () => { created++; return { close: async () => { closed++; } }; });
  for (let i = 0; i < 100; i++) {
    await pool.use(`task-${i}`, async () => {});
    await pool.release(`task-${i}`);
    assert.equal(pool.size, 0);
  }
  assert.equal(created, 100);
  assert.equal(closed, 100);
});
test("persistent session reuses one client; concurrent connection is coalesced", async () => {
  let created = 0, closed = 0;
  const gate = deferred();
  const pool = new ClientPool(async () => { created++; await gate.promise; return { close: async () => { closed++; } }; });
  const a = pool.use("session", async (client) => client);
  const b = pool.use("session", async (client) => client);
  gate.resolve();
  assert.equal(await a, await b);
  await pool.use("session", async () => {});
  assert.equal(created, 1);
  await pool.release("session");
  assert.equal(closed, 1);
});
test("session retirement waits for in-flight calls and rejects later acquisitions", async () => {
  let closed = 0;
  const gate = deferred(), started = deferred();
  const pool = new ClientPool(async () => ({ close: async () => { closed++; } }));
  const active = pool.use("session", async () => { started.resolve(); await gate.promise; });
  await started.promise;
  const retiring = pool.release("session");
  assert.equal(closed, 0);
  await assert.rejects(pool.use("session", async () => {}), /closing/);
  gate.resolve();
  await active;
  await retiring;
  assert.equal(closed, 1);
  assert.equal(pool.size, 0);
});
test("idle expiration skips active calls and refreshes on use", async () => {
  let now = 0, closed = 0;
  const pool = new ClientPool(async () => ({ close: async () => { closed++; } }), 2, 100, () => now);
  await pool.use("idle", async () => {});
  now = 90;
  await pool.use("idle", async () => {});
  now = 110;
  await pool.sweep();
  assert.equal(closed, 0);
  const gate = deferred(), started = deferred();
  const active = pool.use("busy", async () => { started.resolve(); await gate.promise; });
  await started.promise;
  now = 250;
  await pool.sweep();
  assert.equal(closed, 1);
  assert.equal(pool.size, 1);
  gate.resolve();
  await active;
  await pool.close();
  assert.equal(closed, 2);
});
test("capacity evicts idle clients, never active clients", async () => {
  const pool = new ClientPool(async () => ({ close: async () => {} }), 1);
  await pool.use("old", async () => {});
  await pool.use("new", async () => {});
  assert.equal(pool.size, 1);
  const gate = deferred(), started = deferred();
  const active = pool.use("new", async () => { started.resolve(); await gate.promise; });
  await started.promise;
  await assert.rejects(pool.use("extra", async () => {}), /capacity/);
  gate.resolve(); await active; await pool.close();
});
test("rejected factory frees its slot and permits retry", async () => {
  let calls = 0;
  const pool = new ClientPool(async () => { if (++calls === 1) throw new Error("connect failed"); return { close: async () => {} }; });
  await assert.rejects(pool.use("same", async () => {}), /connect failed/);
  await pool.release("same");
  assert.equal(pool.size, 0);
  await pool.use("same", async () => {});
  await pool.close();
});
test("shutdown closes live clients and prevents new connections", async () => {
  const gate = deferred(), started = deferred(); let closed = 0;
  const pool = new ClientPool(async () => ({ close: async () => { closed++; gate.resolve(); } }));
  const active = pool.use("busy", async () => { started.resolve(); await gate.promise; });
  await started.promise;
  await pool.close(); await active;
  assert.equal(closed, 1);
  await assert.rejects(pool.use("new", async () => {}), /stopped/);
});
test("failed close keeps capacity reserved rather than allowing unchecked growth", async () => {
  const pool = new ClientPool(async () => ({ close: async () => { throw new Error("close failed"); } }), 1);
  await pool.use("session", async () => {});
  await assert.rejects(pool.release("session"), /close failed/);
  assert.equal(pool.size, 1);
  await assert.rejects(pool.use("new", async () => {}), /capacity/);
});
