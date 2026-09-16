# laofu-browser adversarial audit record and conclusions

[简体中文](ADVERSARIAL_TEST.md) | **English**

- Date: 2026-09-15.
- Target: branch `fuyera/p4-macos`, commit `592b5c9` plus then-uncommitted changes (extension icon, residential-egress proposal, etc.), version 0.1.0-dev.2. runtime/engine was generated at 2026-09-15T08:48Z by current scripts/build-engine.mjs.
- Criteria: [DESIGN.md](DESIGN.en.md) B01–B23 tools, L01–L07 distinctive capabilities, section 4 runtime, section 7 interfaces/states, section 8 security, R01–R08 review; [LAOFU_BROWSER_BASELINE.json](LAOFU_BROWSER_BASELINE.json) frozen schemas (23 tools / 107 top-level parameters / 58 files).
- Method: 6 parallel adversarial audit agents, divided into reliable writes/control, parameter coverage, takeover/rate limits, capture integrity, API contracts, and security, constructing scenarios along code paths.

**This is a read-only static code audit, not runtime regression.** No test suite, service, or browser ran during the audit. Findings are code-level conclusions with trigger conditions; **each must be reproduced at runtime before fixing**, not directly counted as an acceptance pass/failure. Code existence does not prove field success; a code suspicion does not prove field failure. The subsequent [item review](ADVERSARIAL_REVIEW.en.md) adjudicates these historical claims.

## Overall conclusions

1. **The core reliability structure withstands adversarial scrutiny.** The audit found no unauthorized-access path, server-initiated duplicate execution of the same command, or primary error-swallowing path returning 200 success. It located admission-before-dispatch persistence, same-key digest conflicts, two-level worker journals, never-resubmit suspended work, no reassignment before confirmed stop, control fencing, ownership checks, pinned-IP proxy plus container isolation, read-only allowlists, HTML/SVG preview isolation, log redaction, and transactional SSE/state. See the defenses list.
2. **3 P1, 20 P2, and approximately 18 P3 findings.** The reported common pattern was tests covering primary paths while defects cluster in edges: non-WeChat sites, slow SPAs, CLI, flow ask/reload, crash windows, cancellation/concurrency windows.
3. The P1 theme is **reporting uncertainty/incompleteness as confirmed/complete**: interrupted act confirmed, error/skeleton pages as successful articles, placeholders as downloaded images, threatening trust in acceptance.

## Finding counts

|Level|Definition from DESIGN §13|Count|
|---|---|---|
|P1|Possible duplicate external submission or major result distortion|3|
|P2|Compatibility/acceptance omission or defensive gap requiring treatment before full release|20|
|P3|Minor inconsistency/operations debt for later repair|Approximately 18|

---

## P1 details

### AT-P1-01 interrupted act falsely reports effectState=confirmed and may encourage batch replay

- **Contract:** L06 requires interrupted batches unknown/no replay; section 7 effectState semantics.
- **Locations:** runtime/engine/extension/background.js:1921 sets effectUnknown only for EFFECT_UNKNOWN; :1831–1838 no code on unmet expectation/no attributable change; :1853 exceptions only record stopped. src/worker.ts:605–607 maps completed=false to partial; :656–667 otherwise confirms unless failed/effectUnknown; :258–268 uncertainty sees outer isError/TIMEOUT/INTERNAL/NO_EXTENSION, not internal act stops. src/broker.ts:204 stopped=true avoids quarantine.
- **Mechanism:** internal timeout/disconnection/no-evidence stop yields completed:false without effectUnknown, causing partial/confirmed, normal lease release, no quarantine.
- **Trigger:** engine TIMEOUT at step 5/10 after action dispatch with unknowable outcome.
- **Risk chain:** partial+confirmed → caller treats prior steps as safe → replays batch → second external submission. Server does not itself replay; the report argues the response encourages downstream replay and skips unknown-result checks/quarantine.
- **Suggested fix:** mark incomplete write-command results unknown/uncertain, or consistently emit effectUnknown for coded non-read-only engine stops.
- **Suggested regression:** inject engine TIMEOUT mid-act; assert unknown, quarantine, rejected replay.

### AT-P1-02 accessible fallback and weak complete_for_scope criteria can produce successful error/skeleton articles

