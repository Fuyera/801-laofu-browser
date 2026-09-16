# Confirmed defect remediation

[简体中文](ADVERSARIAL_FIXES.md) | **English**

Date: 2026-09-15. Per user confirmation, only the **confirmed portions of 28 category-A findings** in the [item review](ADVERSARIAL_REVIEW.en.md) were fixed. The 8 B, 2 C, and 3 D findings retain their verdicts without added features/contract changes. Original reports/review remain historical evidence.

Source: `592b5c97530c3c716909fb3cda66bf6f5dceece7` plus uncommitted changes. Immutable vendor; build-engine generates runtime. Verification used isolated environments, not upgrades of daily Chrome/Japan servers or final release freeze.

## Item-by-item treatment

|ID|Fix|Verification|
|---|---|---|
|AT-P1-01|Interrupted partially executed act becomes partial/unknown, quarantines controller, no replay|Real click then wait timeout, effect count 1; Worker/Broker regression|
|AT-P1-02|Long login wall waits for human; bounded loading wait; unready text not delivered|Real password-field wall; content appearing after 6 seconds|
|AT-P1-03|Continue scrolling based on actual loading; flag residual 1×1/2×2 images|Image 18,000 px down captured as 120 px original; remaining placeholder yields partial|
|AT-P2-01|Atomic cancellation flag/event/queued terminal state; legacy split records not dispatched|Transaction fault injection; queued/cancelRequested regression|
|AT-P2-02|Resume checks quarantine/connection; uncertain send suspends rather than false running|Broker quarantine/offline refusal, unchanged state|
|AT-P2-04|fetch.pages early exits include structured truncation/original length|Actual pagination maxBody=300 returns partial/truncated|
|AT-P2-05|CLI local upload becomes artifact input; key reuses preparation|Real CLI→HTTP upload twice, same command/file|
|AT-P2-06|Ordinary flows reject reload upfront; standalone maintenance remains|HTTP 400; defensive Worker rejection with not_started|
|AT-P2-07|ask resumption restores automatic control; cancellation stops continuation|Actual extension panel resume then successful click; no next step after cancel|
|AT-P2-08|Cooldown parses command URL and every flow step URL|Another same-egress profile's command/later step denied|
|AT-P2-10|Each embed records type/position/undownloaded state with text placeholder|Real video/audio/iframe fixture; media presence not forced to fail task|
|AT-P2-12|Choose srcset by resolution, preserving explicit original URLs|Large-first/small-last candidates with src present|
|AT-P2-14|Freeze metadata/DOM together, exact chunk lengths, publicly reproducible artifact hashes|Pre-freeze title/body change yields same revision but partial; reject short chunk; recompute HTML hash|
|AT-P2-15|Hidden staging; atomic reference validation/terminal publication|Second real capture upload fails without visible artifacts; commit rollback|
|AT-P2-16|Redacted URLs, controlled original-source metadata; journal strips binary and expires bodies|Synthetic path/query credentials redacted; no binary in journal; expiry retains dedupe tombstones|
|AT-P2-17|waiting_user includes AUTH_REQUIRED, mapped when failing|Actual long login wall; ordinary waiting not turned into failure|
|AT-P2-18|Inline small screenshots, large as artifacts; hard output cap|Actual small JPEG/full:true large PNG, bounded reply, readable file|
|AT-P2-19|Gateway listens only on private interface, no default-bridge proxy/relay|Real temporary Docker neighbors denied on two addresses × two ports; private worker egress succeeds|
|AT-P2-20|Reclaim failed jobs, terminal staged/old partial files; retain delivered files|Worker failure cleanup, 24-hour expiry, active/recent-file protection|
|AT-P3-01|Oversized JSON maps to LIMIT_EXCEEDED|Actual Fastify 413 injection|
|AT-P3-02|Wall-clock cancellation records cancel_requested|Persistent flag/event after expiration tick|
|AT-P3-06|Terminal state immediately closes takeover viewer|Silent viewer closes; map cleared|
|AT-P3-08|Flow ask respects cumulative humanWaitSeconds|Fails after 5-second budget; later click absent|
|AT-P3-09|Subresource/command rate limits persist cooldown and stop subsequent work|Real resource 429/Retry-After; command→persistent cooldown|
|AT-P3-10|Bounded task/artifact cursor pagination, console/MCP continuation|55 tasks, 20/page, continuation without duplicates|
|AT-P3-11|Long error summary explicitly truncated; full original retained|1,800→1,000-character summary, original text/length available|
|AT-P3-15|MCP connection errors retain correlation keys and query-first guidance|Actual handler injection after acceptance/response loss; definite 403 remains rejection|
|AT-P3-17|Escape GFM table-cell pipes|Conversion test; Chromium file:// offline images display|

## Verification and boundaries

The first 15 regression groups passed 0/15 on old implementation, then 15/15 after fixes. Additional boundaries brought final unit/interface coverage to **50/50**, isolated browser **19/19**, dual Docker **8/8**, real takeover **2/2**, and representative same-input upstream comparison **43/43**.

Initial full matrix: **22/24**. SDK/dual-isolation installs failed because PATH selected Python 3.9. SDK passed using existing Python 3.11.15. Dual isolation then found default DNS resolving example.com to reserved 198.18.1.151; rerunning with the project's existing public-DNS settings passed. Ultimately **all 24 matrix items have passing evidence**, without rewriting the original report as one 24/24 run.

Final tightening covered recovery-readiness gates, unique artifact references, and source-redaction markers. After rebuild, final 50 tests, 19 browser scenarios, takeover, and final-image dual isolation ran. The install group's candidate came from the first remediation checkpoint, not a frozen final release.

Archives/SHA-256: [index](evidence/adversarial-fixes/index.json); stages/final source hashes: [summary](evidence/adversarial-fixes/summary.json). Original matrix, failures, and rerun evidence remain separate.

Reproduce with project Node 22 and local browser/Docker permissions:

```sh
node --import tsx --test test/*.test.ts
node --import tsx scripts/adversarial-browser-regression.mjs
LAOFU_TEST_IMAGE=laofu-browser:adversarial-fixes-20260915 node scripts/adversarial-docker-regression.mjs
```

Browser scripts use temporary local services/fresh Chromium profiles with synthetic human resume/cancel triggers. Docker uses disposable networks/containers; public verification tests TCP CONNECT only. This does not simulate every real site/offline reader, 32 MiB screenshot memory exhaustion, remote bearer theft, or production deployment. New expiry cleanup affects controlled temporary/internal receipt data only; delivered artifacts still require explicit user deletion.
