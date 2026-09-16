# User guide

[简体中文](USER_GUIDE.md) | **English**

laofu-browser reads pages, performs operations in authorized browsers, and saves viewable/downloadable task results. This guide was written for the `0.1.0-dev.2` Mac development candidate and its dedicated owner browser/test scenarios. See [acceptance](ACCEPTANCE.en.md) for current restricted-product access, daily Chrome installation, and cross-system status.

## Open an existing local service

The README startup defaults to `http://127.0.0.1:17889` with state in `workspace/local-state`. From the project root, obtain a one-time login URL:

```sh
bin/laofu-browser console-login --home workspace/local-state
```

Open the complete printed URL. The ticket lasts 10 minutes and exchanges once; the resulting administration session lasts 8 hours. Run the command again after expiry. The URL contains a login ticket; do not forward it to other products or publish it. A login prompt is expected when opening the service without an administration session.

If stopped, start the service and dedicated owner browser under Node 22:

```sh
node scripts/local.mjs start --home workspace/local-state --browser
node scripts/local.mjs status --home workspace/local-state
```

First startup initializes its directory; existing state needs no repeated `init`. A running process does not prove site access. Confirm browser readiness in the console and judge success from task results.

For a new source environment see the [development guide](DEVELOPMENT.en.md); for fixed Mac packages follow [operations](OPERATIONS.en.md). GitHub source excludes Node, Chromium, SDK artifacts, and local account data; cloning alone is not installation.

## Capture an article

1. In “浏览器与设备” (Browsers and devices), confirm your dedicated browser is available.
2. Open “任务” (Tasks), enter the full article URL, select a browser, and click “采集图文” (Capture article and images).
3. Work queues then executes. Leave the console and return through recent tasks later; closing the page does not cancel.
4. Review content scope, image count, warnings, and state before downloading `article-with-images.zip`.
5. Extract and read `article.html`, or open `article.md` in a Markdown editor. Keep the adjacent `images/` directory when moving/sharing.

Output includes Markdown, safe reading HTML, original images, and `manifest.json`. Markdown preserves text/image order with relative package paths. The manifest records source, time, image counts, bytes, and hashes for checking omissions. Original images are not subjected to another product's publication compression rules.

Completed means the request's requirements were met within declared scope. `complete_for_scope` covers currently authorized visible text, not guaranteed collapsed, paid, paginated, or undisplayed content. Saving all images does not imply archiving audio, video, or embeds.

Login walls, loading pages, and unreplaced placeholders are not complete results. Download appears only after the whole package is saved; failure does not expose scattered files missing a manifest. Video/audio/cards individually report undownloaded state. Source links may be redacted; maintainers can inspect original addresses in controlled worker source records retained 7 days. Delivered artifacts are deleted explicitly by you, not automatically.

## Waiting, missing images, and failures

|Page state|Action|
|---|---|
|Queued/running|Wait and inspect progress; do not repeatedly create the same task|
|waiting_user|Complete login/page action in the correct browser, then click “已完成，继续任务” (Done, resume task)|
|partial|Download available results and inspect missing images/truncation/revision warnings; do not treat them as a complete archive|
|suspended or unknown effects|Check whether the original browser action happened; maintainer recovery confirmation is required, not direct resubmission|
|failed|Inspect error/task details; 403, 429, verification pages, and empty text are not packaged as articles|
|Stopping|Cancellation requested; await stop confirmation|
|cancelled|Task settled; prior webpage effects may not be reversible, so inspect the effect explanation|

For local tasks, act directly in the dedicated browser. Tasks with independent remote desktops offer “接手浏览器” (Take over browser). Reconnect to the same task after takeover disconnects; disconnecting viewing is not cancellation. Close the takeover window and explicitly resume when done. The system does not solve real CAPTCHAs automatically or rotate accounts/networks to retry restricted actions.

## Five console areas