- **Contract:** L01 excludes empty/verification pages from successful articles; R07; section 8 integrity.
- **Locations:** src/article.ts:54–59 short-circuits accessible for article/main, >100 characters, and no blacklisted Chinese title keywords; :80 defaults accessible; :61–79 limited Chinese/fixed-English keywords; :380 accepts nonzero meta.length. :360–362 treats ≥750 ms static skeleton after readyState=complete as stable; :511–512 derives complete_for_scope solely from version consistency/stability; :560–568.
- **Triggers:** HTTP 200 non-WeChat login/error wall with >100 unrecognized characters; slow SPA content arriving after the 3-second stability window, unrelated to 4-screen/12000-px scroll probing.
- **Risk chain:** passes EMPTY_ARTICLE, freezes/renders/uploads, succeeds with complete_for_scope and no warnings. Together with P1-03, skeleton plus placeholders can appear complete. Tests covered enumerated keywords (test/article.test.ts:39–46) and continuously changing transfer fixture, not late content/unknown wording.
- **Suggested fix:** require text AND no wall features, use unknown instead of accessible fallback, and add loading-completion evidence such as network idle plus repeated height stability.
- **Suggested regression:** long English error article must not succeed; SPA injecting text at 3–6 seconds must not prematurely claim completeness.

### AT-P1-03 lazy-loading placeholders count as successful images under specific conditions

- **Contract:** L01 placeholder recognition; truthful mediaCoverage denominator.
- **Locations:** src/article.ts:90–96 chooses placeholder src without conventional data-*; :361 scrolls only 4 screens/12000 px; :472–483 sharp merely verifies valid image encoding.
- **Trigger:** long page, no data-src convention, IntersectionObserver, valid raster placeholder (1×1 GIF/transparent PNG; SVG is blocked by format allowlist).
- **Risk chain:** placeholder decodes, receives hash/dimensions, increments downloadedImages, and produces succeeded/complete_for_scope without fetching the real image. WeChat data-src and the historical valid 11-image sample are unaffected, but L01 targets arbitrary URLs.
- **Suggested fix:** mark tiny/repeated-hash/data-src-conflicting images suspected_placeholder and partial; scroll adaptively by page height.
- **Suggested regression:** first four screens contain 1×1 placeholders, real image loads farther down; placeholders must not count as successful originals.

---

## P2 records by domain

### Domain A: reliable writes and control (L06 / 4.2 / section 7)

**AT-P2-01 Non-atomic cancellation flag/terminal transition; dispatch ignores cancelRequested.** src/broker.ts:322–325 uses separate updateJob/transition commits; :248–303 does not check the flag before dispatch. A crash-window cancelled task can execute and report cancelled+unknown afterward (:194–195). Suggested fix: one transaction plus dispatch check.

**AT-P2-02 Resume gate is weaker than advertised and transitions before send.** src/server.ts:191 includes !profile.quarantined in resumeAllowed, but src/broker.ts:342–358 checks neither quarantine nor worker online and transitions running before send. Half-open connections can cause false running until wall timeout. Not double execution, but inconsistent API semantics. Two agents independently reported it.

**AT-P2-03 Idempotency has two namespaces by kind.** src/store.ts:38 UNIQUE(kind,product_id,idem), :228–231 permits same product/key for task and command. The report reads DESIGN §7 as requiring conflicting requests under one key to conflict without a kind distinction. Suggested fix: one product namespace or explicit API documentation.

### Domain B: tool coverage/adaptation (B01–B23 / R04)

**AT-P2-04 Paginated fetch loses inline truncation metadata.** runtime/engine/src/mcp-server.js:570–572 early-returns pages without binary and `_meta.laofu.output`. Beyond maxBody (default 200000), :740 only writes a text warning with omitted-page count. Worker :584,605–607 reports truncated:false/succeeded. Section 7 requires structured truncation, original length, or continuation. General path :667 has regex compensation; savePath returns artifactId, so only inline early return is affected.

**AT-P2-05 upload is unreachable through CLI.** src/server.ts:589–593 requires inputArtifacts.path with args.path, but src/cli.ts:348–352 sends only tool/args. CLI upload is rejected INVALID_ARGUMENT, violating B16/§4.3/L02 entrypoint consistency. MCP src/mcp.ts:103–107 auto-uploads; SDK works. Two agents independently reported it.

**AT-P2-06 Steps after reload inside flow fail.** chrome.runtime.reload clears storage.session lbControl, and worker does not reissue __lb_control between steps. lbGuard throws CONTROL_REVOKED afterward; the report describes failed/unknown. This explicit failure changes combination semantics; document it in COMPATIBILITY or rebuild control between steps.

### Domain C: takeover and rate-limit stops (L04 / L05)

