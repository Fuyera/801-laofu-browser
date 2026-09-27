import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import { chromium } from "playwright";
const home = fs.mkdtempSync(path.join(os.tmpdir(), "laofu-tab-cleanup-"));
const extension = path.resolve(
  process.env.LAOFU_TEST_EXTENSION || "runtime/engine/extension",
);
const context = await chromium.launchPersistentContext(home, {
  channel: "chromium",
  headless: true,
  ignoreDefaultArgs: ["--disable-extensions"],
  args: [
    `--disable-extensions-except=${extension}`,
    `--load-extension=${extension}`,
  ],
});
try {
  const worker =
    context.serviceWorkers()[0] ||
    (await context.waitForEvent("serviceworker"));
  const result = await worker.evaluate(async () => {
    const errors = [];
    self.addEventListener("unhandledrejection", (e) =>
      errors.push(String(e.reason)),
    );
    const tab = await chrome.tabs.create({ url: "about:blank", active: false });
    const id = tab.id,
      other = 987654321;
    await chrome.storage.local.set({
      activeTabId: id,
      "agentTab:cleanup-test": id,
      "agentTab:other": other,
      [`tabLabel:${id}`]: "test",
      "ownTabs:cleanup-test": [id, other],
    });
    await chrome.storage.session.set({
      unrelated: "preserve",
      [`seen:cleanup-test:${id}`]: true,
      [`frames:${id}`]: { test: true },
      [`frames:${other}`]: { preserve: true },
    });
    await chrome.tabs.remove(id);
    const until = Date.now() + 5000;
    let local, session;
    do {
      await new Promise((r) => setTimeout(r, 50));
      local = await chrome.storage.local.get(null);
      session = await chrome.storage.session.get(null);
      if (!(`frames:${id}` in session)) break;
    } while (Date.now() < until);
    return {
      errors,
      closedId: id,
      localCleared:
        local.activeTabId !== id &&
        !("agentTab:cleanup-test" in local) &&
        !(`tabLabel:${id}` in local),
      registryPruned:
        JSON.stringify(local["ownTabs:cleanup-test"]) ===
        JSON.stringify([other]),
      sessionCleared:
        !(`seen:cleanup-test:${id}` in session) && !(`frames:${id}` in session),
      otherPreserved:
        session.unrelated === "preserve" &&
        session[`frames:${other}`]?.preserve === true &&
        local["agentTab:other"] === other,
    };
  });
  fs.writeFileSync(
    path.join(home, "report.json"),
    JSON.stringify({ extension, ...result }, null, 2),
  );
  assert.deepEqual(result.errors, []);
  for (const k of [
    "localCleared",
    "registryPruned",
    "sessionCleared",
    "otherPreserved",
  ])
    assert.equal(result[k], true, k);
  console.log(
    JSON.stringify({
      status: "passed",
      ...result,
      report: path.join(home, "report.json"),
    }),
  );
} finally {
  await context.close();
}
