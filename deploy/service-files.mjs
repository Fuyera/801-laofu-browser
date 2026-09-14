import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
const { values: v } = parseArgs({
  options: {
    root: { type: "string" },
    home: { type: "string" },
    config: { type: "string" },
    output: { type: "string" },
    platform: { type: "string" },
  },
});
if (!v.root || !v.home || !v.output)
  throw new Error("--root --home --output required");
const root = path.resolve(v.root),
  home = path.resolve(v.home),
  out = path.resolve(v.output),
  platform = v.platform || process.platform;
fs.mkdirSync(out, { recursive: true, mode: 0o700 });
const node = path.join(
    root,
    "node",
    platform === "win32" ? "node.exe" : "bin/node",
  ),
  cli = path.join(root, "dist/cli.js");
const programs = [
  { name: "service", args: [cli, "serve", "--home", home] },
  ...(v.config
    ? [
        {
          name: "worker",
          args: [cli, "worker", "--config", path.resolve(v.config)],
        },
      ]
    : []),
];
const xml = (s) =>
  String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
for (const p of programs) {
  if (platform === "darwin")
    fs.writeFileSync(
      path.join(out, `com.laofu.browser.${p.name}.plist`),
      `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>Label</key><string>com.laofu.browser.${p.name}</string><key>ProgramArguments</key><array>${[node, ...p.args].map((x) => "<string>" + xml(x) + "</string>").join("")}</array><key>WorkingDirectory</key><string>${xml(root)}</string><key>EnvironmentVariables</key><dict><key>PLAYWRIGHT_BROWSERS_PATH</key><string>${xml(path.join(root, "browsers"))}</string></dict><key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>15</integer><key>StandardOutPath</key><string>${xml(path.join(home, p.name + ".log"))}</string><key>StandardErrorPath</key><string>${xml(path.join(home, p.name + ".log"))}</string></dict></plist>`,
      { mode: 0o600 },
    );
  else if (platform === "linux") {
    const quote = (s) =>
      '"' +
      s.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("%", "%%") +
      '"';
    fs.writeFileSync(
      path.join(out, `laofu-browser-${p.name}.service`),
      `[Unit]\nDescription=laofu-browser ${p.name}\nAfter=network.target\n[Service]\nType=simple\nWorkingDirectory=${quote(root)}\nEnvironment=PLAYWRIGHT_BROWSERS_PATH=${quote(path.join(root, "browsers"))}\nExecStart=${[node, ...p.args].map(quote).join(" ")}\nRestart=on-failure\nRestartSec=15\nUMask=0077\n[Install]\nWantedBy=default.target\n`,
    );
  } else if (platform === "win32") {
    const sq = (s) => "'" + s.replaceAll("'", "''") + "'";
    fs.writeFileSync(
      path.join(out, `register-${p.name}.ps1`),
      `# 仅在本人 Windows 登录会话中运行；本包须在 Windows 本机构建并验收。\n$action = New-ScheduledTaskAction -Execute ${sq(node)} -Argument ${sq(p.args.map((a) => '"' + a.replaceAll('"', '\\"') + '"').join(" "))} -WorkingDirectory ${sq(root)}\n$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME\nRegister-ScheduledTask -TaskName 'laofu-browser-${p.name}' -Action $action -Trigger $trigger -RunLevel Limited\n`,
    );
  } else throw new Error("unsupported platform");
}
console.log(JSON.stringify({ generated: out, platform, installed: false }));
