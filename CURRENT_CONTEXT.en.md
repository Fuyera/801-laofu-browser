# Current Context

[简体中文](CURRENT_CONTEXT.md) | **English**

Updated: 2026-09-25. **0.1.0-dev.4, macOS Apple Silicon developer preview, published.** A local browser assistant connecting AI assistants to the browser. The fixed package includes bilingual documentation/console, Agent observations and outcome feedback, and macOS/Linux process identity checks. P5, cross-platform work and Japan deployment remain paused; X list omissions remain a known limitation.

## Delivery Status

As authorized, main and the release tag were pushed and the preview published. The clean fixed build is `1800ada796dd07ca4fa8a674aab2d3bc4dd56dc3`. Publication: 2026-09-26 02:58:11 UTC (September 25 locally). All nine asset sizes and SHA-256 hashes match GitHub asset digests; anonymous Release access and a TypeScript SDK download were verified. The installation package, both SDKs, SHA256SUMS, DELIVERY.json and ACCEPTANCE-dev4.json are uploaded.

Project: https://github.com/Fuyera/801-laofu-browser

Preview: https://github.com/Fuyera/801-laofu-browser/releases/tag/v0.1.0-dev.4

Bundled status documents are preparation-time snapshots. Final results are in the Release attachments and main's [acceptance](docs/evidence/release-dev4/acceptance.json), [delivery manifest](docs/evidence/release-dev4/delivery.json) and [publication receipt](docs/evidence/release-dev4/publication.json). Documentation follow-ups do not change the fixed package or tag. Original vendor and historical packages remain unchanged. No Docker image distribution is included.

## Daily Installation Audit

The daily installation remains dev.3; it was neither upgraded nor started. All 19,818 manifest entries match, with no missing or changed entries; ports 17992/18992 have no listeners. macOS tipsd reused a stale worker PID, causing the old manager to falsely report a running worker. dev.4 verifies process identity for status/start/stop/backup; real stale-PID, no-signal and restart regressions passed. The corrected read-only check reports both service and worker stopped. [Audit](docs/evidence/release-dev4/audit.json).

## Verification

- Full build and 53 unit/interface tests passed; 58 upstream files and the 23-tool baseline remain unchanged.
- Six real Chromium + MCP stdio cases and bilingual console verification passed. Snapshots expose loading, scrolling and truncation and identify named pointer images. MCP adds structured outcomes/recovery advice, conservative read-only hints and pre-dispatch validation; partial/unknown outcomes are not ordinary success.
- The final extracted archive passed all 19,853 manifest checks. An independent copy passed 11 installation/upgrade/rollback/recovery checks and post-test integrity verification. Version switching uses synthetic release identifiers, not an actual daily dev.3 upgrade.
- Both final SDKs passed independent installation and real capture/upload/download/query/cancel/resume, with CLI/MCP matching the same task.
- The 23 original-tool regressions reuse this round's run after feature changes and before version/PID-manager changes. This is not a claim that the entire delivery matrix was rerun. [Observation evidence](docs/evidence/browser-use-observation-20260925.json).
- Historical dev.3 daily Chrome stop/reconnect evidence is in [previous acceptance](docs/evidence/release-dev3/acceptance.json); it does not establish that today's daily service is running.

## Public Scope and Boundaries

Original code is MIT, preserving upstream copyright/license. README ends with attribution, full source URL, and modification scope. Public documentation is redacted; credentials, cookies, profiles, databases, raw field logs, and account data are excluded. Targeted scans of current files/history found no keys/private server addresses. Historical reports contain local paths; original Git history remains, and this is not a complete security audit. The bilingual set covers project-owned Markdown; immutable upstream documentation, machine-readable contracts/evidence, and original legal license text retain their formats.

The following is historical September 17 acceptance; current runtime status is the daily audit above. On September 17, the user requested replacing the source-checkout runtime with the fixed GitHub release. Programs now run from `~/.local/share/laofu-browser/releases/0.1.0-dev.3-macos-arm64`, with data in sibling `state` and ports 17992/18992. The old state path is a compatibility symlink; the 801 source remains. A full state/config backup is in sibling `backups/pre-release-install-20260917`. Download SHA-256 and installer file checks passed. The release extension was installed in Chrome; all 18 implementation files match. The real browser profile is ready and not quarantined. A fresh stdio MCP connection lists 28 tools and reads tabs. Unknown historical effects remain recorded and are not replayed. Project 101 now points to the release; after the user restarted Codex, the live MCP process was verified to run from the release directory, no old development MCP processes were found, and the current conversation successfully read tabs. Local evidence: `release-install-verification.json` in the installation prefix. The supplied WeChat URL produced Markdown, HTML and 7/7 images in about 22 seconds; status is partial because loading stability was not established. This is not proof of full-text completeness or M01 ingestion. Old `workspace/local-state` was not switched. The preview is unsigned/unnotarized and not in the Chrome Web Store; it is not cross-platform stable v1.0.
