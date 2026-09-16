# P4 test report

[简体中文](TEST_REPORT.md) | **English**

## dev.3 delivery verification (2026-09-16)

Fixed source/artifacts, 50/50 tests, install/recovery 11/11, independent TS/Python SDKs, and daily Chrome lifecycle passed; see [release acceptance](evidence/release-dev3/acceptance.json). Install regression modified only an independent copy of the final archive. The 37 recorded source hashes still matched, permitting reuse of previous real evidence; the historical matrix was not labeled rerun. Package build commit: `c1a12c9`; subsequent changes only supplement delivery documentation.

## Historical test records

> 2026-09-15 X follow-up: signed-in daily Chrome read profiles, individual posts, search, and scrolled pages. List completeness failed: 12 DOM posts yielded 11 in both text/Markdown, with missing content recoverable from detail pages. This was the old 08:58 UTC build without latest adversarial fixes. See [X acceptance](X_READ_ACCEPTANCE.en.md) and [summary](evidence/x-read/summary.json). It does not replace latest-candidate, daily-lifecycle, or exhaustive-capture acceptance.

> 2026-09-15 adversarial remediation: confirmed portions of 28 A findings fixed; final unit/interface 50/50, isolated browser 19/19, dual Docker 8/8, takeover 2/2 passed. Initial matrix 22/24; two environment failures passed reruns, so all 24 items have passing evidence. See [fixes](ADVERSARIAL_FIXES.en.md) and [index](evidence/adversarial-fixes/index.json) for phases/failures/source hashes. The following 22/22 pre-fix matrix does not cover new changes. At that point P5, daily upgrade, and final release freeze were unfinished.

Date: 2026-09-14 local (logs 2026-09-15 UTC). Version `0.1.0-dev.2`, source `2b2fdad6df4a712cd33f594fd1c9399587199e14` plus that round's `fuyera/p4-macos` changes. **Matrix 22/22 passed; daily Chrome manual entrypoint remained, clean-source package/image reverification passed.** P5/cross-platform paused.

## Pre-fix historical results

The full matrix ran 02:03:10–02:11:11 UTC; see [report](evidence/p4/full.json). Every group exited 0 and passed report checks. The 22 groups include initialization/start/stop of the performance service, not 22 features or platforms.

|Check|Result|Source|
|---|---|---|
|Types/build/upstream baseline|Passed; 58 vendor files unchanged|Matrix typecheck/baseline; `workspace/p4/build-read-reconnect.log`|
|Behavior/HTTP|30/30|[unit](evidence/p4/unit.json), including read reconnect and no write replay|
|Contracts/basic capture/tools|Passed; 23 tools, 107 parameters|Matrix contract/smoke; [tools](evidence/p4/tools.json)|
|Same-input upstream comparison|40/40 in matrix; 43/43 separate rerun after CSP additions|[parity](evidence/p4/parity.json), `workspace/parity-ivgTQD`|
|Compatibility boundaries|6/6|[compatibility-edge](evidence/p4/compatibility-edge.json): sessions/background screenshots/concurrent debugger/disabled L2-CSP/no original-key replay|
|Articles/console|7/7|[article](evidence/p4/article.json), repository fixtures, not a new WeChat live run|
|P4 runtime|7/7|[runtime](evidence/p4/runtime.json): doctor, 30 reclamations, accounts, SSE resume/revoke, download deletion, 429/restart|
|Two isolated identities|8/8|[isolated](evidence/p4/isolated.json): eight checks per identity, same-volume restart, SDK installs, public network, synthetic accounts/noVNC|
|Faults/downloads/takeover|4/4, 2/2, 2/2|[faults](evidence/p4/faults.json), [downloads](evidence/p4/downloads.json), [handoff](evidence/p4/handoff.json)|
|TS/Python and attach|Passed|[sdk](evidence/p4/sdk.json), [attach](evidence/p4/attach.json); independent test Chromium for attach|
|dev.2 independent install|11/11|[install](evidence/p4/install.json): tampering, valid-manifest same-ID conflict, data retention, recovery/idempotency|
|Actual Codex host|3/3|[codex-host](evidence/p4/codex-host.json): recognize config, real tool call, uninstall|
|Local performance sample|3 passes|[performance](evidence/p4/performance.json): fixed 180-paragraph local page, 1.533–2.045 s; process-tree peak RSS approximately 1.69–1.71 GiB, counting shared pages repeatedly, not exclusive physical memory or public-network SLO|

Report provenance/scope/SHA-256: [index](evidence/p4/index.json). Matrix image: `sha256:2f2ae06755667edf59d8d6ee0107b6b8c8b9d25f5d0c8cd40989d8d9e2d0c3ef`; Mac candidate: `workspace/p4/package-final-matrix`. Both record dirty source, not a committed fixed release. The 43-check supplementary comparison cannot overwrite the original matrix's 40-check result.

## Corrections and scope

