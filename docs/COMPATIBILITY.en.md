# Compatibility differences from huashu-chrome 1.2.0

[简体中文](COMPATIBILITY.md) | **English**

Original MIT attribution/source snapshot remain. Public parameters of the 23 tools keep their definitions; HTTP profile, requestId, idempotency key, and input artifacts stay outside original args. Equal tool/parameter counts do not prove semantic parity. The recorded representative same-input comparison passed 43 checks, plus 6 real compatibility-boundary groups; see ACCEPTANCE for scope.

|Difference|Category|Behavior and rationale|
|---|---|---|
|Owner vs restricted products|accepted_difference|Owners retain 23 tools; restricted products get declared read-only tools/high-level capture, not eval/fetch/act arbitrary code/writes or daily Chrome privileges|
|Separate paths/instance pairing|accepted_difference|Each profile has bridge port, pairing, journal, downloads/browser directories; no scanning/auto-selecting other instances|
|Persistent commands|accepted_difference|Record actions before dispatch; long HTTP commands return queryable IDs; MCP wraps synchronous originals and returns persistent handles after 30 seconds|
|No automatic L2 retry for unknown actions|accepted_difference|Explicit real:true/full L2 remain; dispatched actions without effect evidence return EFFECT_UNKNOWN for verification, avoiding duplicate clicks/submissions|
|Equal-length target text changes|upstream_defect|Original length-only check missed 1→2; compare briefly stable text on the same target. Evidence of page change, not final third-party business success|
|wait timeout vs disconnection|accepted_difference|Keep TIMEOUT/isError with explicit browser-receipt marker; finished wait does not quarantine profile, communication loss remains unknown|
|Batches/truncation|accepted_difference|completed=false, doneCount, truncation, and unknown effects propagate to task state, not false success|
|Interrupted partially executed act|accepted_difference|Mark unknown/quarantine and retain step receipts; explicit pre-admission rejection is not automatically unknown|
|Extension reload in flow|accepted_difference|Reject ordinary-flow reload upfront; standalone maintenance command retains capability|
|Large screenshots|accepted_difference|Keep image content ≤256 KiB base64, larger as artifacts; 16 MiB encoded receipt cap rejects oversized output|
|Paginated fetch/ask budgets|accepted_difference|Early pagination returns structured truncation; flow human budget caps ask; resume explicitly restores automation|
|File paths|accepted_difference|HTTP accepts controlled artifactId/bare filenames; MCP handles paths on trusted caller host. No arbitrary host paths accepted/returned|
|Large-image channel|accepted_difference|Retain 12 MiB extension binary channel; explicitly oversized image GET may use controlled native download with original bytes/hashes. Defaults: files 512 MiB, article 50 MiB, drag/drop 48 MiB|
|Download timeout|upstream_defect|Request cancellation and verify stop; without proof remain unknown, not falsely stopped|
|ask|accepted_difference|Keep prompt/targets/until/focus; add persistent waiting_user, console/independent-display takeover, resume/cancel after automatic control revoked|
|Site notes|accepted_difference|Keep domain/save; add product permissions, versions, CAS/history restore; notes are not instructions/authorization|
|Promise eval|upstream_defect|Explicitly await MAIN-world expression promises, not unfinished empty objects|
|Host installation|accepted_difference|Keep 20 host configs; preview by default, --apply writes/backups, uninstall removes only this product; extension still needs browser loading|
|Bridge lifecycle|accepted_difference|Direct bridge command directs users to worker; paired command-aware worker manages bridge, preventing bypass|
|Login state/environment|accepted_difference|Cookies/passwords remain at execution endpoint, not copied to server. Verification/rate limits stop work without IP/profile evasion|
|Mac/other systems|blocker|Only Mac arm64 and Linux arm64 in Mac containers tested; same Mac binary cannot establish Ubuntu/Windows support|

P4 comparisons include abnormal pagination, Shadow DOM, rich text, canvas drag, dialogs, stale refs, and CSP. Two sessions sharing a connection kept default tabs/background screenshots separate. Chromium 153 allowed another concurrent extension debugger; click occurred once and the other connection stayed usable. With L2 explicitly disabled, real click/CSP returned NEEDS_L2 without effect/fallback replay. After restoration use a new request; old keys return original failure. These results do not cover every Chrome version/DevTools state/parameter combination. Recorded full matrix was 22/22; daily Chrome/fixed delivery status is in the [test report](TEST_REPORT.en.md).
