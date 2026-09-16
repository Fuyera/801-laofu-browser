# Installation, isolated deployment, and troubleshooting

[简体中文](OPERATIONS.md) | **English**

The current preview targets macOS arm64. Fixed packages and version-specific acceptance records are on [GitHub Releases](https://github.com/Fuyera/801-laofu-browser/releases). Ubuntu 24.04 x86_64 and Windows 11 x86_64 have not passed actual acceptance; Linux arm64 under Mac Docker does not establish support for those systems.

See the [user guide](USER_GUIDE.en.md) for daily login, capture, and takeover, and the [development guide](DEVELOPMENT.en.md) for source/test environments. The final dev.3 package, both SDKs, and daily Chrome stop/reconnect passed acceptance; see the [test report](TEST_REPORT.en.md). Docker isolation source and evidence remain available, but this preview Release does not include a Docker image archive.

## Fixed Mac artifacts

`laofu-browser-0.1.0-dev.3-macos-arm64.tar.gz` includes source, lockfile, generated extension, service, console, Node 22.23.2, Chromium, and dependencies. Its .sha256 verifies integrity, not third-party signing. RELEASE.json records source commit, dirty state, per-file hashes, and platform/database scope. External DELIVERY.json records build commit, hashes, and verification for delivery files. Fixed release IDs cannot be overwritten with different content; rebuild tests use candidate directories only. Packages exclude local accounts, browser profiles, and test credentials.

Verify and extract in the download directory:

```sh
shasum -a 256 -c laofu-browser-0.1.0-dev.3-macos-arm64.tar.gz.sha256
tar -xzf laofu-browser-0.1.0-dev.3-macos-arm64.tar.gz
```

After extraction, run `bin/laofu-browser` directly; no global npm install is needed. Run the version manager with bundled Node (replace example paths with your extracted and chosen installation directories):

```sh
/path/to/extracted-package/node/bin/node /path/to/extracted-package/deploy/manage.mjs install --source /path/to/extracted-package --prefix /your/chosen/path/laofu-browser
/path/to/extracted-package/node/bin/node /path/to/extracted-package/deploy/manage.mjs start --prefix /your/chosen/path/laofu-browser
/path/to/extracted-package/node/bin/node /path/to/extracted-package/deploy/manage.mjs status --prefix /your/chosen/path/laofu-browser
```

The installation contains `releases/` and separate `state/`. Startup is loopback-only and authenticated. Use the current release's `bin/laofu-browser console-login --home /installation-directory/state` to get a one-time console URL. Stop with manage.mjs stop; other Chrome instances and artifacts are retained.

Upgrade by running install against the new fixed package. It verifies files/platform, stops this installation's processes, backs up database/config, checks schema compatibility, and switches versions. Failed startup restores the old program. `rollback --release <releaseId>` selects an existing compatible version. **Program rollback does not roll back command/effect/idempotency records**, preventing already-submitted work from being mistaken for unexecuted work. Old dev.1 is archival and must not open dev.2 state; historical downgrade compatibility is unverified. Older programs cannot open higher-schema state. Migration requires a separate plan; this version does not automatically migrate or restore old production data.

Backup requires original processes stopped. Database backup excludes large browser profiles/artifacts, which stay in place. For disaster recovery, stop all execution and have the owner back up state plus every worker directory.

## Optional autostart and hosts

`deploy/service-files.mjs --root /release-directory --home /state-directory --output /config-output-directory [--config /worker-config.json]` generates configuration only, without registering autostart. Mac gets launchd plist, Linux a user systemd unit, Windows a login-session scheduled-task script. The owner decides whether to enable it. Never launch the same state directory with both local.mjs and a service manager. Mac example: `launchctl bootstrap gui/$(id -u) /specific.plist`; stop with `launchctl bootout` and the same path. Workers requiring desktop takeover should run in the owner's graphical login session.

`bin/laofu-browser install` lists candidate configuration/existence for 20 baseline hosts. Only `--discover` checks upstream-defined hidden-directory candidates; existing contents are not printed. `install --host codex --profile prf_...` previews target/scope; `--apply` writes with backup while preserving other MCP entries. `uninstall --host codex --profile prf_... --apply` removes only laofu-browser entries and retains user results. JSON and Codex TOML have temporary-directory behavioral tests. Installed Codex app-server passed recognition, tool execution, and uninstall using dedicated config/temporary protocol context; no model turn or claim of actually launching all 20 hosts.

## Personal daily Chrome

`pair --attach --name PersonalChrome` creates separate worker credentials and bridge port. The started worker waits for the extension while service status remains queryable as offline. Load its displayed `engine/extension` directory into your Chrome; readiness follows automatically. Do not copy laofu-config.js from another profile or send your personal extension directory to restricted products. Managed mode launches dedicated Playwright Chromium automatically; business actions still use the extension adapter.

`extension --config ...` shows the directory. `doctor` separately reports package, bridge/extension readiness, and worker environment; target-site access defaults to not_checked. Use `doctor --site URL --profile prf_...` for bounded capture diagnostics. Extension reload is not browser restart. Disabling Chrome developer mode disables reloaded unpacked extensions; enable it in that same dedicated browser.

## Restricted product browsers

Build the image defined by `deploy/docker/Dockerfile` on Mac Docker Desktop. It runs as node, drops all capabilities, uses no-new-privileges, separate persistent volume/profile, Xvfb, and loopback VNC. seccomp allows browser user-namespace calls without adding host capabilities or using --no-sandbox. The gateway is the instance's only egress. It resolves DNS then pins connections to public IPs, denying private, localhost, metadata, and reserved addresses. Gateway-to-core access allows only worker interfaces with separate worker credentials.

Since the 2026-09-15 fix, the deployer selects private `eth0`; 18880/18881 bind only that interface address. Default-bridge neighbors cannot access them, and the core still validates worker credentials. Missing interfaces fail startup; standalone launches without an interface bind loopback only. Updating code does not update running gateways: rebuild through the original deployer when upgrading. Updating only worker images does not apply this fix. That run tested temporary containers, not a rebuilt daily environment.

Worker journal bodies/source-metadata last 7 days. Cleanup retains idempotency digests/execution states and never replays expired/unknown writes. Workers clean their own jobs temporary directories after completion, including failure; startup/minute cleanup reclaims directories older than 24 hours. The service reclaims terminal unpublished packages and old .partial files each minute, without deleting active uploads or delivered artifacts. Disk/product quotas remain hard limits; cleanup does not replace quota configuration or backups.

```sh
node deploy/isolated.mjs create --home /path/to/service-state --name product-a-browser
node deploy/isolated.mjs verify --home /path/to/service-state --id wrk_...
```

create grants no product access by default. verify checks non-root execution, real Chrome sandbox, internal networking, blocked direct egress/private addresses, rejected control access, public connectivity, and independent desktop. Only an all-pass report bound to actual bootId/image may be submitted. Then authorize one product in the console. One profile binds one product; existing cookies cannot be reassigned. Verify again after worker restart.

Host DNS may return reserved 198.18/15 addresses. P4 explicitly used the host's existing `8.8.8.8/8.8.4.4` only for public proxy resolution, leaving Docker control DNS unchanged; all eight dual-identity checks passed. Add `--dns 8.8.8.8,8.8.4.4` at create only in the environment where this route is authorized. The previously rejected Cloudflare DoH route was not used; public/private IP checks were not weakened.

Stop isolated deployment with `stop --id`, restart with `start --id`; volumes and command records remain. Linux-server Docker control-plane networking requires separate P5 acceptance; the Mac deployer does not claim that route is already supported.

## Human takeover and failures

- CAPTCHA/sign-in: waiting_user revokes automatic control. Operate the dedicated Mac browser directly or use console takeover for containers with a separate display. Disconnecting the viewer does not cancel; reconnect to the same task. Resume rereads the same page.
- Rate limits: RATE_LIMITED creates persistent cooldown blocking new tasks until trusted Retry-After expires or a maintainer explicitly releases it. Release does not replay old tasks or rotate IP/profile to evade limits.
- Original ask: the floating bar/until condition still works; the console can explicitly resume. Cancellation maps to cancelled, expiration to failed.
- Service/bridge/worker disconnection: tasks become suspended or failed with effectState=unknown. Verify external effects and confirm the old worker stopped. Reusing the key returns the original command without clicking again.
- Profile recovery: stop the old worker; call recover with explicit `confirmStopped` and `acknowledgeUnknownEffects`. Old commands are not revived. Restart after cleanup; new business requests must follow verified outcomes.
- Missing/broken images or changing text: partial includes usable output and missing items. Native download fallback applies only to explicitly rejected image GETs; unknown writes are not retried.
- Quota/disk: new artifacts stop at the 10 GiB quota; old results are not automatically deleted. Explicitly select files through console/API. Incomplete files also consume space; stop service and inspect orphans before cleanup, retaining command records.
- Logs: core/bridge daily logs last 30 days. Commands, external effects, idempotency, and note versions are stored separately in SQLite. Profiles, command journals, and original images are owner-managed. Diagnostics are not automatically sent externally.

## Japan and Windows (paused)

Japan deployment must use separate directories/users/ports, never overwrite existing experiments/services. When the user resumes P5, verify Ubuntu 24.04 x86_64 resources, networking, sandbox, and remote takeover, setting worker `location=server`. Cookies remain with the worker; do not share SQLite files.

Windows provides source preparation and login-session autostart config generation. Install pinned Node, build native dependencies, and run the same real-browser tests on Windows 11 x86_64. That environment is currently unavailable; cross-builds or Mac results are not substitutes. `deploy/windows/prepare.ps1` and `deploy/linux/prepare.sh` are preparation entrypoints, not acceptance evidence.
