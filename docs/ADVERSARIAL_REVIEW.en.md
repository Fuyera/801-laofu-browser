# Item-by-item adversarial report review and adjudication

[简体中文](ADVERSARIAL_REVIEW.md) | **English**

Date: 2026-09-15. Covers all **41 findings** in the [original report](ADVERSARIAL_TEST.en.md), preserved unchanged.

Review source: `fuyera/p4-macos`, HEAD `592b5c97530c3c716909fb3cda66bf6f5dceece7` plus current worktree. Current src/*.ts ran directly with generated runtime/engine. This round added diagnostics/review documents only: no business-code fixes, push, publication, or daily Chrome changes.

## Conclusions and counting

The previous round sampled findings and could not claim all were verified. This round checked all 41 with additional real-browser, Docker, HTTP, SQLite, and fault-injection evidence. **Reviewing every item does not mean every alleged consequence was reproduced end to end.**

|Primary verdict|Count|Meaning|
|---|---:|---|
|A: includes a real issue|28|At least one implementation defect or explicit contract gap is valid; mixed claims are qualified below|
|B: misunderstanding/agreed behavior|8|Observation may be true without establishing a defect|
|C: central report judgment incorrect|2|Existing contract overlooked or concurrency premise invalid for current architecture|
|D: needs evidence/contract definition|3|Mechanism/gap checked, but insufficient to establish alleged product failure|
|Total|41|Each ID counted once, not each subclaim|

28 does not mean 28 independent major defects or endorsement of every original severity. Several integrity findings overlap. Contract wording, codes, events, and capacity governance need different prioritization from content corruption.

## Evidence and scope

Generated `runtime/engine/` source references below are historical local build locations; run the source build to produce that directory. They are not files tracked on GitHub.

- **U, existing tests:** current `node --import tsx --test test/*.test.ts`, **30/30 passed**. First sandboxed run had one loopback-permission failure; authorized rerun passed all. Output retained locally, not published.
- **C, targeted execution:** 21 SQLite/Broker/Worker/Fastify/MCP handler probes plus one table-conversion probe, **22 groups**. Crash windows, disconnections, and browser receipts used explicit fault injection where stated, not actual process crashes/remote incidents. core-results.json/table-results.json retained locally.
- **B, real browser:** **19 valid targeted scenarios**, fresh independent Chromium, actual generated extension/MCP, local synthetic pages. Human Continue called the same continuation handler, not actual human VNC acceptance. browser-results.json and act follow-up retained locally.
- **D, real Docker:** one group, two fresh temporary containers matching deployer topology, current src mounted read-only. Test containers/networks removed afterward; docker-results.json retained locally.
- **S, source/contracts:** emission absence, missing pagination/retention, trusted actors, interface semantics. An unused function alone was not treated as a security defect.

These assertions verify current behavior, including successful reproduction of defects. **Passing diagnostic assertions do not mean the product is fixed.** No full 22-group delivery matrix, Japan VPS, real WeChat/daily-account, or other-OS rerun occurred.

### Counterevidence and correction of the first act probe

The first button changed a neighboring counter only. Step one returned EFFECT_UNKNOWN before reaching step-two wait, yielding partial+unknown+stopped:true. The failed assertion/journal were retained. Changing only the **fixture** so the button's own text visibly changed, then rerunning act, produced one actual local POST, step-two wait timeout, no third step, and partial+confirmed+completed:false+stopped:true. Product code was unchanged.

This proves an internally interrupted confirmed path, not that every interruption confirms, nor that in-flight write RPC loss caused a second external submission.

## All 41 verdicts

### Original P1 findings

|ID|Verdict|Verified result and qualifications|Evidence/source|
|---|---|---|---|
|AT-P1-01|**A, partly valid**|Real act wrote once with page evidence, then internal wait timed out as partial+confirmed, contrary to L06's interrupted-batch unknown requirement without checkpoints. Genuine unknown paths also return unknown; same keys do not replay. Induced duplicate submission and always-confirmed in-flight TIMEOUT were not proved. Pre-execution rejection must not automatically become unknown.|B/ /C; [worker.ts](../src/worker.ts#L605), [DESIGN L06](DESIGN.en.md#l06-recoverable-tasks-and-reliable-writes)|
|AT-P1-02|**A, valid**|An article containing password input/long English login text returned succeeded/accessible/complete_for_scope with no warnings. A fixture with content after 6 s delivered “Loading, please wait…” at about 1.4 s as success. Not all slow SPAs necessarily fail; network idle does not prove complete content. Report incorrectly includes main in hasArticle short circuit; describe checks #js_content,article, while main is only a text-root candidate.|B/ ; [article.ts](../src/article.ts#L35), [describe](../src/article.ts#L280), [loading](../src/article.ts#L359)|
|AT-P1-03|**A, valid**|Real IntersectionObserver image beyond four screens was never requested after four scrolls; valid 1×1 transparent PNG counted as success. Conditional lazy-loading defect, not proof all small images are wrong or earlier valid-image samples invalid.|B/ ; [article.ts](../src/article.ts#L90), [Image validation](../src/article.ts#L472)|

### Original P2 findings

|ID|Verdict|Verified result and qualifications|Evidence/source|
|---|---|---|---|
|AT-P2-01|**A, partly valid**|Injected interruption after persistent cancelRequested but before transition let tick dispatch queued work. Non-atomic cancellation/missing dispatch check are real. HTTP cancellation had not yet succeeded, and completion was cancelled+confirmed, not necessarily unknown. No process kill precisely hit this window.|C/ ; [broker.ts](../src/broker.ts#L248), [cancel](../src/broker.ts#L320)|
|AT-P2-02|**A, valid**|Quarantined waiting_user could resume; simulated closed socket threw WORKER_OFFLINE after state became running. Gate/state mismatch with resumeAllowed, not proof of double execution.|C/ ; [broker.ts](../src/broker.ts#L342), [viewJob](../src/server.ts#L188)|
|AT-P2-03|**C, existing contract overlooked**|Same product/key with different kind creates two records as observed, but API.md already specifies same identity/type/key/request. DESIGN overview should clarify namespace; changing uniqueness would break existing contracts.|C/ /S; [API.md](API.en.md#L39), [store.ts](../src/store.ts#L223)|
|AT-P2-04|**A, valid**|Real paginated fetch text reported maxBody overflow without structured metadata; Worker returned succeeded/truncated=false. Early-return omission.|B/ ; `../runtime/engine/src/mcp-server.js#L570`, [worker.ts](../src/worker.ts#L584)|
|AT-P2-05|**A, valid**|Real HTTP route rejected actual CLI payload shape with INVALID_ARGUMENT; CLI lacks inputArtifacts. Source plus HTTP establishes broken entrypoint, but no CLI subprocess end-to-end upload was run in this review.|C/ /S; [cli.ts](../src/cli.ts#L348), [server.ts](../src/server.ts#L589)|
|AT-P2-06|**A, valid; state wording wrong**|Reload succeeded, next status returned CONTROL_REVOKED, and actual flow was **partial**, not necessarily failed/unknown. Upstream reload is disruptive maintenance; reject ordinary-flow combinations or define upgrade continuation rather than treat it as page reload.|B/ ; [browser.ts](../src/browser.ts#L304), [worker.ts](../src/worker.ts#L518)|
|AT-P2-07|**A, valid**|Actual extension ask entered waiting_user; continuation through Worker handler ended ask, but next click returned CONTROL_REVOKED/flow partial. Missing control restoration reproduced beyond mocks.|B/ /C; [worker.ts](../src/worker.ts#L297)|
|AT-P2-08|**A, valid**|Another same-egress profile's input.url was blocked, but args.url and steps[].args.url were not. Command/flow site parsing needs coverage.|C/ ; [store.ts](../src/store.ts#L184)|
|AT-P2-09|**D, mechanism true; human race unproved**|Delayed JS continued after browser.control(cancelled=true), proving the receipt is not generic JS-stop proof. Probe concurrently called the low-level adapter, not production Worker's serial task path. Actual takeover with an old in-flight write remains unproven; needs reachable cancel/unknown/handoff scenario.|B/ /S; [worker.ts](../src/worker.ts#L297), [browser.ts](../src/browser.ts#L264)|
|AT-P2-10|**A, partly valid**|Video/audio/iframe fixture supplied only total 3, lacking per-item type/position/state required by L01. Manifest **already warned about undownloaded media**; success did not claim all media downloaded. Do not fail every video-containing task.|B/ ; [article.ts](../src/article.ts#L547), [warnings](../src/article.ts#L565)|
|AT-P2-11|**B, denominator misunderstood**|With JavaScript enabled, noscript img is fallback text, not visible image DOM; fixture fallback element did not exist. Removal alone proves no omission and counting it may duplicate images. A site using it as real lazy data needs its own transformation/omission fixture.|B/ /C; [article.ts](../src/article.ts#L85)|
|AT-P2-12|**A, valid**|large 1600w, small 400w selected small. Last does not mean largest; existing src could prevent parsing srcset entirely. Use explicit original/display-image policy, not source order as size evidence.|C/ ; [article.ts](../src/article.ts#L95)|
|AT-P2-13|**B, unused enum does not prove defect**|Real next-page task returned partial with textCoverage=complete_for_scope, explicit uncaptured pagination, missingFragments=null. Current-document completeness can coexist with task partial; null does not pretend zero missing content. current_DOM_only/unexpanded scope is disclosed. Broader capture scope must be defined before demanding all hidden fragments.|B/ /S; [article.ts](../src/article.ts#L511)|
|AT-P2-14|**A, partly valid**|Actual describe/freeze race delivered old title/new body with versionConsistent=true. Injected short chunks passed without length validation, but natural network truncation was not reproduced. Equal contentHash/documentRevision and non-composable block hashes are not inherently wrong. Missing verifiable revision binding/source snapshot and metadata race are the real gaps.|B/ ; [article.ts](../src/article.ts#L363), [freeze](../src/article.ts#L385), [manifest](../src/article.ts#L526)|
|AT-P2-15|**A, partly valid**|Failing second upload after real capture left failed task's article.md listed/downloadable with 200 and no manifest. Package-reference/publication atomicity is missing. The individual file was fully verified, not corrupt/half-written; task did not falsely succeed.|B/ ; [worker.ts](../src/worker.ts#L503), [server.ts](../src/server.ts#L153)|
|AT-P2-16|**A, mixed claims**|Original task URL unavailable is refuted: terminal input.url remains. Failed image URLs may exist in step journal parameters/raw results, but structured restricted expiring retry metadata is absent. Path/unmatched-query credentials were unredacted; full binary base64 persisted without TTL. Original retention, credential isolation, and consumer redaction are separate concerns.|C/ ; [store.ts](../src/store.ts#L267), [util.ts](../src/util.ts#L66), [worker.ts](../src/worker.ts#L256)|
|AT-P2-17|**A, contract gap**|AUTH_REQUIRED has a table definition but no emitter; login uses waiting_user reason/other codes. Missing mapping is confirmed, not total login failure. Define normal-wait/failure-code mapping rather than mechanically fail waiting_user.|S/ ; [contracts.ts](../src/contracts.ts#L280), [article.ts](../src/article.ts#L304)|
|AT-P2-18|**A, conditional output-management gap**|Ordinary screenshot returned inline base64 length 39,520/artifacts=0. Upstream image compatibility is legitimate; large-output application limits/artifact conversion are missing before transport cap. No 32 MiB screenshot/OOM experiment or ordinary-screenshot failure claim.|B/ /S; `../runtime/engine/src/mcp-server.js#L646`, [worker.ts](../src/worker.ts#L556)|
|AT-P2-19|**A, anonymous proxy exposure tested**|Default-bridge neighbor without credentials got CONNECT 200 to 1.1.1.1:443 on 18880; private/control destinations still 403. Valid 18881 relay route reached deliberately absent core and returned 502: relay lacks local authentication, **not proof of core-auth bypass**. Shared L2 is not proof of bearer capture; no interception test.|D/ ; [isolated.mjs](../deploy/isolated.mjs#L138), [network.ts](../src/network.ts#L62), [relay.ts](../src/relay.ts#L74)|
|AT-P2-20|**A, valid**|Worker failure left jobs directory; no expiry cleanup for failed dirs/startup partials found. Charging retained partials to quota is correct security accounting; missing reclamation is the issue. No prolonged disk-fill test established exhaustion.|C/ /U/S; [worker.ts](../src/worker.ts#L675), [artifacts.ts](../src/artifacts.ts#L30)|

### Original P3 findings

|ID|Verdict|Verified result and qualifications|Evidence/source|
|---|---|---|---|
|AT-P3-01|**A, valid**|Actual >2 MiB JSON returned 413 but error.code=INTERNAL, inconsistent classification/client handling.|C/ ; [server.ts](../src/server.ts#L83)|
|AT-P3-02|**A, valid**|Wall expiry set cancelRequested/sent cancellation but omitted cancel_requested event. Event visibility gap, not absent cancellation.|C/ ; [broker.ts](../src/broker.ts#L234)|
|AT-P3-03|**B, agreed security behavior**|Deleted GET returned 403, shared with nonexistent/other-owner resources to prevent enumeration. Task view exposes deleted. No contract requires 410; preferred status codes are not defects.|C/ /U; [artifacts.ts](../src/artifacts.ts#L187), [DESIGN.md](DESIGN.en.md#L240)|
|AT-P3-04|**D, capability-state contract needed**|tools.status is static, but permission-filtered profiles expose ready/quarantined/workerId. Restricted callers do see readiness. Fine-grained tool/environment support mapping needs definition; no proof the constant falsely advertises unavailable tools.|C/ /S; [server.ts](../src/server.ts#L240)|
|AT-P3-05|**B, hypothetical logging risk**|Authorized JSON ticket delivery is normal; no-store, short TTL, single use, no server body logging exist. Possible proxy/client logging is not proven credential leakage. Deployment TLS/log protection remains necessary, but response-body presence is not itself a vulnerability.|C/ /U; [server.ts](../src/server.ts#L979)|
|AT-P3-06|**A, valid with limited impact**|Terminal result did not immediately clear viewers/map/socket. Worker display already closed; next input triggers server-state closure, while silent connections may remain until timeout. Not continued terminal-state input.|C/ /S; [broker.ts](../src/broker.ts#L157), [server.ts](../src/server.ts#L1051)|
|AT-P3-07|**B, explicit until is authorized continuation**|Real ask automatically completed on caller-supplied selectorExists without a human click. Upstream schema/API explicitly allow confirmation OR original ask condition. Flow restoration is separately P2-07.|B/ /S; [API.md](API.en.md#L45)|
|AT-P3-08|**A, mixed claims**|Valid humanWaitSeconds=5 flow ask still succeeded after about 6.7 s, proving budget omission. Offline claim is wrong: socket close suspends waiting_user and tick skips suspended. Retaining resident quota for unknown work is conservative recovery, not something to auto-clear.|B/ /C; [worker.ts](../src/worker.ts#L297), [broker.ts](../src/broker.ts#L62)|
|AT-P3-09|**A, valid**|Real subresource fetch got 429 without rateLimit capture; injected command RATE_LIMITED result created no cooldown. Insufficient coverage outside navigation/article capture.|B/ /C; [browser.ts](../src/browser.ts#L159), [broker.ts](../src/broker.ts#L158)|
|AT-P3-10|**A, capacity-management gap**|Tasks/includeCommands/artifacts return all items without pagination/output bound. Small fixtures work; no measured OOM/timeout claim.|C/ /S; [server.ts](../src/server.ts#L712), [artifacts list](../src/server.ts#L789)|
|AT-P3-11|**A, partly valid; loss overstated**|1,800-character error summary silently cut to 1,000, but full original content remains in result, not irrecoverably lost. Detection first reads data.truncated; regex is fallback, not sole source. Pagination early exit is P2-04.|C/ /S; [worker.ts](../src/worker.ts#L599)|
|AT-P3-12|**B, trusted-actor boundary**|Environment comes from trusted Worker; attestation is owner-only with bootId checks, and restricted attest actually returned 403. Ordinary self-registration cannot forge proof. No hardware remote-attestation promise; compromised owner/worker needs a different threat model.|C/ /S; [server.ts](../src/server.ts#L374)|
|AT-P3-13|**B, unused method is not failed control**|holds unused is true, but acquire/fence/engine guard enforce control. Old-generation/cancel/unknown-write tests exist. Dead-code cleanup is possible; unnecessary per-action remote checks are not justified by this observation.|S/ /U; [store.ts](../src/store.ts#L372), [broker.ts](../src/broker.ts#L288)|
|AT-P3-14|**C, wrong concurrency premise**|recordCooldown is synchronous SQLite without await; process lock owns the service directory. Supported single-process execution lacks the alleged concurrent-insert window. Shorter Retry-After did not replace longer until; second lock was denied. Add transactions/CAS if multi-service shared DB is supported later.|C/ /S; [store.ts](../src/store.ts#L130), [cli.ts](../src/cli.ts#L115)|
|AT-P3-15|**A, valid**|Actual MCP handler injection after acceptance/lost response returned only INTERNAL, no commandId/stable correlation/query-first guidance. laofu_jobs exists but receipt did not direct callers there. Handler fault injection, not actual MCP pipe severing.|C/ ; [mcp.ts](../src/mcp.ts#L145), [DESIGN.md](DESIGN.en.md#L238)|
|AT-P3-16|**B, disclosed caller responsibility**|capture without --key indeed makes new tasks; API already requires explicit stored keys for dedupe. Capture is not external publication. Recovery UX can improve; not same-key failure/server replay.|S/ /U; [cli.ts](../src/cli.ts#L314), [API.md](API.en.md#L39)|
|AT-P3-17|**A, specific supplemental defect**|Chromium file:// displayed bundled PNG under CSP; ordinary #/- and code blocks were preserved. Raw table-cell text with a pipe produced unescaped Markdown, shifting columns: a real conversion defect. Original report only lacked coverage; not all listed cases failed, nor does Chromium prove all readers.|B/ /C; [article.ts](../src/article.ts#L119), [Source](https://github.github.com/gfm/#tables-extension-)|
|AT-P3-18|**D, required-item contract needed**|downloadImages defines image requirements; author/publication time/embeds lack equally explicit success requirements. Real media/no-author fixture succeeded with warning. Define which missing fields require partial; do not assume authorless pages fail. Separate from P2-10 per-media reporting.|B/ /S; [article.ts](../src/article.ts#L597), [DESIGN.md](DESIGN.en.md#L109)|

## Overall statements the original report must correct

1. **Existing tests cover only primary paths is false.** Tests/scripts kill the service after external effects, cancel act midway, disconnect bridge after effects, revoke identities, interrupt/overrun uploads, and prevent old-command replay. 30/30 does not erase new findings, but new findings do not erase existing fault coverage.
2. **Static audit cannot prove no unauthorized paths, full coverage, or core adversarial robustness.** Say none found in inspected code, not global security proof. Six similar opinions are not runtime evidence; six independently reviewable reports were not attached.
3. **Separate observations, risk reasoning, reproduction, and severity.** Despite its static-audit disclaimer, the report repeatedly states definite failures/inevitable consequences. Runtime tests validate useful findings while refuting several premises/causal chains.
4. **Protocol confirmation is not final business success.** confirmed does not promise third-party settlement, and a fresh key is not automatic server replay. Fix interrupted-batch/control contracts without endless quarantine or labeling every pre-execution refusal an unknown write.

## Recommended order and outstanding evidence

Prioritize actual output/executable-flow defects: error/loading-page capture, placeholders, same-revision metadata, fetch pagination truncation, ask/reload flows, command-channel cooldowns, CLI upload. Include table pipes in semantic-content tests. Add cancellation atomicity/resume gates to fault regressions. Clarify act batch/step confirmation semantics while preserving no replay.

Fix Docker anonymous proxy exposure before restricted access. Add failed-directory/artifact/journal retention/capacity policy before long-running operation. Events, codes, pagination, and large screenshots are explicit protocol/operations improvements, not uniformly major security incidents.

Still unresolved: P2-09 reachable production-state-chain race between takeover/old writes; P3-04 tool-state vs profile-readiness/environment contract; P3-18 capture-required fields. Even confirmed items do not prove actual duplicate external writes after in-flight RPC loss, prolonged disk exhaustion, huge-screenshot memory pressure, or bearer theft.

## Reproduction entrypoints

Run from repository root with project Node 22. Diagnostics operate only their own isolated state; browser/Docker scripts require local process/network permissions.

```sh
.runtime/node-v22.23.2-darwin-arm64/bin/node --import tsx workspace/adversarial-review/verify-core.mjs
.runtime/node-v22.23.2-darwin-arm64/bin/node --import tsx workspace/adversarial-review/verify-browser.mjs
CHECK_FILTER=AT-P1-01 .runtime/node-v22.23.2-darwin-arm64/bin/node --import tsx workspace/adversarial-review/verify-browser.mjs
.runtime/node-v22.23.2-darwin-arm64/bin/node --import tsx workspace/adversarial-review/verify-table.mjs
.runtime/node-v22.23.2-darwin-arm64/bin/node workspace/adversarial-review/verify-docker.mjs
```

Scripts, machine-readable observations, and version-hash index remain in workspace/adversarial-review, local only and excluded from packages. If publishing review conclusions later, selectively archive matching evidence too.
