// All pages, effects and human continuation are synthetic, in a new Chromium profile.
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import net from "node:net";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import sharp from "sharp";
import { BrowserAdapter } from "../src/browser.ts";
import { Worker } from "../src/worker.ts";
import {
  captureArticle,
  prepareArticle,
  renderArticle,
} from "../src/article.ts";
import { createServer } from "../src/server.ts";
const home = fs.mkdtempSync(
  path.resolve("workspace/adversarial-fixes-browser-"),
);
const out = home;
const checks = [];
const report = path.join(out, "report.json");
const save = () =>
  fs.writeFileSync(
    report,
    JSON.stringify(
      {
        at: new Date().toISOString(),
        home,
        kind: "real isolated Chromium + current generated extension/MCP + current source; local synthetic fixtures",
        checks,
      },
      null,
      2,
    ),
  );
async function check(id, fn) {
  if (process.env.CHECK_FILTER && !id.includes(process.env.CHECK_FILTER))
    return;
  try {
    const observations = await fn();
    checks.push({ id, status: "passed", observations });
    console.log("PASS " + id);
  } catch (e) {
    checks.push({ id, status: "failed", error: e.stack });
    console.log("PROBE_FAILED " + id + " " + e.message);
  }
  save();
}
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const one = await sharp({
  create: {
    width: 1,
    height: 1,
    channels: 4,
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  },
})
  .png()
  .toBuffer();
const real = await sharp({
  create: { width: 120, height: 80, channels: 3, background: "#336699" },
})
  .png()
  .toBuffer();
let effects = 0,
  realImageHits = 0;
const words =
  "This is an authorized local synthetic article paragraph. ".repeat(15);
