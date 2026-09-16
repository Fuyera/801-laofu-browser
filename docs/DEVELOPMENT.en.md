# Development guide

[简体中文](DEVELOPMENT.md) | **English**

Applies to `0.1.0-dev.2`. Repository: [Fuyera/801-laofu-browser](https://github.com/Fuyera/801-laofu-browser), main branch `main`. [CURRENT_CONTEXT](../CURRENT_CONTEXT.en.md) and [acceptance](ACCEPTANCE.en.md) govern current delivery and gaps; a successful build alone does not establish P4/P5 acceptance.

## Code and contract entry points

|Directory or file|Responsibility|
|---|---|
|`src/server.ts`, `contracts.ts`|Fastify HTTP, authentication, resource ownership, request/response contracts|
|`src/store.ts`, `broker.ts`|SQLite task persistence, idempotency, profile control, queuing, disconnection quarantine|
|`src/worker.ts`|Independent worker, pre-execution journal, control generations, cancellation, human waiting|
|`src/browser.ts`|Per-profile bridge, extension pairing, original-tool adapter|
|`src/article.ts`, `artifacts.ts`|Article integrity, original images/artifacts, limits, hashes, atomic publication|
|`src/network.ts`, `relay.ts`|Restricted-browser egress checks and control-interface proxy|
|`src/client.ts`, `sdk/python/`, `src/mcp.ts`, `src/cli.ts`|TS/Python, MCP, and CLI sharing the service contract|
|`web/`|React console: browsers/devices, tasks, article artifacts, product credentials, diagnostics/site notes|
|`vendor/huashu-chrome-1.2.0/`|Immutable 58-file upstream snapshot, including MIT license|
|`scripts/build-engine.mjs`|Central patch generation into `runtime/engine`|
|`test/`, `scripts/*regression.mjs`|Behavior/HTTP tests and real-browser regressions|

Execution follows `API / SDK / MCP / CLI → server → broker → worker → browser → extension and bridge`. Service and worker persist independently. Cookies stay on workers; sharing or transferring SQLite files is not a substitute for the remote protocol. Owners retain all tools; restricted products use dedicated containers/profiles with actual isolation evidence.

See [DESIGN](DESIGN.en.md) for product boundaries, [IMPLEMENTATION_PLAN](IMPLEMENTATION_PLAN.en.md) for approved phases/exits, and [API](API.en.md) for interfaces/state semantics. `docs/openapi.json` and `docs/schemas.json` are code exports, not manual-edit targets. `LAOFU_BROWSER_BASELINE.json` is frozen provenance; never rewrite it merely to pass tests.

## Prepare a source environment

The complete local regression environment is macOS arm64, Node **22.23.2**, Python **3.10+** (SDK tests also need venv/pip), and Docker Desktop (container/noVNC tests). `better-sqlite3` has native bindings; do not reuse `node_modules` across Node major versions.

```sh
git clone https://github.com/Fuyera/801-laofu-browser.git
cd 801-laofu-browser
node --version
npm ci --no-audit --no-fund
node node_modules/playwright/cli.js install chromium
npm run build
```

`npm ci` and browser installation require network access. The runtime uses the Chromium paired with locked Playwright, not daily Chrome as a replacement test environment. A clean clone excludes `.runtime/`, `node_modules/`, `runtime/`, `dist/`, `releases/`, and `workspace/`. `bin/laofu-browser` prefers bundled Node or the pinned local `.runtime` Node, otherwise PATH Node. It never downloads a runtime automatically.

Build order: upstream hash verification/patch generation → TypeScript compilation → Vite console build. Edit the extension patch generator, not `vendor/`; manually modified `runtime/` is not source.

## Basic checks

Run at the project root under Node 22:

```sh
npm run build
npm run typecheck
node --import tsx --test test/*.test.ts
npm run verify:baseline
node scripts/ui-language-regression.mjs
node scripts/export-contract.mjs
git diff -- docs/openapi.json docs/schemas.json
```

`node --import tsx --test` runs the same tests as `npm test` without the tsx CLI's additional IPC socket. Contract export also compares 23 tools, 107 top-level parameters, and nested definitions. Commands must exit 0 with no failed tests. Inspect each real-browser report rather than relying only on process exit status.

## Real regressions

First run `mkdir -p workspace`. These scripts create isolated services, profiles, logs, and reports under `workspace/`; do not target daily browsers or business state. Run sequentially because fixed ports overlap, notably parity and noVNC on 17972. The OS must permit local listeners, Chromium child processes, and Docker operations.

|Command|Coverage and prerequisites|
|---|---|
|`node scripts/smoke.mjs`|Actual service startup, capture, ZIP download, hashes|
|`node scripts/tool-regression.mjs`|23 original tools, fixture forms/files, iframe, Shadow DOM, extension reload|
|`node scripts/upstream-parity.mjs`|Same-input original/adapted behavior, errors/reconnect; original changes only isolate paths/ports|
|`node scripts/article-console-regression.mjs`|Long text, original/broken images, revision changes, 403/429, console/mobile layout; self-owned synthetic fixture by default, historical fixture optional|
|`node scripts/fault-regression.mjs`|Interrupt service/bridge after fixture POST executes but before receipt; same-key retries, old workers, act cancellation|
|`node scripts/sdk-smoke.mjs`|External installs of local TS tgz/Python wheel; upload/download, wait/resume, cancel, same task via CLI/MCP; local SDK packages required|
|`node scripts/attach-regression.mjs`|Independent external test Chrome pairing, offline state, browser preservation on stop|
|`node scripts/compatibility-edge-regression.mjs`|Two sessions/background screenshots, concurrent debugger, disabled L2/CSP failure without effects; independent Chromium|
|`LAOFU_CODEX_BINARY=/Applications/ChatGPT.app/Contents/Resources/codex node scripts/codex-host-regression.mjs`|Actual Codex app-server config recognition, tool use, uninstall; temporary protocol context, no model turn|
|`node scripts/download-regression.mjs`|32 MiB slow-stream timeout/cancel, confirmed transfer stop, no completed artifact, no same-key replay|
|`node scripts/handoff-regression.mjs`|noVNC input, reconnect, resume, ask cancellation in an independent Docker desktop; local image required|
|`node scripts/isolated-smoke.mjs`|Real container isolation; restricted capture proceeds only after every check passes; failure keeps access closed|
|`node scripts/install-regression.mjs`|Candidate integrity, actual startup, upgrade/rollback, startup-failure recovery, backup, plist|
|`node scripts/performance-probe.mjs`|180-paragraph page, 3 consecutive runs on a dedicated `LAOFU_TEST_STATE` service; full matrix starts its own isolated local service|

`container-probe.mjs` and `network-probe.mjs` run inside isolated containers, not directly on Mac. `reload-probe.mjs` is a manual diagnostic with lifecycle output but no complete pass assertions; tools/parity behavior establishes reload acceptance.

### Historical fixtures

`article-console-regression.mjs` supports `LAOFU_WECHAT_FIXTURE`. The directory must contain `article.json` (body in `body`), `image-text.json` (a JSON string with 11 Markdown image blocks between paragraphs), and `images/image-01.jpg` through `image-11.jpg`. Passing proves **offline replay of a historical fixture** only. The default creates an 11-image synthetic fixture in the test directory, identified as synthetic-browser-fixture. To replay historical material, explicitly provide an authorized existing fixture:

```sh
LAOFU_WECHAT_FIXTURE=/absolute/path/to/existing-fixture node scripts/article-console-regression.mjs
```

A missing explicitly selected fixture fails. Synthetic data is never labeled historical WeChat evidence. `test/article.test.ts` covers text conversion independent of fixtures; smoke covers basic real capture.

### SDK packages, installation candidates, and Docker

```sh
node scripts/package-sdk.mjs
python3 -m pip wheel --no-deps --no-build-isolation --no-index sdk/python -w releases
node scripts/package-release.mjs --staging --output workspace/new-candidate
LAOFU_PACKAGE_CANDIDATE="$PWD/workspace/new-candidate" node scripts/install-regression.mjs
```

Offline Python packaging requires local `setuptools>=68` and wheel. TS produces `releases/laofu-browser-0.1.0-dev.2.tgz`, Python the matching wheel. The Mac packager copies pinned local Node, browser, and dependencies into the specified output (default `workspace/package-candidate`). It refuses an existing directory; inspect and retain old candidates first. Installation regression temporarily corrupts and restores this **dedicated candidate copy**; never point it at the fixed release directory. It does not enable system autostart.

Commit verified source/docs before delivery packaging. Use a new version for each new release, then `node scripts/package-release.mjs` to create a Mac directory, tar.gz, and SHA-256 under `releases/`. `RELEASE.json` source.commit/source.dirty must identify the target commit and clean tree; unidentified non-Git provenance is null. Extract the final archive into a dedicated test candidate, run install regression, and verify all manifest entries. External `DELIVERY.json` records the commit, all package hashes, image ID, and reports. Archives are kept locally, excluded from source commits, and do not automatically create a GitHub Release.

Docker tests default to local `laofu-browser:0.1.0-dev.2`; build with `docker build -t laofu-browser:0.1.0-dev.2 -f deploy/docker/Dockerfile .`, requiring network access for system/browser dependencies. Handoff and isolation smoke scripts accept `LAOFU_TEST_IMAGE`; the deployer accepts `--image`. Reports must capture actual image ID, architecture, and code version; matching tags do not prove matching source. Linux arm64 under Mac Docker is not acceptance of Japan Ubuntu x86_64 or Windows.

## Evidence and completion

Own code/SDKs use the root MIT license. License changes must update `sdk/typescript/LICENSE`, `sdk/python/LICENSE`, and package metadata. Mac/Docker distributions retain root `LICENSE`, `NOTICE.md`, and upstream licenses. Public report redaction/hash rules are in [evidence notes](evidence/README.en.md).

Raw logs, task JSON, cookies, and profiles stay in controlled `workspace/`. Committed evidence contains reviewed reports and console screenshots only. Fixed reports live in `docs/evidence/`, with `index.json` hashes and `docs/traceability.json` requirement mappings. `collect-evidence.mjs RUN_MANIFEST.json OUTPUT_DIRECTORY` requires explicit reports, sources, results, and scope; it never updates requirement status automatically. Do not pass off old runs as current.

Reports identify version/commit, OS, time, commands, exit status, passing/failing checks, and raw evidence paths. Label reused artifacts/historical fixtures. Do not retry an executed action with unknown outcome using a new key/channel. Network failure may coexist with other passing checks; never relax private/reserved-address validation to obtain green results.

After changes, reconcile [acceptance](ACCEPTANCE.en.md), [current context](../CURRENT_CONTEXT.en.md), and user docs. Documentation changes require command/link/UI checks; protocol/behavior changes require relevant regressions. Development passes do not automatically establish P4/P5 acceptance.

## P4 full matrix and build provenance

```sh
node scripts/build-container.mjs --base your-verified-local-base-image --tag your-candidate-image
node scripts/package-release.mjs --staging --output workspace/current-candidate
LAOFU_TEST_IMAGE=your-candidate-image LAOFU_PACKAGE_CANDIDATE="$PWD/workspace/current-candidate" node scripts/full-regression.mjs
node scripts/verify-release.mjs workspace/current-candidate
```

Keep the Mac lid open and awake during browser matrices. Sleep can expire persistent-task wall-clock budgets; preserve evidence and revalidate, never automatically replay unknown writes.

`full-regression` runs sequentially and saves completed results/current step. Setting `LAOFU_CODEX_BINARY` adds actual host checks. The recorded 22 groups passed; matrix parity had 40 checks and later CSP parity rerun 43, with separate evidence. Performance uses its own service, not the daily development service. `p4-runtime-regression` covers 30 captures, account scope, download revocation, doctor, SSE cursor/revocation, and real Retry-After/restart. `p4-isolated-regression` uses two actual isolated containers and externally installed SDKs, separately recording public-network checks and synthetic in-browser account fixtures. Synthetic pages only apply to a reserved test URL prefix; production does not use that entrypoint.

Configure previously authorized public DNS IPs explicitly through deployer `--dns` or test `LAOFU_PUBLIC_DNS`. They affect only the public proxy; internal control traffic retains Docker DNS. Internal names, private addresses, mapped IPv6, and reserved addresses remain denied. Do not switch resolvers by default.

package.json is the version entrypoint; builds generate runtime/build.json. HTTP, workers, MCP, and CLI share one software version; API version is independently v1. Fixed releases require committed clean Git source; development candidates accurately record dirty. Image builds verify base dependencies and record actual base/result IDs and source commit.

UI localization lives in `web/messages.ts` and `web/i18n.tsx`; use `t()` for interface messages, keeping task data and protocol identifiers unchanged. After building, `scripts/ui-language-regression.mjs` starts an isolated local service and real Chromium to check language persistence, form preservation, real API actions, and layout. Browser regressions with Chinese selectors explicitly set `locale: "zh-CN"`.
