import fs from "node:fs";
import path from "node:path";
import { BrowserAdapter } from "../dist/browser.js";
const home = fs.mkdtempSync(path.resolve("workspace/reload-"));
const b = new BrowserAdapter({
  home,
  profileId: "probe",
  headless: true,
  bridgePort: 18941,
});
await b.start();
const job = {
  id: "probe",
  fence: 1,
  expiresAt: Date.now() + 180000,
  sessionId: "probe",
};
const logs = [];
b.context.on("serviceworker", (sw) =>
  logs.push({ event: "serviceworker", url: sw.url(), time: Date.now() }),
);
b.context.on("console", (msg) => {
  if (msg.type() === "error")
    logs.push({ type: msg.type(), text: msg.text().slice(0, 1000) });
});
try {
  const sw = b.context.serviceWorkers()[0],
    ext = sw.url().split("/")[2];
  console.log({
    home,
    ext,
    workers: b.context.serviceWorkers().map((s) => s.url()),
  });
  await b.control(job);
  console.log(await b.raw("reload", {}, job));
  await new Promise((r) => setTimeout(r, 3000));
  console.log({
    online: b.rpc.extensionOnline,
    workers: b.context.serviceWorkers().map((s) => s.url()),
  });
  const page = await b.context.newPage();
  await page.goto("chrome://extensions");
  console.log("extensions", await page.locator("body").innerText());
  console.log(
    "details",
    JSON.stringify(
      await page.evaluate(
        () =>
          new Promise((r) =>
            chrome.developerPrivate.getExtensionsInfo(
              { includeDisabled: true, includeTerminated: true },
              (v) =>
                r(
                  v.map(({ id, name, state, disableReasons }) => ({
                    id,
                    name,
                    state,
                    disableReasons,
                  })),
                ),
            ),
          ),
      ),
      null,
      2,
    ),
  );
  try {
    await page.goto("chrome-extension://" + ext + "/popup.html", {
      timeout: 10000,
    });
    console.log("popup", await page.locator("body").innerText());
  } catch (e) {
    console.log(e.message);
  }
  await new Promise((r) => setTimeout(r, 4000));
  console.log({
    online: b.rpc.extensionOnline,
    workers: b.context.serviceWorkers().map((s) => s.url()),
    logs,
  });
  fs.writeFileSync(path.join(home, "logs.json"), JSON.stringify(logs, null, 2));
} finally {
  await b.stop();
}