- TS SDK could reuse a closed HTTP connection after restart and GET failed ECONNRESET. Only GET ECONNRESET / UND_ERR_SOCKET retries once with a new connection; POST/writes/other failures do not. Actual HTTP disconnection tests proved writes occurred once. Install 11 and SDK retests passed, then the full matrix passed again.
- Worker shutdown closes persistent Chromium before display services; same-volume normal restart exits 0 and invalidates old boot proof. No profile-lock deletion or discarded config was used to force success.
- Register controlled pages before navigation to capture first-navigation 429. Actual `Retry-After: 120` persisted across restart, blocking revisits; releasing cooldown does not replay old tasks.
- Chromium 153 permitted concurrent debuggers from two extensions: the other connection remained usable and clicks happened once. Explicitly disabled L2 returned NEEDS_L2 for real clicks/CSP execution with zero effects. After restoring L2 a fresh request could read, but old keys did not replay. This does not generalize to other Chrome versions/all DevTools states.
- Actual host was installed Codex app-server with dedicated config and temporary protocol context. Tool discovery, browser invocation/read of fixture page, and uninstall passed. No model turn, persistent user task, or personal host-config change; not coverage of all 20 hosts.
- Public connectivity, isolation, and noVNC in two containers were actual execution. Account/cookie contents were labeled synthetic fixtures. Public gateway used existing host DNS `8.8.8.8/8.8.4.4`; internal Docker DNS/private/reserved-IP checks stayed effective.

## Reproduction

Keep the Mac open/awake, Docker available, and use a dedicated candidate directory:

```sh
export PATH="$PWD/.runtime/node-v22.23.2-darwin-arm64/bin:$PATH"
export npm_config_cache="$PWD/workspace/p4/npm-cache"
npm run build
node scripts/package-sdk.mjs
python3 -m pip wheel --no-deps --no-build-isolation --no-index ./sdk/python -w releases
node scripts/build-container.mjs --base laofu-browser:0.1.0-dev.1-delivery-2b2fdad --tag laofu-browser:0.1.0-dev.2-p4-candidate
node scripts/package-release.mjs --staging --output workspace/p4/new-candidate
LAOFU_CODEX_BINARY=/Applications/ChatGPT.app/Contents/Resources/codex LAOFU_PUBLIC_DNS=8.8.8.8,8.8.4.4 LAOFU_TEST_IMAGE=laofu-browser:0.1.0-dev.2-p4-candidate LAOFU_PACKAGE_CANDIDATE="$PWD/workspace/p4/new-candidate" caffeinate -i -s node scripts/full-regression.mjs
```

DNS parameters apply only to the authorized route. Without `LAOFU_CODEX_BINARY`, actual-host checks are omitted and a 22-group pass cannot be claimed. Install regression mutates its copy; never target frozen releases. The current full matrix includes 43 comparison checks.

## Delivery reverification from committed source

Source `580a6cf35e614e697bd802f8cc780ece6675a142`, clean at packaging. Image `sha256:cdfd0dce6016cf6f30f26192ea71a197f176ff7e960cae2555f8851100393ef8`; package `workspace/p4/package-clean-580a6cf`.

- [Install](evidence/p4/clean-install.json) 11/11; [dual identity](evidence/p4/clean-isolated.json) 8/8.
- [Mac extraction](evidence/p4/mac-archive.json): 19,789 files. [Docker archive](evidence/p4/docker-archive.json): 42 blob hashes, OCI index, platform/source labels match. OCI index ID and config blob digest are separate fields.
- [Image version](evidence/p4/image-version.json): software/TS SDK/source commit and dirty=false agree. Offline builds replace current deploy/SDK/test/script source rather than inheriting same-named old base files.
- Archive/SDK bytes/hashes are in `workspace/p4/CANDIDATE.json`. Mac SHA-256: `6d4de8edd9ad38a7c825adb064b165e6a94735d42c9848d38265e5a9f56ed4da`. Still candidate; old DELIVERY not replaced and no public release then. Later docs commits do not alter package build provenance.

## Remaining work and history

Daily Chrome later passed installation, branding, connection, and basic X reads on 2026-09-15; see [X acceptance](X_READ_ACCEPTANCE.en.md). At this checkpoint the installed environment lacked latest fixes; candidate lifecycle/final package freeze remained. The user accepted X list omissions as a preview limitation. Earlier lock-screen waits describe that historical state, not a current unlock requirement.

The [lid-close interruption](evidence/p4/full-interrupted.json) remains historical, superseded by the 22/22 result. The first post-wake matrix exposed GET reconnect failure; the fixed matrix passed. Old dev.1 stays archival; no migration requirement. New-package rollback uses synthetic release IDs of the same program, not verified dev.1 downgrade compatibility.

Historical dev.1 reports and a single 30-image WeChat article remain at the evidence root. This round did not revisit WeChat. No claim covers Windows, Ubuntu, Japan deployment, or all 20 hosts in the field. Final assessment: [ACCEPTANCE](ACCEPTANCE.en.md).

## 2026-09-16 Console Language Update

Current-source UI now supports Chinese/English. Full build and frontend type checking passed. A real Chromium session against an independent local service verified initial language selection, remembered preferences, login errors, five sections, input/task selection preservation, task states/dates, credential creation, site-note saving, cancelled confirmation dialogs, and Chinese/English mobile layout. Task-state display uses explicitly synthetic persisted jobs; it is not a new website execution claim. The existing article/console regression passed all 7 groups using a real worker/extension and local synthetic pages, including capture, ZIP download, and safe preview. The 58 upstream files and 23-tool baseline remain unchanged.

See the [scoped evidence](evidence/ui-language.json). Run `node scripts/ui-language-regression.mjs` after building to reproduce the language checks. No full delivery matrix, remote-handoff live test, daily-service upgrade, or fixed-release rebuild was performed; the published dev.3 package predates this UI change.