**AT-P2-07 ask never restores control after handover.** src/worker.ts:297–342 sets browser.control(job,true) when ask becomes ready, but resume/ask_finish("continued") never calls control(job,false); only human :375 and execute start :475 reset it. Owner flow [...,ask,click,...] fails subsequent steps after human Continue. handoff-regression.mjs:177–197 only tested standalone ask.

**AT-P2-08 Cooldown reads input.url only; commands/flows bypass shared-site cooldown.** src/store.ts:184–199 sees neither args.url nor steps[].args.url, leaving only profile matching. Another profile can navigate/fetch/flow to the cooled site, violating L05. Parse command/step URLs.

**AT-P2-09 Handover stop confirmation is a state-write receipt, not in-flight quiescence (R05 residual boundary).** src/worker.ts:311–334 and runtime background.js:300/1534/1543/1559 guard dispatch, act steps, and L1/L2 boundaries. A DOM action/JS already past a guard may continue alongside VNC input. Native download rechecks :1965, but generic in-flight steps lack a quiescence fence. Recorded as a known implementation boundary needing improvement.

### Domain D: capture integrity (L01 / R07)

**AT-P2-10 Embedded mediaCoverage is only a total.** src/article.ts:115 counts video/audio/iframe/mpvoice/qqmusic; :547 and :597–599 lack per-type/location/state requirements. Media pages still succeed, contrary to L01's individual unsupported-media reporting.

**AT-P2-11 Removing noscript reduces discoveredImages denominator.** src/article.ts:85 deletes it before discovery. Sites storing real lazy images there lose them without discovery/failure/placeholder entries.

**AT-P2-12 srcset chooses the last written candidate.** src/article.ts:95–96 uses split(',').at(-1), although source order need not be ascending width; low resolution may silently become the original.

**AT-P2-13 textCoverage never emits partial; missingFragments is always null.** src/article.ts:511–512 is binary, :536 hardcodes null. Collapsed/read-more state is only current_DOM_only (:534); :359 explicitly does not click expansion, despite design's three-state/missing-fragment description.

**AT-P2-14 Weak version-binding evidence.** src/article.ts:390–395 concatenates chunks without length checks; modified marker/out-of-range slices rely on final.same. :526/:529 use identical contentHash/documentRevision; block textHash lacks reconstruction relationship to full hash. :363/:385 permit metadata/body revision mismatch between describe/freeze.

**AT-P2-15 Artifacts from incomplete failed packages remain consumer-visible.** src/worker.ts:503–508 uploads individually; failure leaves prior files stored. src/server.ts:155,192 lists/downloads them unconditionally. Consumers can retrieve packages without manifest/incomplete marker, contrary to failed-output visibility requirements, consuming quota until deletion.

**AT-P2-16 Three credential/data-retention deviations.** (1) Restricted original-URL metadata allegedly absent: final original request unavailable; failed-image address is redacted, preventing signed-query retry (src/article.ts:554–559). (2) redactUrl covers query/userinfo, not credential path segments or keys outside its denylist (src/util.ts:66–82). (3) worker journalFinish at :256 stores full results, including binary-fetch base64 from runtime background.js:2098–2102, duplicating originals indefinitely in SQLite although task directories are removed.

### Domain E: API contracts (L02 / section 7)

**AT-P2-17 AUTH_REQUIRED is dead code.** src/contracts.ts:280 defines it, but no emitter exists. waiting_user/reason, ACCOUNT_VERIFICATION_REQUIRED (src/server.ts:603–607), and ACCESS_BLOCKED handle actual paths without documented mapping. Consumers using the frozen error table cannot observe it.

**AT-P2-18 Screenshot without savePath embeds complete base64 JSON without application limit/artifact conversion.** runtime mcp-server.js:646–651 returns image content; src/server.ts:153–194 passes it through. Only worker WebSocket maxPayload 32 MB limits it. download/fetch savePath become artifacts (worker :556–579), but screenshot inline output does not, contrary to long-output requirements.

### Domain F: security/deployment (section 8 / R01 / R06)

**AT-P2-19 Gateway joins shared default bridge and binds unauthenticated 18880/18881 on 0.0.0.0.** deploy/isolated.mjs:138 joins default bridge to reach core; network.ts:62,121 and relay.ts:74–75 listen unauthenticated. Neighbor containers can use public proxy egress and share L2 with plaintext gateway→core bearer traffic. Private-network checks remain effective, but isolation is weakened. Use a separate core network, private-interface binding, or token. **Resolve before opening restricted-product access.**

