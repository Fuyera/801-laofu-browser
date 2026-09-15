import fs from "node:fs";
import { spawn } from "node:child_process";
const configPath = process.argv[2] || "/data/worker.json";
const config = JSON.parse(fs.readFileSync(configPath));
const children = [];
if (!config.headless) {
  const display = config.display || ":98";
  config.display = display;
  config.vncPort = config.vncPort || 5901;
  fs.writeFileSync(configPath, JSON.stringify(config), { mode: 0o600 });
  children.push(
    spawn(
      "Xvfb",
      [display, "-screen", "0", "1440x1000x24", "-nolisten", "tcp"],
      { stdio: "ignore" },
    ),
  );
  await new Promise((r) => setTimeout(r, 500));
  children.push(
    spawn("fluxbox", [], {
      env: { ...process.env, DISPLAY: display },
      stdio: "ignore",
    }),
  );
  children.push(
    spawn(
      "x11vnc",
      [
        "-display",
        display,
        "-localhost",
        "-rfbport",
        String(config.vncPort),
        "-forever",
        "-shared",
        "-nopw",
        "-quiet",
      ],
      { stdio: "ignore" },
    ),
  );
}
const worker = spawn(
  process.execPath,
  ["dist/cli.js", "worker", "--config", configPath],
  { stdio: "inherit" },
);
children.push(worker);
const stop = () => {
  // Keep the display alive until Chromium has closed and released its profile lock.
  worker.kill("SIGTERM");
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
worker.on("exit", (code) => {
  for (const child of children) if (child !== worker) child.kill("SIGTERM");
  process.exitCode = code || 0;
});