const fixture = http.createServer((req, res) => {
  const u = new URL(req.url, "http://fixture");
  if (u.pathname === "/effect") {
    effects++;
    res.end("ok");
    return;
  }
  if (u.pathname === "/tiny.png") {
    res.setHeader("Content-Type", "image/png");
    res.end(one);
    return;
  }
  if (u.pathname === "/real.png") {
    realImageHits++;
    res.setHeader("Content-Type", "image/png");
    res.end(real);
    return;
  }
  if (u.pathname === "/pages") {
    res.end(
      JSON.stringify({ page: u.searchParams.get("p"), text: "x".repeat(180) }),
    );
    return;
  }
  if (u.pathname === "/rate-resource") {
    res.writeHead(429, { "Retry-After": "120" });
    res.end("rate");
    return;
  }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  if (u.pathname === "/wall")
    return res.end(
      "<title>Member access</title><article><p>" +
        "Sign in to continue. Please use your account to access this content. ".repeat(
          10,
        ) +
        '</p><form><input type="password"><button>Sign in</button></form></article>',
    );
  if (u.pathname === "/slow")
    return res.end(
      '<title>Loading article</title><article><p>Loading, please wait…</p></article><script>setTimeout(()=>document.querySelector("article").innerHTML=' +
        JSON.stringify("<p>" + words + "</p>") +
        ",6000)</script>",
    );
  if (u.pathname === "/placeholder")
    return res.end(
      "<title>Lazy image fixture</title><article><p>" +
        words +
        '</p><div style="height:18000px"></div><img id="lazy" src="/tiny.png"></article><script>new IntersectionObserver(es=>{if(es[0].isIntersecting)document.querySelector("#lazy").src="/real.png"}).observe(document.querySelector("#lazy"))</script>',
    );
  if (u.pathname === "/stuck-image")
    return res.end(
      "<title>Placeholder</title><article><p>" +
        words +
        '</p><img src="/tiny.png"></article>',
    );
  if (u.pathname === "/media")
    return res.end(
      "<title>Media fixture</title><article><p>" +
        words +
        '</p><video src="/movie.mp4"></video><audio src="/audio.mp3"></audio><iframe srcdoc="card"></iframe></article>',
    );
  if (u.pathname === "/noscript")
    return res.end(
      "<title>Fallback fixture</title><article><p>" +
        words +
        '</p><img src="/real.png"><noscript><img id="fallback" src="/tiny.png"></noscript></article>',
    );
  if (u.pathname === "/act")
    return res.end(
      "<title>Local effect counter</title><p>Local synthetic button</p><button id=\"commit\" onclick=\"fetch('/effect',{method:'POST'});this.textContent='Marker recorded'\">Mark test effect</button>",
    );
  res.end(
    "<title>Before revision</title><article><p>" +
      words +
      '</p></article><button id="after" onclick="this.textContent=\'changed\'">Next step</button>',
  );
});
await new Promise((r) => fixture.listen(0, "127.0.0.1", r));
const origin = "http://127.0.0.1:" + fixture.address().port;
const temp = net.createServer();
await new Promise((r) => temp.listen(0, "127.0.0.1", r));
const bridgePort = temp.address().port;
await new Promise((r) => temp.close(r));
const browser = new BrowserAdapter({
  home: path.join(home, "browser"),
  profileId: "adversarial-only",
  headless: true,
  bridgePort,
});
let sequence = 0;
function job(type = "probe", kind = "task", input = {}) {
  return {
    id: "browser-probe-" + ++sequence,
    sessionId: "probe-session",
    profileId: "adversarial-only",
    kind,
    type,
    input,
    attempt: 1,
    fence: sequence,
    expiresAt: Date.now() + 180000,
  };
}
async function tab(route) {
  const j = job();
  await browser.control(j);
  const t = await browser.raw("tabs", { action: "new" }, j);
  await browser.raw("navigate", { tabId: t.tabId, url: origin + route }, j);
  return {
    j,
    tabId: t.tabId,
    page: browser.context.pages().find((p) => p.url() === origin + route),
  };
}
async function capture(
  route,
  hook,
  human = async () => {
    throw new Error("unexpected human challenge");
  },
) {
  const j = job("article.capture@v1", "task", { url: origin + route });
  await browser.control(j);
  let calls = 0;
  const dir = path.join(home, "article-" + sequence);
  const r = await captureArticle(
    { url: origin + route, limits: { maxTabs: 100 } },
    dir,
    async (name, args, raw) => {
      calls++;
      if (hook)
        return hook({
          name,
          args,
          raw,
          j,
          browser,
          call: () =>
            raw ? browser.raw(name, args, j) : browser.call(name, args, j),
        });
      return raw ? browser.raw(name, args, j) : browser.call(name, args, j);
    },
    human,
  );
  return { ...r, dir, calls, j };
}
async function execute(type, kind, input, onSend, setup) {
  const w = new Worker({
    home: browser.config.home,
    profileId: "adversarial-only",
    workerId: "synthetic",
    baseUrl: "http://unused",
    token: "synthetic",
  });
  w.browser = browser;
  setup?.(w);
  const sent = [];
  w.send = (m) => {
    sent.push(m);
    onSend?.(m, w);
  };
  const j = job(type, kind, input);
  try {
    await w.execute(j);
    return { reply: sent.find((m) => m.type === "result"), sent, j };
  } finally {
    w.store.close();
  }
}
try {
  await browser.start();
  save();
  await check("AT-P1-01-act", async () => {
    const t = await tab("/act"),
      before = effects;
    const { reply } = await execute("act", "command", {
      args: {
        tabId: t.tabId,
        allowSensitive: true,
        steps: [
          { do: "click", selector: "#commit" },
          { do: "wait", for: "text", value: "NEVER_PRESENT", timeout: 500 },
          { do: "click", selector: "#commit" },
        ],
      },
    });
    assert.equal(reply.state, "partial");
    assert.equal(reply.effectState, "unknown");
    assert.equal(reply.stopped, false);
    assert.equal(effects - before, 1);
    return {
      state: reply.state,
      effectState: reply.effectState,
      stopped: reply.stopped,
      localEffects: effects - before,
    };
  });
  await check("AT-P1-02-login-wall", async () => {
    let waiting;
    await assert.rejects(
      capture("/wall", undefined, async (info) => {
        waiting = info;
        throw Error("fixture stops at human gate");
      }),
      /fixture stops/,
    );
    assert.equal(waiting.code, "AUTH_REQUIRED");
    return { waiting, delivered: false };
  });
  await check("AT-P1-02-loading", async () => {
    const start = Date.now(),
      r = await capture("/slow"),
      md = fs.readFileSync(path.join(r.dir, "article.md"), "utf8");
    assert.match(md, /authorized local synthetic/);
    assert.doesNotMatch(md, /Loading, please wait/);
    assert.equal(r.state, "succeeded");
    return { state: r.state, elapsedMs: Date.now() - start };
  });
  let imageCapture;
  await check("AT-P1-03-lazy-image", async () => {
    const before = realImageHits,
      r = await capture("/placeholder");
    imageCapture = r;
    assert.equal(r.state, "succeeded");
    assert.equal(r.manifest.images[0].width, 120);
    assert.equal(r.manifest.mediaCoverage.downloadedImages, 1);
    assert.ok(realImageHits > before);
    return {
      state: r.state,
      width: r.manifest.images[0].width,
      scrolls: r.manifest.loading.scrolls,
      realImageFetches: realImageHits - before,
    };
  });
  await check("AT-P1-03-persistent-placeholder", async () => {
    const r = await capture("/stuck-image");
    assert.equal(r.state, "partial");
    assert.equal(r.manifest.images[0].error, "SUSPECTED_PLACEHOLDER");
    assert.equal(r.manifest.mediaCoverage.downloadedImages, 0);
    return { state: r.state, images: r.manifest.images };
  });
  await check("AT-P2-04-fetch-truncation", async () => {
    const t = await tab("/fetch-page");
    const { reply } = await execute("fetch", "command", {
      args: {
        url: origin + "/pages",
        tabId: t.tabId,
        pages: { param: "p", max: 3 },
        maxBody: 300,
      },
    });
    assert.equal(reply.state, "partial");
    assert.equal(reply.result.truncated, true);
    assert.ok(reply.result.originalLength > 300);
    return { state: reply.state, meta: reply.result._meta };
  });
  await check("AT-P2-07-flow-ask-continue", async () => {
    const t = await tab("/flow");
    const { reply, sent } = await execute(
      "browser.flow@v1",
      "task",
      {
        steps: [
          {
            tool: "ask",
            args: {
              tabId: t.tabId,
              prompt: "Synthetic handoff",
              focus: false,
              timeout: 5000,
            },
          },
          { tool: "click", args: { tabId: t.tabId, selector: "#after" } },
        ],
      },
      (m, w) => {
        if (m.type === "waiting_user")
          setTimeout(() => w.resolveHuman?.(), 100);
      },
    );
    assert.equal(reply.state, "succeeded");
    assert.equal(await t.page.locator("#after").innerText(), "changed");
    assert.ok(sent.some((m) => m.type === "handoff_completed"));
    return { state: reply.state, controlReturned: true };
  });
  await check("AT-P2-07-flow-ask-cancel", async () => {
    const t = await tab("/flow-cancel");
    const { reply } = await execute(
      "browser.flow@v1",
      "task",
      {
        steps: [
          {
            tool: "ask",
            args: {
              tabId: t.tabId,
              prompt: "Synthetic cancellation",
              focus: false,
              timeout: 5000,
            },
          },
          { tool: "click", args: { tabId: t.tabId, selector: "#after" } },
        ],
      },
      (m, w) => {
        if (m.type === "waiting_user")
          setTimeout(
            () => w.message({ type: "cancel", jobId: m.jobId, fence: m.fence }),
            100,
          );
      },
    );
    assert.equal(reply.state, "cancelled");
    assert.equal(await t.page.locator("#after").innerText(), "Next step");
    return { state: reply.state, nextStepExecuted: false };
  });
  await check("AT-P2-10-media", async () => {
    const r = await capture("/media"),
      items = r.manifest.mediaCoverage.embeddedMedia;
    assert.equal(items.length, 3);
    assert.deepEqual(
      items.map((x) => x.type),
      ["video", "audio", "iframe"],
    );
    assert.ok(items.every((x) => x.status === "not_downloaded"));
    assert.equal(r.state, "succeeded");
    return { state: r.state, items };
  });
  await check("AT-P2-14-metadata-binding", async () => {
    let changed = false;
    const r = await capture("/metadata", async (x) => {
      if (
        !changed &&
        x.name === "eval" &&
        x.args.expr.includes("return {length:r.innerHTML.length,meta}")
      ) {
        changed = true;
        const p = x.browser.context
          .pages()
          .find((p) => p.url() === origin + "/metadata");
        await p.evaluate(() => {
          document.title = "After revision";
          document.querySelector("article").innerHTML =
            "<p>After revision body with changed content.</p>";
        });
      }
      return x.call();
    });
    assert.equal(changed, true);
    assert.equal(r.manifest.title, "After revision");
    assert.equal(r.manifest.versionConsistent, false);
    assert.equal(r.state, "partial");
    assert.match(
      fs.readFileSync(path.join(r.dir, "article.md"), "utf8"),
      /After revision body/,
    );
    const html = fs.readFileSync(path.join(r.dir, "article.html"));
    assert.equal(
      crypto.createHash("sha256").update(html).digest("hex"),
      r.manifest.contentHash,
    );
    return {
      state: r.state,
      title: r.manifest.title,
      versionConsistent: r.manifest.versionConsistent,
      artifactHashVerified: true,
    };
  });
  await check("AT-P2-14-short-chunk", async () => {
    let trimmed = false;
    await assert.rejects(
      capture("/chunks", async (x) => {
        const result = await x.call();
        if (
          !trimmed &&
          x.name === "eval" &&
          /globalThis\[.*\]\.slice\(/.test(x.args.expr)
        ) {
          result.text = JSON.stringify(JSON.parse(result.text).slice(0, 80));
          trimmed = true;
        }
        return result;
      }),
      { code: "TRUNCATED" },
    );
    assert.ok(trimmed);
    return { truncatedChunkRejected: true };
  });
  await check("AT-P2-18-screenshot-small-and-large", async () => {
    const t = await tab("/screenshot");
    const small = await execute("screenshot", "command", {
      args: { tabId: t.tabId },
    });
    assert.ok(small.reply.result.content.some((c) => c.type === "image"));
    await t.page.evaluate(() => {
      document.body.innerHTML = '<canvas width="1000" height="700"></canvas>';
      const c = document.querySelector("canvas").getContext("2d"),
        d = c.createImageData(1000, 700);
      for (let i = 0; i < d.data.length; i += 4) {
        d.data[i] = Math.random() * 256;
        d.data[i + 1] = Math.random() * 256;
        d.data[i + 2] = Math.random() * 256;
        d.data[i + 3] = 255;
      }
      c.putImageData(d, 0, 0);
    });
    const s = await createServer({
        home: path.join(home, "screenshot-service"),
      }),
      o = s.store.createProduct("fixture", "owner", ["*"]);
    try {
      const { reply } = await execute(
        "screenshot",
        "command",
        { args: { tabId: t.tabId, full: true } },
        undefined,
        (w) => {
          w.upload = (j, file, name, mime) =>
            s.artifacts.write(
              o.product.id,
              name,
              mime,
              fs.createReadStream(file),
              { jobId: j.id, metadata: { source: "worker" } },
            );
        },
      );
      assert.equal(reply.state, "succeeded");
      assert.equal(reply.result.artifacts.length, 1);
      assert.ok(reply.result.artifacts[0].bytes > 256 * 1024);
      assert.ok(JSON.stringify(reply).length < 20000);
      assert.ok(!reply.result.content.some((c) => c.type === "image"));
      return {
        smallInline: true,
        largeArtifactBytes: reply.result.artifacts[0].bytes,
        responseBytes: JSON.stringify(reply).length,
      };
    } finally {
      await s.app.close();
    }
  });
  await check("AT-P2-16-source-redaction", async () => {
    const r = await capture("/source?signature2=SYNTHETIC-SOURCE&page=2");
    assert.ok(r.sourceMetadata.sourceUrl.includes("SYNTHETIC-SOURCE"));
    assert.equal(r.manifest.sourceUrlRedacted, true);
    assert.equal(r.manifest.finalUrlRedacted, true);
    for (const name of ["manifest.json", "article.md", "article.html"])
      assert.ok(
        !fs
          .readFileSync(path.join(r.dir, name), "utf8")
          .includes("SYNTHETIC-SOURCE"),
      );
    return { originalRetainedSeparately: true, publicFilesRedacted: true };
  });
  await check("AT-P3-10-console-pagination", async () => {
    const s = await createServer({
      home: path.join(home, "pagination-service"),
    });
    const o = s.store.createProduct("fixture", "owner", ["*"]);
    const url = await s.app.listen({ host: "127.0.0.1", port: 0 });
    const page = await browser.context.newPage();
    try {
      for (let i = 0; i < 55; i++) {
        const j = s.store.createJob(o.product, "task", `page-${i}`, {
          type: "fixture",
          profileId: "fixture",
          workerId: "fixture",
          input: { url: `https://example.com/page-${i}` },
        }).job;
        s.store.transition(j.id, "succeeded");
        await s.artifacts.write(
          o.product.id,
          `file-${i}.txt`,
          "text/plain",
          [Buffer.from("fixture")],
          { metadata: { source: "worker" } },
        );
      }
      await page.goto(
        url +
          "/#bootstrap=" +
          s.store.credential("bootstrap", o.product.id, 60000),
      );
      await page.getByRole("button", { name: "更早任务", exact: true }).click();
      await page.waitForFunction(
        () => document.querySelectorAll(".task-row").length === 5,
      );
      await page.getByRole("button", { name: "最新任务", exact: true }).click();
      await page.waitForFunction(
        () => document.querySelectorAll(".task-row").length === 50,
      );
      await page.getByRole("button", { name: "图文产物", exact: true }).click();
      await page.getByRole("button", { name: "更早产物", exact: true }).click();
      await page.waitForFunction(
        () => document.querySelectorAll("tbody tr").length === 5,
      );
      await page.getByRole("button", { name: "最新产物", exact: true }).click();
      await page.waitForFunction(
        () => document.querySelectorAll("tbody tr").length === 50,
      );
      return { tasks: [50, 5, 50], artifacts: [50, 5, 50], totalEach: 55 };
    } finally {
      await page.close();
      await s.app.close();
    }
  });
  await check("AT-P2-15-incomplete-upload-hidden", async () => {
    const s = await createServer({ home: path.join(home, "artifact-service") }),
      o = s.store.createProduct("fixture", "owner", ["*"]);
    const w = new Worker({
      home: path.join(home, "artifact-worker"),
      profileId: "adversarial-only",
      workerId: "synthetic",
      baseUrl: "http://unused",
      token: "synthetic",
    });
    w.browser = browser;
    let j = s.store.createJob(o.product, "task", "partial-upload", {
      type: "article.capture@v1",
      profileId: "adversarial-only",
      workerId: "synthetic",
      input: { url: origin + "/artifact-source", limits: { maxTabs: 100 } },
    }).job;
    j = s.store.transition(j.id, "running", { fence: ++sequence });
    let uploads = 0,
      reply,
      first;
    w.send = (m) => {
      if (m.type === "result") {
        reply = m;
        s.store.transition(j.id, m.state, {
          error: m.error,
          effectState: m.effectState,
        });
      }
    };
    w.upload = async (j, file, name, mime) => {
      if (++uploads === 2) throw Error("injected second upload failure");
      return (first = await s.artifacts.write(
        o.product.id,
        name,
        mime,
        fs.createReadStream(file),
        { jobId: j.id, metadata: { source: "worker", publication: "staged" } },
      ));
    };
    try {
      await w.execute(j);
      assert.equal(reply.state, "failed");
      const headers = { authorization: `Bearer ${o.token}` };
      const body = (
        await s.app.inject({ url: "/v1/tasks/" + j.id, headers })
      ).json();
      assert.equal(body.artifacts.length, 0);
      const read = await s.app.inject({
        url: "/v1/artifacts/" + first.id,
        headers,
      });
      assert.equal(read.statusCode, 409);
      s.artifacts.sweep();
      assert.equal(s.store.artifact(first.id).deleted, true);
      assert.equal(
        fs.existsSync(path.join(w.config.home, "jobs", j.id)),
        false,
      );
      return {
        state: body.state,
        visibleArtifacts: 0,
        downloadStatus: read.statusCode,
        stagingCleaned: true,
      };
    } finally {
      w.store.close();
      await s.app.close();
    }
  });
  await check("AT-P3-08-human-budget", async () => {
    const t = await tab("/human-budget"),
      start = Date.now();
    const { reply } = await execute("browser.flow@v1", "task", {
      limits: { humanWaitSeconds: 5 },
      steps: [
        {
          tool: "ask",
          args: {
            tabId: t.tabId,
            prompt: "Synthetic budget",
            focus: false,
            timeout: 15000,
          },
        },
        { tool: "click", args: { tabId: t.tabId, selector: "#after" } },
      ],
    });
    assert.equal(reply.state, "failed");
    assert.equal(reply.error.code, "HUMAN_TIMEOUT");
    assert.ok(Date.now() - start < 7000);
    assert.equal(await t.page.locator("#after").innerText(), "Next step");
    return {
      state: reply.state,
      error: reply.error,
      elapsedMs: Date.now() - start,
    };
  });
  await check("AT-P3-09-resource-429", async () => {
    const t = await tab("/rate-document"),
      start = Date.now();
    const status = await t.page.evaluate(
      async () => (await fetch("/rate-resource")).status,
    );
    assert.equal(status, 429);
    await delay(100);
    const evidence = browser.rateLimit(origin, start);
    assert.equal(evidence.origin, origin);
    assert.equal(evidence.retryAfter, "120");
    return evidence;
  });
  await check("AT-P3-17-offline", async () => {
    assert.ok(imageCapture);
    const p = await browser.context.newPage();
    await p.goto(
      pathToFileURL(path.join(imageCapture.dir, "article.html")).href,
    );
    await p.waitForFunction(() => document.querySelector("img")?.complete);
    const width = await p.locator("img").evaluate((i) => i.naturalWidth);
    assert.equal(width, 120);
    return { offlineImageWidth: width };
  });
  await check("AT-P2-06-flow-reload-preflight", async () => {
    const { reply } = await execute("browser.flow@v1", "task", {
      steps: [
        { tool: "reload", args: {} },
        { tool: "status", args: { text: "after" } },
      ],
    });
    assert.equal(reply.state, "failed");
    assert.equal(reply.error.code, "CAPABILITY_UNAVAILABLE");
    assert.equal(reply.effectState, "not_started");
    return {
      state: reply.state,
      error: reply.error.code,
      effectState: reply.effectState,
    };
  });
} finally {
  await browser.stop().catch(() => {});
  await new Promise((r) => fixture.close(r));
  save();
}
if (checks.some((x) => x.status === "failed")) process.exitCode = 1;
console.log(
  JSON.stringify({
    home,
    passed: checks.filter((x) => x.status === "passed").length,
    total: checks.length,
  }),
);
