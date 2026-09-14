import net from "node:net";
import http from "node:http";
import { chromium } from "playwright";
const connect = (host, port) =>
  new Promise((resolve) => {
    const s = net.connect({ host, port });
    s.setTimeout(1600);
    s.once("connect", () => {
      s.destroy();
      resolve(true);
    });
    s.once("timeout", () => {
      s.destroy();
      resolve(false);
    });
    s.once("error", () => resolve(false));
  });
const request = (port, url) =>
  new Promise((resolve) => {
    const req = http.get({ hostname: "gateway", port, path: url }, (res) => {
      res.resume();
      resolve(res.statusCode);
    });
    req.setTimeout(3000, () => {
      req.destroy();
      resolve(0);
    });
    req.on("error", () => resolve(0));
  });
const direct = await connect("1.1.1.1", 443);
const control = await request(18881, "/v1/admin/products");
const privateNet = await request(
  18880,
  "http://169.254.169.254/latest/meta-data/",
);
const ctx = await chromium.launchPersistentContext("/data/net-probe", {
  headless: true,
  channel: "chromium",
  chromiumSandbox: true,
  args: [
    "--proxy-server=http://gateway:18880",
    "--proxy-bypass-list=<-loopback>",
    "--disable-quic",
  ],
});
try {
  const page = await ctx.newPage();
  let publicAllowed = false;
  let publicError = null;
  try {
    await page.goto("https://example.com", { timeout: 25000 });
    publicAllowed = (await page.title()).includes("Example");
  } catch (e) {
    publicError = e.message;
  }
  let privateDenied = false;
  try {
    const r = await page.goto("http://host.docker.internal:17889/healthz", {
      timeout: 5000,
    });
    privateDenied = r?.status() === 403;
  } catch {
    privateDenied = true;
  }
  const checks = {
    nonRoot: process.getuid() !== 0,
    directEgressDenied: !direct,
    controlRoutesDenied: control === 403,
    privateNetworkDenied: privateNet === 403 && privateDenied,
    publicEgressAllowed: publicAllowed,
  };
  console.log(JSON.stringify({ checks, publicError }));
  if (Object.values(checks).some((v) => !v))
    throw new Error("NETWORK_PROBE_FAILED");
} finally {
  await ctx.close();
}
