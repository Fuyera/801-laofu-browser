// Test harness only. Production deployment never selects this entry point.
// A tiny reserved URL prefix is fulfilled with synthetic pages in the real browser;
// all other traffic, including the eight isolation checks, uses the real gateway.
import fs from "node:fs";
import { spawn } from "node:child_process";
import { Worker } from "../../dist/worker.js";
const config = JSON.parse(fs.readFileSync("/data/worker.json"));
const identity = process.env.LAOFU_FIXTURE_ID;
if (!["A", "B"].includes(identity))
  throw Error("explicit fixture identity required");
const children = [
  spawn("Xvfb", [":98", "-screen", "0", "1440x1000x24", "-nolisten", "tcp"], {
    stdio: "ignore",
  }),
];
await new Promise((r) => setTimeout(r, 600));
children.push(
  spawn("fluxbox", [], {
    env: { ...process.env, DISPLAY: ":98" },
    stdio: "ignore",
  }),
);
children.push(
  spawn(
    "x11vnc",
    [
      "-display",
      ":98",
      "-localhost",
      "-rfbport",
      "5901",
      "-forever",
      "-shared",
      "-nopw",
      "-quiet",
    ],
    { stdio: "ignore" },
  ),
);
const worker = new Worker(config),
  start = worker.browser.start.bind(worker.browser);
worker.browser.start = async () => {
  console.log("fixture: starting browser");
  for (const name of ["SingletonLock", "SingletonCookie", "SingletonSocket"]) {
    const file = config.home + "/chrome-profile/" + name;
    try {
      console.log("fixture: " + name + "=" + fs.readlinkSync(file));
    } catch {}
  }
  await start();
  console.log("fixture: browser ready, adding reserved synthetic route");
  await worker.browser.context.route(
    "https://example.com/__lb_test/**",
    async (route) => {
      const request = route.request(),
        url = new URL(request.url());
      const authenticated = (
        (await request.allHeaders()).cookie || ""
      ).includes("lb_fixture=" + identity);
      if (url.pathname.endsWith("/login") && !authenticated)
        return route.fulfill({
          contentType: "text/html; charset=utf-8",
          body: `<title>请先登录</title><style>body{padding:50px;font:24px system-ui;background:${identity === "A" ? "#cbe8ff" : "#d7ffe0"}}</style><h1>测试身份 ${identity}</h1><p>请先登录。这是隔离回归的合成账号。</p><button autofocus style="font:24px system-ui;padding:20px" onclick="document.cookie='lb_fixture=${identity};Path=/__lb_test;SameSite=Strict';location.href='/__lb_test/article'">登录测试身份 ${identity}</button>`,
        });
      return route.fulfill({
        contentType: "text/html; charset=utf-8",
        body: `<title>身份 ${identity} 正文</title><span id="account">${authenticated ? identity : "anonymous"}</span><article><h1>身份 ${identity} 的隔离样本</h1><p>${("仅属于身份 " + identity + " 的正文标记。").repeat(20)}</p></article>`,
      });
    },
  );
  console.log("fixture: route ready");
};
const stop = async () => {
  await worker.stop();
  for (const child of children) child.kill("SIGTERM");
};
process.once("SIGTERM", () => void stop());
process.once("SIGINT", () => void stop());
await worker.start();
console.log(
  JSON.stringify({
    fixture: identity,
    evidenceKind:
      "synthetic browser pages; live public and private network probes run separately",
  }),
);
