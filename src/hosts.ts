import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { ROOT } from "./catalog.js";
import { Fault } from "./errors.js";
import { privateFile } from "./util.js";
const catalog = JSON.parse(
  fs.readFileSync(
    path.join(ROOT, "vendor/huashu-chrome-1.2.0/src/agents.json"),
    "utf8",
  ),
);
export function discoverHosts(userHome = os.homedir(), discover = false) {
  const appData =
    process.env.APPDATA ||
    path.join(
      userHome,
      process.platform === "darwin" ? "Library/Application Support" : ".config",
    );
  const expand = (s: string) =>
    s.replace(/^~/, userHome).replace("$APPDATA", appData);
  const found = catalog.agents.map((a: any) => ({
    ...a,
    paths: a.paths.map(expand),
    existing: a.paths.map(expand).filter((p: string) => fs.existsSync(p)),
  }));
  if (discover) {
    for (const dir of fs.readdirSync(userHome, { withFileTypes: true })) {
      if (
        !dir.isDirectory() ||
        !dir.name.startsWith(".") ||
        catalog._discovery.skipDirs.includes(dir.name)
      )
        continue;
      for (const rel of catalog._discovery.filenames) {
        const file = path.join(userHome, dir.name, rel);
        if (
          found.some((h: any) => h.paths.includes(file)) ||
          !fs.existsSync(file) ||
          fs.lstatSync(file).isSymbolicLink() ||
          fs.statSync(file).size > 1024 ** 2
        )
          continue;
        try {
          const data = JSON.parse(fs.readFileSync(file, "utf8"));
          if (data.mcpServers)
            found.push({
              name: dir.name,
              client: dir.name.slice(1),
              kind: "json",
              paths: [file],
              existing: [file],
            });
        } catch {}
      }
    }
  }
  return found;
}
export function hostConfig(
  existing: string,
  kind: string,
  entry: { command: string; args: string[] },
  remove = false,
) {
  if (kind === "json") {
    let data: any;
    try {
      data = existing.trim() ? JSON.parse(existing) : {};
    } catch {
      throw new Fault("HOST_CONFIG_INVALID", "宿主 JSON 无法解析，未改写");
    }
    data.mcpServers ||= {};
    if (remove) delete data.mcpServers["laofu-browser"];
    else data.mcpServers["laofu-browser"] = entry;
    return JSON.stringify(data, null, 2) + "\n";
  }
  if (kind !== "toml")
    throw new Fault("INVALID_ARGUMENT", "不支持的宿主配置格式");
  const lines = existing.split("\n"),
    kept: string[] = [];
  let skip = false;
  for (const line of lines) {
    if (/^\s*\[/.test(line)) {
      skip =
        /^\s*\[mcp_servers\.(?:laofu-browser|"laofu-browser"|'laofu-browser')(?:\.[^\]]+)?\]\s*(?:#.*)?$/.test(
          line,
        );
    }
    if (!skip) kept.push(line);
  }
  return (
    kept.join("\n").trimEnd() +
    "\n" +
    (remove
      ? ""
      : `\n[mcp_servers.laofu-browser]\ncommand = ${JSON.stringify(entry.command)}\nargs = ${JSON.stringify(entry.args)}\n`)
  );
}
export function installHost(options: {
  host: string;
  home: string;
  profileId: string;
  apply?: boolean;
  remove?: boolean;
  target?: string;
  userHome?: string;
}) {
  const row = discoverHosts(options.userHome).find(
    (a: any) => a.client === options.host,
  );
  if (!row)
    throw new Fault(
      "HOST_UNKNOWN",
      "宿主不在基线目录；使用 mcp-config 生成通用配置",
    );
  const target = path.resolve(
    options.target || row.existing[0] || row.paths[0],
  );
  if (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink())
    throw new Fault(
      "HOST_CONFIG_SYMLINK",
      "配置为符号链接；请显式指定真实目标路径",
    );
  const before = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : "";
  const after = hostConfig(
    before,
    row.kind,
    {
      command: process.execPath,
      args: [
        path.join(ROOT, "dist/cli.js"),
        "mcp",
        "--home",
        options.home,
        "--profile",
        options.profileId,
      ],
    },
    options.remove,
  );
  let backup: string | null = null;
  if (options.apply && before !== after) {
    if (before) {
      backup = target + ".laofu-backup-" + Date.now();
      privateFile(backup, before);
    }
    privateFile(target, after);
  }
  return {
    host: row.name,
    target,
    changed: before !== after,
    applied: !!options.apply,
    backup,
    change: options.remove
      ? "remove only laofu-browser MCP entry"
      : "upsert only laofu-browser MCP entry",
    credentialsIncluded: false,
  };
}