**AT-P2-20 Temporary/failed directories have no reclamation.** worker.ts:675–695 leaves failed bodies/images/ZIP indefinitely. artifacts.ts:30–38 counts crash-left .partial toward quota without startup/janitor cleanup; boundaries.test.ts:116–133 explicitly tests quota charging. This violates temporary-area retention intent and risks long-run disk exhaustion.

---

## P3 summary

|ID|Finding|Location|
|---|---|---|
|AT-P3-01|Fastify errors such as >2 MB body 413 return INTERNAL even with 4xx|src/server.ts:83–89|
|AT-P3-02|Wall timeout sets cancelRequested without event, unlike API cancel|src/broker.ts:234 vs :336–338|
|AT-P3-03|Deleted artifact GET returns 403 rather than explicit deletion/410; deleted appears only in task view|src/artifacts.ts:189|
|AT-P3-04|Tool status is static implemented_pending_environment_verification instead of worker/profile state; report says restricted products cannot see worker state|src/server.ts:252,248–251|
|AT-P3-05|Handoff ticket appears in POST JSON; server omits bodies, but proxy/client logs might persist it|src/server.ts:992|
|AT-P3-06|Terminal result from waiting_user does not closeViewers; connection may last 10 minutes although data is disconnected/inputs dropped|src/broker.ts:157–206; src/server.ts:1043–1046|
|AT-P3-07|ask until may resolve without human input; worker continues while service waits until result, raising an implicit-resumption semantic gap|runtime background.js:2386–2390|
|AT-P3-08|ask lacks humanWaitSeconds enforcement, relying on ask/wall timeouts; offline waiting_user allegedly holds resident quota until wall expiry|src/worker.ts:297–342|
|AT-P3-09|Only navigation 429 is observed; subresource/image limits ignored; cooldown linked only to article result, not commands/flows|src/browser.ts:159–171; src/broker.ts:158–166|
|AT-P3-10|Tasks/includeCommands/artifacts return all items without pagination|src/server.ts:712–717,789–791|
|AT-P3-11|Truncation relies on upstream text regex; worker silently slices errors to 1,000 characters|runtime mcp-server.js:667; src/worker.ts:599–603|
|AT-P3-12|EXECUTION_MISMATCH/isolationVerified trust worker-reported environment/attest; identify trust source|src/server.ts:374–410,650–659|
|AT-P3-13|store.holds never called; no per-action server recheck, actual engine fence linked through job.fence|src/store.ts:394–399|
|AT-P3-14|Nontransactional cooldown read/merge/write may lose maximum until under concurrency|src/store.ts:153–175|
|AT-P3-15|MCP submission connection failure returns problem(e) without commandId/query-first unknown-result guidance|src/mcp.ts:145–152|
|AT-P3-16|CLI capture without --key generates new keys/no recovery file, so script retry recaptures; already disclosed caller responsibility|src/cli.ts:314; docs/API.md:39|
|AT-P3-17|Offline file:// CSP unverified; only server preview tested; Markdown pipes and leading #/- not covered|src/article.ts:581–593,230|
|AT-P3-18|Required items undefined: success requires images/version/no-next-page/stability, but missing embeds/author/time do not downgrade|src/article.ts:597–599|

---

## Cross-reported findings (at least two independent agents)

|Finding|Reporters|
|---|---|
|accessState short circuit/accessible fallback, part of P1-02|Takeover/rate-limit and capture-integrity agents|
|CLI cannot pass inputArtifacts, P2-05|Tool-coverage and API-contract agents|
|Resume transitions before send without quarantine/online checks, P2-02|Reliable-write and takeover/rate-limit agents|

## Defenses found and implementation locations