|Area|Purpose|
|---|---|
|浏览器与设备 / Browsers and devices|Inspect mode, connection/readiness, and which browser is in use|
|任务 / Tasks|Create captures, inspect progress/results, cancel, resume, or take over|
|图文产物 / Article artifacts|Download or preview generated safe HTML; deletion denies new downloads and aborts in-flight server downloads|
|产品凭据 / Product credentials|Manage independent identities/permissions; restricted access stays closed if browser acceptance fails|
|诊断与经验 / Diagnostics and site notes|Inspect task duration/execution and site-note versions/history|

Full daily Chrome permissions belong only to the owner, never business products. Follow [operations](OPERATIONS.en.md#personal-daily-chrome) to manually load the separate extension in the target Chrome. Passing dedicated test Chrome does not prove your daily account is connected.

## Query and download from the CLI

Get the actual profile ID from Browsers and devices or `capabilities`. Replace the example IDs/URLs below; keep a stable idempotency key for the same request.

```sh
bin/laofu-browser capabilities --home workspace/local-state
bin/laofu-browser capture 'https://example.com/article' --profile prf_YOUR_ID --key article-UNIQUE_BUSINESS_ID --home workspace/local-state
bin/laofu-browser job tsk_YOUR_ID --home workspace/local-state
bin/laofu-browser download art_YOUR_ID --output ./article-with-images.zip --home workspace/local-state
bin/laofu-browser cancel tsk_YOUR_ID --home workspace/local-state
bin/laofu-browser resume tsk_YOUR_ID --home workspace/local-state
```

`capture` returns a task ID; queued does not mean complete. Query with `job`; download when an artifact ID appears. After disconnection, query using the original task ID/key rather than generating a new key for unknown work. SDK/MCP integration is in the [API guide](API.en.md).

Use “更早任务／产物” (Older tasks/artifacts) for pagination and “最新任务／产物” (Latest tasks/artifacts) to return to page one. Follow `nextCursor` from MCP `laofu_jobs`. Large screenshots return downloadable file references; small images can still display inline in supporting hosts.

## Stop, back up, and troubleshoot

Stop the development service and its managed dedicated workers:

```sh
node scripts/local.mjs stop --home workspace/local-state
```

Stopping preserves articles, tasks, and account state; it does not undo webpage effects. Handle running/human-waiting tasks first. See [operations](OPERATIONS.en.md) for backups, upgrades, rollback, and optional autostart. Autostart is not registered automatically.

- **Offline browser:** check worker execution and extension loading. Service availability and browser readiness are separate.
- **Article inaccessible:** inspect login/permissions/site prompts in the same browser. Default `doctor` does not visit sites; add `--site URL --profile YOUR_ID` for a bounded check.
- **Missing images:** download the complete ZIP with relative directories and inspect the manifest for failed/unsupported media.
- **Quota exceeded:** defaults are 10 GiB globally, 2 GiB/product, 20 queued and 24 unfinished tasks. Adjust in product credentials; old results are not auto-deleted. Save needed files and explicitly select deletions.
- **Still suspended after restart:** unknown effects are intentionally retained. A maintainer verifies old actions stopped and checks external results before profile recovery.
- **Windows/Japan server:** cross-platform/Japan deployment is paused; preparation scripts do not establish acceptance.

## dev.2 usage changes

- Capture waits a bounded time for stable text/lazy loading; instability yields partial/missing items. After delivery, only that task's new capture pages are reclaimed. Existing pages, human-waiting pages, and failures awaiting verification remain. Default total tab budget is 8; resolve retained pages when full.
- Frequent-operation prompts trigger persistent cooldown for the same site/egress. New visits wait for trusted Retry-After; unknown recovery times require review/release in Diagnostics and site notes. Release does not rerun old tasks.
- Takeover tickets last at most 60 seconds and are single-use. Close/reopen after disconnect to obtain a new ticket.
- Maintainers configure sites/account checks for account-required browsers. Mismatch/unknown waits for a human; browser names are not account proof. Public pages do not require account verification by default.
- Deleted artifacts retain ID/deleted state in tasks. Already-downloaded bytes cannot be recalled. Unknown/mismatched file types download as generic binary.

Old dev.1 packages are archival. The dev.2 test round used independent new-package installation without promising historical migration. Current P4/freeze status is governed by acceptance and `releases/DELIVERY.json`.
