import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createServer } from "../dist/server.js";

const home = fs.mkdtempSync(path.resolve("workspace/ui-language-"));
const server = await createServer({ home, port: 0 });
const owner = server.store.createProduct("UI language test", "owner", ["*"]);
let browser;
try {
  await server.app.listen({ host: "127.0.0.1", port: 0 });
  const url = `http://127.0.0.1:${server.app.server.address().port}`;
  browser = await chromium.launch({ channel: "chromium", headless: true });
  const context = await browser.newContext({
    locale: "zh-CN",
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on("pageerror", (e) => {
    errors.push(e.message);
    console.error("Browser error:", e.message);
  });
  await page.goto(url);
  await page.getByRole("button", { name: "English", exact: true }).click();
  assert.equal(await page.locator("html").getAttribute("lang"), "en");
  await page
    .getByLabel("One-time ticket", { exact: true })
    .fill("invalid-ticket");
  await page.getByRole("button", { name: "Open console", exact: true }).click();
  await page.getByRole("alert").waitFor();
  assert.match(await page.getByRole("alert").innerText(), /UNAUTHORIZED/);
  assert.doesNotMatch(
    await page.getByRole("alert").innerText(),
    /[\u4e00-\u9fff]/,
  );
  const ticket = server.store.credential("bootstrap", owner.product.id, 600000);
  await page.getByLabel("One-time ticket", { exact: true }).fill(ticket);
  await page.getByRole("button", { name: "Open console", exact: true }).click();
  await page
    .getByLabel("Article URL", { exact: true })
    .fill("https://example.com/preserved");
  await page.getByRole("button", { name: "简体中文", exact: true }).click();
  assert.equal(
    await page.getByLabel("文章链接", { exact: true }).inputValue(),
    "https://example.com/preserved",
  );
  await page.getByRole("button", { name: "English", exact: true }).click();
  assert.equal(
    await page.getByLabel("Article URL", { exact: true }).inputValue(),
    "https://example.com/preserved",
  );
  await page.reload();
  await page.getByLabel("Article URL", { exact: true }).waitFor();
  assert.equal(await page.locator("html").getAttribute("lang"), "en");
  for (const section of [
    "Browsers and devices",
    "Article artifacts",
    "Product credentials",
    "Diagnostics and site notes",
    "Tasks",
  ]) {
    await page
      .getByRole("navigation")
      .getByRole("button", { name: section, exact: true })
      .click();
    assert.equal(await page.locator(".page-head h1").innerText(), section);
    assert.doesNotMatch(
      await page.locator("main").innerText(),
      /[\u4e00-\u9fff]/,
    );
  }
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Product credentials", exact: true })
    .click();
  await page
    .getByLabel("Product name", { exact: true })
    .fill("语言测试 — user data");
  await page.getByRole("button", { name: "简体中文", exact: true }).click();
  assert.equal(
    await page.getByLabel("产品名称", { exact: true }).inputValue(),
    "语言测试 — user data",
  );
  await page.getByRole("button", { name: "English", exact: true }).click();
  await page
    .getByRole("button", { name: "Create credential", exact: true })
    .click();
  await page.getByRole("button", { name: "Saved", exact: true }).waitFor();
  assert.ok(
    server.store.list("product").some((p) => p.name === "语言测试 — user data"),
  );
  await page.getByRole("button", { name: "Saved", exact: true }).click();
  await page.screenshot({
    path: path.join(home, "english-console.png"),
    fullPage: true,
  });
  // Persisted synthetic tasks exercise nonempty states without operating a real browser account.
  const created = server.store.createJob(
    owner.product,
    "task",
    "ui-display-fixture",
    {
      profileId: "prf_ui_fixture",
      workerId: "wrk_ui_fixture",
      type: "article.capture@v1",
      input: { url: "https://example.com/ui-fixture" },
    },
  ).job;
  server.store.transition(created.id, "failed", {
    error: { code: "ARTICLE_NOT_READY", message: "页面还在加载" },
    result: {
      manifest: {
        title: "任务标题 — unchanged",
        mediaCoverage: { downloadedImages: 0, failedImages: 1 },
        versionConsistent: false,
      },
    },
  });
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Tasks", exact: true })
    .click();
  const row = page
    .locator(".task-row")
    .filter({ hasText: "任务标题 — unchanged" });
  await row.waitFor();
  assert.match(await row.innerText(), /Failed/);
  await row.click();
  assert.match(await page.locator(".detail .error").innerText(), /not ready/);
  assert.match(
    await page.locator(".detail .error").innerText(),
    /ARTICLE_NOT_READY/,
  );
  const taskDate = await row.locator("small").innerText();
  await page.getByRole("button", { name: "简体中文", exact: true }).click();
  assert.match(await row.innerText(), /失败/);
  assert.notEqual(await row.locator("small").innerText(), taskDate);
  assert.equal(
    await page.locator(".detail-title h2").innerText(),
    "任务标题 — unchanged",
  );
  await page.getByRole("button", { name: "English", exact: true }).click();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Diagnostics and site notes", exact: true })
    .click();
  await page.getByLabel("Website domain", { exact: true }).fill("example.com");
  await page.getByRole("button", { name: "Read notes", exact: true }).click();
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll("button")].find(
        (b) => b.textContent === "Read notes",
      )?.disabled === false,
  );
  await page
    .getByLabel("Personal notes · Version 0", { exact: true })
    .fill("中文笔记 stays unchanged");
  await page.getByRole("button", { name: "简体中文", exact: true }).click();
  assert.equal(
    await page.locator("textarea").inputValue(),
    "中文笔记 stays unchanged",
  );
  await page.getByRole("button", { name: "English", exact: true }).click();
  await page
    .getByRole("button", { name: "Save new version", exact: true })
    .click();
  await page.waitForFunction(() =>
    document
      .querySelector("textarea")
      ?.closest("label")
      ?.textContent?.includes("Version 1"),
  );
  assert.equal(
    server.store.note(owner.product.id, "example.com").body,
    "中文笔记 stays unchanged",
  );
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Product credentials", exact: true })
    .click();
  let prompt;
  page.once("dialog", async (dialog) => {
    prompt = dialog.message();
    await dialog.dismiss();
  });
  await page.getByRole("button", { name: "Revoke", exact: true }).click();
  assert.equal(
    prompt,
    "Revoke credentials for 语言测试 — user data and stop its tasks?",
  );
  assert.equal(
    server.store.list("product").find((p) => p.name === "语言测试 — user data")
      .revoked,
    false,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "简体中文", exact: true }).click();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "任务", exact: true })
    .click();
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.screenshot({
    path: path.join(home, "chinese-mobile.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "English", exact: true }).click();
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.screenshot({
    path: path.join(home, "english-mobile.png"),
    fullPage: true,
  });
  const english = await browser.newContext({ locale: "en-US" });
  const fresh = await english.newPage();
  await fresh.goto(url);
  await fresh.getByLabel("One-time ticket", { exact: true }).waitFor();
  assert.equal(await fresh.locator("html").getAttribute("lang"), "en");
  assert.deepEqual(errors, []);
  const report = {
    passed: true,
    scope:
      "Real Chromium with isolated real HTTP service; locale detection/persistence, login error, five sections, input preservation, actual credential creation, persisted task state/error/date display, real site-note saving, localized confirmation with cancellation, mobile layout. No daily browser or external website used.",
  };
  fs.writeFileSync(
    path.join(home, "report.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify({ home, ...report }));
} finally {
  await browser?.close();
  await server.app.close();
}
