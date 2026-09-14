import fs from "node:fs";
import { chromium } from "playwright";
console.log(
  JSON.stringify({
    uid: process.getuid(),
    node: process.version,
    platform: process.platform,
    arch: process.arch,
  }),
);
if (process.getuid() === 0) throw new Error("ROOT_NOT_ALLOWED");
const ctx = await chromium.launchPersistentContext("/data/sandbox-probe", {
  headless: true,
  channel: "chromium",
  chromiumSandbox: true,
});
try {
  const page = await ctx.newPage();
  await page.goto("chrome://sandbox");
  const sandbox = await page.locator("body").innerText();
  console.log(JSON.stringify({ sandbox }));
  if (
    !/Seccomp-BPF sandbox\s+Yes/.test(sandbox) ||
    !/Layer 1 Sandbox\s+Namespace/.test(sandbox) ||
    !/PID namespaces\s+Yes/.test(sandbox) ||
    !/Network namespaces\s+Yes/.test(sandbox)
  )
    throw new Error("SANDBOX_NOT_PROVEN");
  console.log("SANDBOX_PROBE_PASSED");
} finally {
  await ctx.close();
}
