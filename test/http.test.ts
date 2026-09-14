import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServer } from "../src/server.js";
test("HTTP authorization, isolation gating, idempotency and one-time bootstrap use real Fastify routes", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "lb-http-"));
  const s = await createServer({ home });
  try {
    const o = s.store.createProduct("owner", "owner", ["*"]);
    const a = s.store.createProduct("A"),
      b = s.store.createProduct("B");
    const h = { authorization: `Bearer ${o.token}` };
    const unauthorized = await s.app.inject({ url: "/v1/capabilities" });
    assert.equal(unauthorized.statusCode, 401);
    const paired = await s.app.inject({
      method: "POST",
      url: "/v1/admin/workers",
      headers: h,
      payload: { name: "test", mode: "owner" },
    });
    assert.equal(paired.statusCode, 200, paired.body);
    const profile = paired.json().profile;
    const denied = await s.app.inject({
      method: "POST",
      url: `/v1/admin/profiles/${profile.id}`,
      headers: h,
      payload: { productIds: [a.product.id] },
    });
    assert.equal(denied.statusCode, 404);
    const grant = await s.app.inject({
      method: "PATCH",
      url: `/v1/admin/profiles/${profile.id}`,
      headers: h,
      payload: { productIds: [a.product.id] },
    });
    assert.equal(grant.statusCode, 403);
    const session = await s.app.inject({
      method: "POST",
      url: "/v1/sessions",
      headers: h,
      payload: { profileId: profile.id },
    });
    assert.equal(session.statusCode, 200, session.body);
    const request = {
      method: "POST" as const,
      url: `/v1/sessions/${session.json().id}/commands`,
      headers: { ...h, "idempotency-key": "same" },
      payload: { tool: "status", args: { text: "采集测试" } },
    };
    const first = await s.app.inject(request),
      second = await s.app.inject(request);
    assert.equal(first.statusCode, 202, first.body);
    assert.equal(first.json().id, second.json().id);
    const cross = await s.app.inject({
      url: `/v1/commands/${first.json().id}`,
      headers: { authorization: `Bearer ${b.token}` },
    });
    assert.equal(cross.statusCode, 403);
    const boot = s.store.credential("bootstrap", o.product.id, 10000);
    const bootstrap = await s.app.inject({
      method: "POST",
      url: "/v1/admin/bootstrap",
      payload: { token: boot },
    });
    assert.equal(bootstrap.statusCode, 200);
    assert.match(bootstrap.headers["set-cookie"] as string, /HttpOnly/);
    assert.equal(
      (
        await s.app.inject({
          method: "POST",
          url: "/v1/admin/bootstrap",
          payload: { token: boot },
        })
      ).statusCode,
      401,
    );
    const upload = await s.app.inject({
      method: "POST",
      url: "/v1/artifacts",
      headers: {
        ...h,
        "content-type": "application/octet-stream",
        "x-filename": "hello.txt",
      },
      payload: Buffer.from("hello"),
    });
    assert.equal(upload.statusCode, 201, upload.body);
    assert.equal(
      (
        await s.app.inject({
          url: `/v1/artifacts/${upload.json().id}/content`,
          headers: h,
        })
      ).body,
      "hello",
    );
  } finally {
    await s.app.close();
    fs.rmSync(home, { recursive: true, force: true });
  }
});
