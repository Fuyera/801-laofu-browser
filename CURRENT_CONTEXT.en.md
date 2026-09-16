# Current Context

[简体中文](CURRENT_CONTEXT.md) | **English**

Updated: 2026-09-16. **0.1.0-dev.3, macOS Apple Silicon developer preview.** A local browser assistant connecting AI assistants to the browser. All 19 project-owned Markdown documents now have Chinese/English editions with language switches and matching-language guide links. Feature introductions present tasks/management first, then 23 browser operations; attribution is at the README footer. The current-source console supports Chinese/English switching, remembered language, and localized dates/messages. The fixed dev.3 release predates this UI update. P5, cross-platform work, and Japan deployment remain paused; X list omissions are deferred.

## Delivery Status

The user explicitly authorized remaining delivery: merge main, synchronize GitHub, make the repository public, and publish the preview. Source was merged and synchronized; fixed build commit is `c1a12c9d06fd9ee08c4ce6d6dd8d0730dd3c4aeb`, with a clean build worktree. The installation package, SDKs, SHA256SUMS, DELIVERY.json, and redacted acceptance evidence were uploaded. The public preview Release was published at 2026-09-16 11:09 UTC. All nine asset sizes/SHA-256 hashes matched, and anonymous repository/Release access and SDK download passed. P4 delivery is closed for this round.

Project: https://github.com/Fuyera/801-laofu-browser

Preview: https://github.com/Fuyera/801-laofu-browser/releases/tag/v0.1.0-dev.3

Bundled documentation is the build-time snapshot. Later main commits add final acceptance, bilingual documentation, and the bilingual console without replacing the fixed release package. Old dev.1/dev.2 candidates remain local archives; fixed-version artifacts are not overwritten, and historical downgrade migration is not required. No Docker image distribution is provided in this release; isolation implementation/evidence remain in source. Future package generation includes the English root documents and the complete bilingual docs directory.

## Verification

- Latest UI increment: full build, frontend typecheck, real Chromium language/interaction acceptance, and all 7 article/console regression groups passed; see [scoped evidence](docs/evidence/ui-language.json). No new release package or daily-service upgrade was performed, and the complete delivery matrix was not rerun.

- Bilingual documentation: 19 pairs/38 files; 401 local links/anchors and 18 executable example pairs checked. Mac documentation copying preserved all 38 files byte-for-byte; Docker documentation input paths and script syntax passed. That earlier documentation round changed documentation and packaging document lists only; no full application/browser regression or fixed-release rebuild was performed.

- This release build and unit/API suite passed 50/50; 58 upstream files are unchanged and the 23-tool baseline matches.
- Extracted final archive: 19,818 files verified; isolated install/upgrade/rollback/fault recovery: 11/11.
- Final TypeScript/Python SDKs were independently installed and called the real browser; CLI/MCP queried the same task successfully.
- Everyday Chrome upgraded to dev.3: extension reload/read, worker stop preserving browser/pages, automatic reconnection, and original-page reading passed. Eighteen extension implementation files match the fixed package. Accounts and unrelated tabs were preserved; only acceptance tabs were closed.
- Previously confirmed 28 adversarial defects were fixed. Thirty-seven relevant source hashes still match, allowing reuse of browser 19/19, dual-identity Docker 8/8, and handoff 2/2 evidence. Historical first-pass 22/24 and reruns remain recorded; this release does not claim a fresh complete-matrix run.

Latest evidence: [release acceptance](docs/evidence/release-dev3/acceptance.json), [delivery manifest](docs/evidence/release-dev3/delivery.json).

## Public Scope and Boundaries

Original code is MIT, preserving upstream copyright/license. README ends with attribution, full source URL, and modification scope. Public documentation is redacted; credentials, cookies, profiles, databases, raw field logs, and account data are excluded. Targeted scans of current files/history found no keys/private server addresses. Historical reports contain local paths; original Git history remains, and this is not a complete security audit. The bilingual set covers project-owned Markdown; immutable upstream documentation, machine-readable contracts/evidence, and original legal license text retain their formats.

The everyday service uses controlled `workspace/p4/daily-chrome-state`, ports 17992/18992; it was stopped, backed up, and upgraded. Old `workspace/local-state` was not switched. Business consumers were not modified. The preview is unsigned/unnotarized and not in the Chrome Web Store; it is not cross-platform stable v1.0.