- **Duplicate-execution prevention:** admission transaction dedupe/insert (store.ts:223–294), IDEMPOTENCY_CONFLICT :232–238, post-dispatch disconnection→suspended/no retry (broker.ts:305–316), job/step worker journals (:446–472/:232–242), non-fresh/non-confirmed replay denied EFFECT_UNKNOWN. TS SDK retries only GET reset/socket once (client.ts:45–57), never POST; Python/MCP/CLI query loops.
- **Control fences:** acquire increments (store.ts:372–388), dispatch carries it (broker.ts:288–292), broker checks messages (:144), engine lbGuard checks commands/act steps/L1/L2/download polling (background.js:300,1534,1543,1559,1765–1766,1965). __lb_control rejects stale generations (:1704–1709). No lease TTL/reassignment without stop proof; server/worker wx process locks (lock.ts).
- **Late evidence:** terminal states append late_evidence without overwriting (store.ts:327–333; broker.ts:167–187,145–148).
- **Ownership:** task/command/session/artifact/SSE/worker reports/handoff/learnings checks (store.ts:300–305; artifacts.ts:187–192; server.ts:146–152,734,1007–1086,1095–1138,1199–1204). Combined 404/403 avoids enumeration (http.test.ts:56–60); SSE rechecks every second.
- **SSRF/egress:** resolve once, validate all A/AAAA, connect literal IP without re-resolution (network.ts:58–59,75–82,103–112); force proxy via <-loopback> (browser.ts:147), disable QUIC/WebRTC UDP (:148–149). Bridge requires extension Origin/pairing token timingSafeEqual (vendor bridge.js:104–108,233–236); internal container network/probes (isolated.mjs:78,160–161).
- **Read-only role:** five-tool allowlist (catalog.ts:30–36), isolated profile, worker isolationVerified (server.ts:576–588); reject __lb envelopes (:597–598,667–671); args.path accepts artifactId only (:589–596).
- **HTML/SVG/preview:** Cheerio stripping, sanitize-html allowlist, relative image src (article.ts:84–206); originals attachment with default-src 'none'; sandbox (server.ts:795–807); preview only generated article.html, two CSP layers and iframe without allow-scripts (:809–838; web/main.tsx:1003–1008). No dangerouslySetInnerHTML.
- **Tickets/takeover identity:** atomic single-use ≤60-second tickets (store.ts:90–101; server.ts:979–980); revoke underlying connection (:997–1006→broker.ts:359–368→worker.ts:211–214); synchronous single controller (server.ts:1019–1033); recheck each input.
- **Rate-limit scope:** both Retry-After formats, maximum existing/new deadline, SQLite persistence (store.ts:130–182); hash(origin|egressId) conservatively spans local profiles (:184–199), tests deny product/profile/worker switching. No account/fingerprint/egress rotation after stop.
- **Artifact publication:** .partial+fsync+rename, bad hash ARTIFACT_INCOMPLETE, MIME magic checks (artifacts.ts:53–186); chunk-level authorization/revocation/quota (:65–101); streaming download/deletion abort (:193–226); traversal-resistant filename/key validation (util.ts:32–43; artifacts.ts:18–22).
- **SSE:** events/state share a transaction (store.ts:324–342); Last-Event-ID/after continuation (server.ts:732–766).
- **Tool parameters:** fetch/screenshot/upload/act/ask/network/eval/download families reviewed without renaming/dropping/default drift; frontend pagination/upload/download relocation/screenshot MIME/long-command budgets retained; 107 parameters match frozen schemas.
- **Workers:** owner-created, one-time bearer, duplicate connections denied, 45-second heartbeat (server.ts:341–373,1087–1094; broker.ts:48–54,210–213).

## Suggested repair order and regression additions

1. **P1-01**: described as the gap encouraging duplicate external submissions; inject mid-act TIMEOUT and assert unknown/quarantine/rejected replay.
2. **P1-02/P1-03 together**: slow SPA stationary ≥750 ms then content at 3–6 seconds, optionally placeholders for four screens followed by real images; ensure placeholder hashes do not count. Long English HTTP 200 error article must not succeed.
3. **P2-07/P2-08**: flow ask followed by action; cooled site reached from another profile through navigate/fetch/flow must return SITE_COOLDOWN.
4. **P2-05**: align CLI with MCP automatic upload at mcp.ts:103–107.
5. Remaining P2 after dev.2 freeze; **P2-19 before restricted access**, P2-20 before long-running deployment.
6. Disconnect worker during third artifact upload; task must not succeed or expose incomplete manifest-less packages (P2-15).

## Method and limitations

- Static path reasoning, no runtime reproduction. Trigger conditions need actual browser/network confirmation; unexamined paths may exist and no finding does not prove no vulnerability.
- Not covered: actual concurrent timing (synchronous SQLite resolves much of it; multiprocess boundary only lock-reviewed), internal upstream vendor defects beyond patches/adapters, detailed web/main.tsx UI logic.
- Baseline is 2026-09-15 `592b5c9` plus dirty tree; subsequent changes may invalidate findings. Recheck current code item by item.
- The six agent reports' conclusions, locations, and reasoning were collected/condensed here. This document changes no code or evidence index.
