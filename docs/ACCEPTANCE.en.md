# laofu-browser Mac P4 acceptance

[简体中文](ACCEPTANCE.md) | **English**

## dev.3 release acceptance (2026-09-16)

The Mac Apple Silicon preview scope is complete: clean source `c1a12c9`, 50/50 unit/interface tests, final-package verification of 19,818 files, installation/recovery 11/11, two independently installed SDKs, and latest daily Chrome stop/reconnect/original-page preservation all passed. [Acceptance](evidence/release-dev3/acceptance.json) and [delivery manifest](evidence/release-dev3/delivery.json) fix versions/hashes. Current P4 scope is complete; X list omission remains a known limitation; P5/cross-platform remains paused. The dev.2 historical snapshot below contains pending items superseded by these results.

## dev.2 historical acceptance

> The 28 confirmed adversarial findings were fixed and accepted on 2026-09-15; scope and staged evidence are in [ADVERSARIAL_FIXES.md](ADVERSARIAL_FIXES.en.md). Final unit/interface 50/50, browser 19/19, dual isolation 8/8, and takeover 2/2 passed. All 24 matrix items have passing evidence after retaining environment failures and reruns. The following pre-fix P4 history does not establish daily-environment upgrade or final package freeze.

Updated 2026-09-14 local time, version `0.1.0-dev.2`, branch `fuyera/p4-macos`. **Full matrix 22/22 passed; daily Chrome's manual entrypoint remained, while clean-source candidate artifacts passed reverification.** P5, cross-platform, Japan deployment, and automatic cross-endpoint selection were paused. Old dev.1 was archival; historical-package migration was removed from this round's gate.

## Implemented scope and evidence

|Scope|Evidence at that time|Boundary|
|---|---|---|
|Engineering/contracts|58 unchanged vendor files; 23 tools/107 parameters; 30 unit/HTTP checks; matrix 22/22|[Full report](evidence/p4/full.json), including performance-service lifecycle steps|
|Capacity/accounts|Product disk/queue/resident limits; exact sites/account fingerprints; mismatch waiting and cancellation on policy change|anonymous means no account check, not no cookies; no cross-device matching|
|Sustained operation|[7 groups](evidence/p4/runtime.json): 30 captures/reclamation, original-tab preservation, tab budget, doctor, SSE resume/revocation|Real browser and self-hosted fixtures|
|Rate limits/artifacts|Real 429/Retry-After survives restart; MIME detection, upload reauthorization, deletion aborts downloads, deleted state retained|Release does not replay; downloaded bytes cannot be recalled|
|Isolation/two identities|[8 groups](evidence/p4/isolated.json): eight isolation checks per container, same-volume restart, public capture through installed TS/Python SDKs|Mac Docker Desktop/Linux arm64; synthetic account pages|
|Human takeover|Real noVNC input for two identities, single-use ticket replay rejection, fresh-ticket reconnect, same-task resume, cross-identity denial|No automatic real CAPTCHA/third-party account operation; not business-consumer integration|
|Upstream compatibility|[43 comparisons](evidence/p4/parity.json); [6 boundary groups](evidence/p4/compatibility-edge.json)|CSP, concurrent debugger, session/screenshot isolation, unavailable L2; not every browser/version/argument combination|
|Articles/faults/SDKs|7 article/console groups, 4 fault groups, 2 downloads, 2 takeover groups; actual TS/Python installs|Root WeChat evidence is one historical article, not a new capture|
|New-package install|[11 checks](evidence/p4/install.json): capture, integrity, same-ID conflicts, restart retention, recovery/idempotency|dev.2 candidate; synthetic version changes, no dev.1 downgrade promise|
|Actual host|[3 Codex checks](evidence/p4/codex-host.json): config recognition, real browser call, uninstall|Installed app-server, temporary protocol context, no model turn; other 19 hosts not launched individually|

Environment: macOS arm64, Node 22.23.2, Playwright 1.63.0. Matrix candidate image `sha256:2f2ae06755667edf59d8d6ee0107b6b8c8b9d25f5d0c8cd40989d8d9e2d0c3ef`, from `2b2fdad` plus uncommitted changes. Containers were non-root with real Chromium sandbox and separate volumes/networks/displays. Public proxy explicitly used existing host DNS `8.8.8.8/8.8.4.4`; internal DNS and private/reserved-address checks remained effective.

## Remaining P4 exit criteria

1. Daily Chrome installation, branding, connection, and basic X reads passed, but that environment lacked latest fixes. Latest-candidate stop/reconnect/browser preservation remained pending. The user accepted X list omission as a deferred preview limitation; see [X acceptance](X_READ_ACCEPTANCE.en.md).
2. After the manual entrypoint passed, freeze dev.2 and update `releases/DELIVERY.json`. Clean source `580a6cf` passed install 11/11, dual identity 8/8, 19,789 Mac extracted-file checks, and 42 Docker blob hashes. See [committed-source reverification](TEST_REPORT.en.md#delivery-reverification-from-committed-source). Old archives remain intact.

Historical lid-close interruption was recovered. The subsequent SDK GET disconnection defect was fixed and verified by the complete matrix. Details: [TEST_REPORT](TEST_REPORT.en.md).

|Phase|Assessment|
|---|---|
|P0|Two local containers passed eight isolation checks; each restart needs fresh proof|
|P1–P3|Mac-scoped features/contracts/fault/security regressions passed|
|P4|Automated regression, actual Codex host, and clean-source artifacts passed; manual browser entrypoint/final freeze pending|
|P5|User-paused; no cross-platform v1.0 claim or automatic resumption|

The [P4 index](evidence/p4/index.json) records provenance/scope/hashes; [traceability](traceability.json) preserves requirement mappings. Root `docs/evidence/` is dev.1 history. Cookies, credentials, databases, and profiles stay controlled. At this historical checkpoint no push, public publication, or business-consumer change occurred.
