import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServer } from "../src/server.js";
test("product HTTP policy covers scopes, resource ownership, revoked tokens, stale grants, file paths and unavailable isolation", async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "lb-policy-")),
    s = await createServer({ home });
  t.after(async () => {
    await s.app.close();
    fs.rmSync(home, { recursive: true, force: true });
  });
  const o = s.store.createProduct("owner", "owner", ["*"]),
    a = s.store.createProduct("A", "product", [
      "article.capture",
      "browser.read",
      "artifacts.write",
    ]),
    b = s.store.createProduct("B", "product", [
      "article.capture",
      "browser.read",
      "artifacts.write",
    ]);
  const call = (
    actor: any,
    method: any,
    url: string,
    payload?: any,
    key?: string,
  ) =>
    s.app.inject({
      method,
      url,
      headers: {
        authorization: "Bearer " + actor.token,
        ...(key ? { "idempotency-key": key } : {}),
      },
      ...(payload === undefined ? {} : { payload }),
    });
  const paired = (
    await call(o, "POST", "/v1/admin/workers", {
      name: "isolated",
      mode: "isolated",
    })
  ).json();
  assert.equal(
    (
      await call(o, "PATCH", "/v1/admin/profiles/" + paired.profile.id, {
        productIds: [a.product.id],
      })
    ).statusCode,
    200,
  );
  assert.equal(
    (await call(b, "POST", "/v1/sessions", { profileId: paired.profile.id }))
      .statusCode,
    403,
  );
  const session = (
    await call(a, "POST", "/v1/sessions", { profileId: paired.profile.id })
  ).json();
  assert.equal(
    (
      await call(
        a,
        "POST",
        `/v1/sessions/${session.id}/commands`,
        { tool: "eval", args: { expr: 'fetch("http://127.0.0.1")' } },
        "denied-code",
      )
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await call(
        a,
        "POST",
        "/v1/tasks",
        {
          type: "article.capture@v1",
          execution: { profileId: paired.profile.id },
          input: { url: "https://example.com" },
        },
        "isolation-missing",
      )
    ).statusCode,
    503,
  );
  assert.equal(
    (
      await call(
        a,
        "POST",
        `/v1/sessions/${session.id}/commands`,
        { tool: "snapshot", args: {} },
        "read-isolation-missing",
      )
    ).statusCode,
    503,
  );
  assert.equal((await call(a, "GET", "/v1/admin/workers")).statusCode, 403);
  assert.equal(
    (
      await call(o, "PATCH", "/v1/admin/profiles/" + paired.profile.id, {
        productIds: [],
      })
    ).statusCode,
    200,
  );
  assert.equal(
    (await call(a, "GET", `/v1/sessions/${session.id}`)).statusCode,
    403,
  );
  assert.equal(
    (
      await call(o, "PATCH", "/v1/admin/profiles/" + paired.profile.id, {
        productIds: [b.product.id],
      })
    ).statusCode,
    403,
    "existing browser data cannot be reassigned to B",
  );
  const owned = (
    await call(o, "POST", "/v1/admin/workers", { name: "owner" })
  ).json();
  const osession = (
    await call(o, "POST", "/v1/sessions", { profileId: owned.profile.id })
  ).json();
  assert.equal(
    (
      await call(
        o,
        "POST",
        `/v1/sessions/${osession.id}/commands`,
        { tool: "screenshot", args: { savePath: "../outside.png" } },
        "path",
      )
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await call(
        o,
        "POST",
        `/v1/sessions/${osession.id}/commands`,
        { tool: "eval", args: { expr: "1", __lb: { fence: 999 } } },
        "reserved",
      )
    ).statusCode,
    400,
  );
  const j = (
    await call(
      o,
      "POST",
      `/v1/sessions/${osession.id}/commands`,
      { tool: "status", args: { text: "test" }, requestId: "client-id" },
      "q",
    )
  ).json();
  assert.equal(j.requestId, "client-id");
  assert.equal((await call(b, "GET", "/v1/commands/" + j.id)).statusCode, 403);
  await call(o, "DELETE", `/v1/sessions/${osession.id}`);
  assert.equal(s.store.job(j.id)?.state, "cancelled");
  assert.equal(
    (
      await call(
        o,
        "POST",
        `/v1/sessions/${osession.id}/commands`,
        { tool: "status", args: { text: "no" } },
        "closed",
      )
    ).statusCode,
    403,
  );
  const upload = await s.app.inject({
    method: "POST",
    url: "/v1/artifacts",
    headers: {
      authorization: "Bearer " + a.token,
      "content-type": "application/octet-stream",
      "x-filename": "a.txt",
    },
    payload: Buffer.from("A data"),
  });
  assert.equal(upload.statusCode, 201);
  assert.equal(
    (await call(b, "GET", `/v1/artifacts/${upload.json().id}/content`))
      .statusCode,
    403,
  );
  const rotated = (
    await call(o, "POST", `/v1/admin/products/${a.product.id}/rotate`, {})
  ).json();
  assert.equal((await call(a, "GET", "/v1/capabilities")).statusCode, 401);
  assert.equal(
    (await call(rotated, "GET", "/v1/capabilities")).statusCode,
    200,
  );
  await call(o, "DELETE", `/v1/admin/products/${a.product.id}`);
  assert.equal(
    (await call(rotated, "GET", "/v1/capabilities")).statusCode,
    401,
  );
  const csrf = await s.app.inject({
    method: "GET",
    url: "/v1/capabilities",
    headers: {
      authorization: "Bearer " + o.token,
      origin: "https://attacker.invalid",
    },
  });
  assert.equal(csrf.statusCode, 403);
});
