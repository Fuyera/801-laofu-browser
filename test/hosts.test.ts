import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { hostConfig, installHost, discoverHosts } from "../src/hosts.js";
test("host installer preserves unrelated configuration, previews changes and creates reversible backups", (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "lb-hosts-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const target = path.join(home, "cursor.json"),
    before = JSON.stringify({
      ui: { theme: "dark" },
      mcpServers: { existing: { command: "keep" } },
    });
  fs.writeFileSync(target, before);
  const args = {
    host: "cursor",
    home,
    profileId: "prf_test",
    target,
    userHome: home,
  };
  assert.equal(installHost(args).applied, false);
  assert.equal(fs.readFileSync(target, "utf8"), before);
  const applied = installHost({ ...args, apply: true });
  assert.ok(applied.backup);
  assert.equal(fs.readFileSync(applied.backup!, "utf8"), before);
  const after = JSON.parse(fs.readFileSync(target, "utf8"));
  assert.equal(after.mcpServers.existing.command, "keep");
  assert.equal(after.ui.theme, "dark");
  assert.equal(installHost({ ...args, apply: true }).changed, false);
  installHost({ ...args, apply: true, remove: true });
  assert.equal(
    JSON.parse(fs.readFileSync(target, "utf8")).mcpServers["laofu-browser"],
    undefined,
  );
  assert.equal(discoverHosts(home).length, 20);
});
test("Codex TOML upsert preserves other tables and removes old nested laofu settings idempotently", () => {
  const entry = { command: "/path/node", args: ["/app/cli.js", "mcp"] },
    before =
      '# personal\nmodel = "existing"\n[mcp_servers.laofu-browser]\ncommand="old"\n[mcp_servers.laofu-browser.env]\nOLD="secret"\n[mcp_servers.keep]\ncommand="preserve"\n';
  const after = hostConfig(before, "toml", entry);
  assert.match(after, /model = "existing"/);
  assert.match(after, /command="preserve"/);
  assert.doesNotMatch(after, /OLD=/);
  assert.equal(hostConfig(after, "toml", entry), after);
});
