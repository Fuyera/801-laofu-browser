# laofu-browser Product Design Requirements

[简体中文](DESIGN.md) | **English**

> Execution amendment, 2026-09-14: this document retains the v0.2 capability requirements and R01–R08. The user-approved [implementation plan](IMPLEMENTATION_PLAN.en.md) supersedes the historical A–D phases and consumer arrangements below: an independent 801-laofu-browser project, Mac first, P0→P5. Two SDK programs installed outside the project call the real service in this delivery; Fuyera/Qidao/000 are not modified, and this is not described as integration with two business products. Current operational facts are in [acceptance](ACCEPTANCE.en.md) and [current context](../CURRENT_CONTEXT.en.md). Statements such as “no repository created yet” describe the original design date, not current status.

Version: 0.2 · Date: 2026-09-14 · Status: design reviewed and revised; implementation and acceptance pending at the time of writing.

This document responds to the request to cover huashu-chrome fully and add cross-product capabilities. Its original location in the 101 design handoff directory does not make laofu-browser part of Fuyera's business core; implementation belongs in an independent product/shared-capability workspace. This document does not authorize modifying other products, expanding server exposure, or publishing software.

## 1. Positioning and Goals

laofu-browser is an independent browser execution product for applications, agents, and people. It reads pages, performs actions, retrieves files, and hands control back to a person within authorized browser, device, and account contexts, with traceable tasks and reusable artifacts.

The originally proposed first consumer is Fuyera: a WeChat article URL becomes full-text Markdown, local images in their original order, source metadata, and completeness results. A second scenario uses a self-hosted form and file upload to demonstrate capabilities beyond WeChat collection. Content-administration metrics are a potential later consumer scenario, not a second product already integrated.

The initial design targets the owner and internally managed products. This scope assumption neither authorizes an external business nor grants access to every device. Each product has its own identity and permissions. External multitenancy requires a separate release scope; sharing a personal browser cannot simply be opened to others. Full coverage remains the goal, and internal versions must disclose unverified systems and capabilities.

Goals:

1. Preserve all huashu-chrome 1.2.0 tools and operational capabilities with itemized acceptance criteria.
2. Serve applications through API/SDK and agents through MCP, using one execution, permission, task, and artifact core.
3. Support an authorized signed-in desktop Chrome and independent server browsers, reporting actual availability by site, account, and environment.
4. Package common multistep operations as tasks with result contracts while retaining the full low-level tool interface.
5. Show users which account is being operated, what was saved, and what is blocked, with pause, handoff, and cancellation.

Non-goals: defeating CAPTCHAs or platform controls, bypassing paid access, guaranteeing every website succeeds, copying personal cookies to the cloud, or publishing without authorization. This is not a replacement model platform or content-strategy system.

## 2. Source Baseline and Coverage Principles

Upstream: https://github.com/alchaincyf/huashu-chrome . The baseline is the actually installed npm package `huashu-chrome@1.2.0`, under MIT, by 花叔 (alchaincyf). Preserve its copyright and license with derived code and distributions; a new brand does not imply entirely original authorship.

Baseline files include `src/mcp-server.js`, `src/cli.js`, `src/bridge.js`, `src/lib/`, `extension/`, `docs/协议.md`, `docs/能力模型.md`, `docs/双脑.md`, `docs/快照格式.md`, and `docs/经验/`. The [baseline manifest](LAOFU_BROWSER_BASELINE.json) freezes complete input schemas/descriptions and schema hashes for 23 tools, 58 file hashes, a directory of 23 site notes, and the package URL/integrity from the installation lock. The archive was not downloaded and reverified in this design review, nor was its Git commit confirmed. Neither may be represented as verified. Record and test differences between claims and implementation; README claims do not establish acceptance.

The actual registry has 23 entries; an earlier “22 tools” description is not grounds for removing one. Batch execution has `allowSensitive`, so the old absolute claim that batches never submit is inaccurate. Determine `eval` execution worlds, CSP/debugger fallbacks, and upload paths from implementation and environment-specific tests.

“Full coverage” means tools, parameter families, behavior, errors, runtime support, diagnostics, and site knowledge—not just tool names. Full raw tools are for browser owners with the required authorization. Restricted products receive constrained task/action subsets; arbitrary JavaScript cannot be claimed to provide action-level read-only access. Stricter authorization is acceptable with an authorized usage path and documented compatibility differences. Unsupported OS interfaces must fail explicitly or return control to a person.

Full coverage is the final acceptance condition. Intermediate releases must identify gaps; an article-capture slice is not the complete product.

## 3. Baseline Tool Coverage Matrix

Every tool needs explicit session context, typed errors, timeouts, and applicable permission checks. Compare automatically against the baseline schema to catch parameters beyond the families below. Changing defaults or limits is a compatibility change.

| ID | Tool | Required behavior and parameter families | Main acceptance criteria |
|---|---|---|---|
| B01 | `snapshot` | Compact interaction tree, ref/snapshotId, value/checked/selected/expanded/disabled states, dialog notices, body excerpt, iframe `@fN` routing | Rerenders, same/cross-origin iframes, stale-reference rejection |
| B02 | `navigate` | URL, forward/back/reload, target tab, new snapshot | Traceable navigation, redirects, and new-page identity |
| B03 | `click` | ref, role/name/find, selector, coordinates, dragTo, real, expect | Controls, canvas dragging, real events, no effect and failed expectations |
| B04 | `type` | input/textarea/contenteditable, clear/append, submit, ref/find/selector, real, expect | Chinese/multiline/rich text, submit authorization, value readback |
| B05 | `select` | Native select by value/label, expect | Verify selection; custom dropdowns use click |
| B06 | `fill` | Multiple fields in one snapshot, text/select/checkbox/radio, clear, submit/submitRef | No submission after a field failure; shared write authorization |
| B07 | `key` | Keys, combinations, sequences, repeat, optional focus target, real | Tab/Enter/Escape/arrows, correct focus, no sensitive-text leakage |
| B08 | `read_text` | Body Markdown/text, removal of page clutter | Long articles, tables/code, missing body, explicit truncation |
| B09 | `screenshot` | Target background tab, ref/snapshotId region, scaled JPEG/full-resolution PNG, focus, savePath, full | Never capture another user tab accidentally; no control overlays |
| B10 | `tabs` | list/new/select/close, label, focus, explicit tabId, ownership notices | Concurrent routing, popup tracking, no background focus theft |
| B11 | `wait` | selector/text/idle, timeout, tabId | Early completion; distinguish timeout, obstruction, and no result |
| B12 | `network` | Request lists, filtering, response bodies, historical index, reload, maxBody | Initial/paginated responses, truncation flags, redacted sensitive headers |
| B13 | `fetch` | Signed-in page requests, init, page/cursor pagination, from/step/max, cursorPath, binary, via, savePath/maxBody | Stop on empty/repeated pages or non-2xx; validate pagination, cross-origin images, and permissions |
| B14 | `scroll` | Top/bottom, rounds, wait, ref, automatic container detection, tabId | Virtual/lazy lists, target diagnostics, explicit end conditions |
| B15 | `download` | Native large-file download, timeout, destination, avoidance of OS save dialogs | Files beyond binary-channel limits, completion/interruption/cancellation/checksums |
| B16 | `upload` | Local files/artifact references, file input/accept selection, selector, dropSelector | Normal/large/drag-and-drop uploads and webpage readback |
| B17 | `query` | selector, contains, extracted fields/attributes, HTML length, limit, tabId | Structured lists, attribute/text targeting, completeness versus limits |
| B18 | `act` | click/type/select/fill/key/wait/scroll/navigate/read, expect; repeat/if/assert, until/max, cond/then/else, allowSensitive | Step verification, stop on first error, completed/remaining-step receipts, loop budgets |
| B19 | `ask` | prompt/title/targets, timeout, until, focus, notifications/highlights, human continue/cancel | Do not continue by another route after cancellation; read back completion conditions |
| B20 | `status` | Brief action/plan updates in the page panel | Recognizable product/session identity, no input-body disclosure |
| B21 | `eval` | Page JavaScript expressions, results/limits, diagnosable CSP/L2 state | Preserve authorized expressions; no arbitrary writes for read-only products |
| B22 | `learnings` | List/read/save site notes, separate bundled/local notes, playbooks | Preserve local knowledge, prioritize actual pages, trace conflicts/history |
| B23 | `reload` | Extension reload/reconnect, version-change detection | Maintenance permission, shared-session impact checks, no blind repair |

Verify limits against the frozen schema/implementation: 20 steps per `act` batch, repeat default 10/max 25, 12 MB binary channel, 48 MB drag-and-drop, and `ask` default 5/max 10 minutes. Publish actual limits and alternatives; do not silently truncate or replace streaming with larger caps.

## 4. Operational Capabilities to Preserve

### 4.1 Execution and Interface

- Support L1 content scripts and on-demand L2 debugger use, real events, background screenshots, and supported evaluation fallbacks. Report debugger contention without taking another session's debugger.
- Return changes attributable to the target and whether `expect` was met. Global page changes or HTTP 200 do not establish business success.
- Permit bounded alternatives for safely retryable operations; never automatically resend submissions, publications, payments, or deletions with unknown outcomes.
- Regress dialogs, overlays, page drift, new windows, iframes, shadow DOM, and dynamic editors. State unsupported boundaries explicitly.
- Preserve colored tab groups, page control markers, status panels, timelines, and extension-wide session lists. Hide passwords/private-message input; exclude control overlays from screenshots.

### 4.2 Sessions, Connections, and Failures

- Separate per-session MCP frontends from the resident local bridge. Diagnose singleton takeover, concurrent routing, authentication, idle exit, and reconnects.
- Preserve session identity across bridge restarts. Model browser instance/profile/session/tab/frame/snapshot relationships explicitly instead of using one global current page.
- Support multiple browser instances, agents, and subtasks sharing connections. Main/subtasks need explicit workstream identities; one MCP connection need not mean one caller.
- Preserve offscreen connections, extension service-worker lifecycle handling, heartbeats, version mismatch notices, recovery, and instance selection.
- Invalidate snapshots after rerenders/browser restarts. Task recovery does not make an old ref valid.
- Serialize execution authority per profile by default; one task may own several tabs. Connected/queued sessions do not imply concurrent writes to one account. Parallelize across profiles; shared-profile concurrency requires separate conflict evidence. Upstream occupancy notices are not access control.

### 4.3 Distribution, Diagnostics, and Knowledge

- Cover CLI `install` (backup, idempotency, dry-run, host selection), `mcp`, `bridge`, `call`, `doctor`, `extension`, `audit`, and statistics, with uninstall/stop/rollback instructions.
- Preserve macOS/Windows/Linux client paths, MCP-host configuration, the upstream host table, and discovery. Show configuration changes before applying them; do not scan unrelated private files or upload configuration.
- Report package availability, process state, bridge handshake, extension connection, version match, worker readiness, and site reachability separately. An active service does not prove the browser works.
- Preserve bundled site notes and local records across updates, including dates, environments, failures, and evidence.
- Distribute fixed dependency locks, upstream hashes, licenses, known limits, and a compatibility matrix. Do not deploy floating `latest` versions.

## 5. Added Capabilities

### L01 Complete Article Packages in One Request

`article.capture` accepts a URL, execution policy, and image requirements. It returns original Markdown, downloaded images, optional safe reading HTML/ZIP, metadata, and a manifest. Preserve title, author/WeChat publisher, source/final URL, and capture time. Preserve the original publication-time string; do not guess its timezone.

Keep paragraphs, headings, lists, code, tables, links, and image order without summarizing or rewriting. Handle data-src/src/srcset, lazy placeholders, duplicates, and media types. Separate originals from display derivatives. Retain failed-image URLs and positions. Fuyera's 2 MB publication-image limit belongs to the consumer and does not apply to captured originals.

Report `textCoverage`, `mediaCoverage`, `truncation`, `accessState`, verification method, and unknowns separately. A current-DOM comparison cannot establish that paid, collapsed, or paginated content was fully retrieved. Empty bodies and verification pages must not become successful articles. Complete text with failed required images is partial.

Use `complete_for_scope|partial|unknown` for text coverage, with declared scope (such as currently authorized visible body), pagination/expansion state, and missing segments. Report discovered/successful/failed/unsupported media counts and positions. Do not report 100% when the denominator is unknown. Mark video/audio/cards as downloaded or not; complete images do not mean complete media. `succeeded` means all requested requirements were met; missing/unknown required items with usable artifacts yield partial, while no usable body yields failure or human waiting.

Bind `documentRevision/contentHash` and ordered content blocks at capture time. Text, image lists, and artifacts must come from one stable revision. Recapture from a checkpoint or mark mismatches if the page changes. Use manually verified fixtures to check paragraph/image order, code spacing, table/link semantics, and Markdown escaping; whitespace-stripped character counts are insufficient. Credential-bearing URLs belong in restricted metadata; consumers receive redacted sources with explicit omissions.

Each file has its real type, bytes, dimensions when applicable, SHA-256, source, and body position. Markdown uses stable relative package paths for offline directories/ZIPs. Retain raw tool results for diagnosis.

### L02 Standard Cross-Product API and SDKs

Products use stable service endpoints and capability names rather than private huashu-chrome commands or internal Node modules. Provide HTTP, TypeScript/Python SDKs, MCP, and CLI with consistent task queries. Deployment is independent of the 000 model gateway; identities/quotas may integrate with 000 without building another payment platform.

Raw tools coexist with high-level tasks. Fuyera owns research, topic selection, and publication versions; the browser service executes authorized actions and returns evidence. Do not claim AI Platform protocol integration without verification.

### L03 Server and Desktop Coordination

Support `server`, `desktop`, and `auto`. Auto selects only from authorized device/account scopes and explains its choice. Server-only requests remain failed if unavailable; desktop execution must not masquerade as server success.

Servers use independent persistent profiles; desktops use authorized browser instances. Do not synchronize cookies/passwords by default. Bind profiles to owners/account scopes and verify target accounts at runtime; wait for the user when uncertain.

Switching from server to desktop requires an existing policy or fresh authorization. It changes the execution environment rather than retrying the same attempt. Create linked attempts; do not promise migration of running JavaScript/tab memory. Do not rotate workers/IPs to evade site limits.

### L04 Human Handoff as Part of a Task

In `waiting_user`, show the reason, page, account, step, completion criteria, and expiry. People handle QR login, CAPTCHA, necessary OS interfaces, and business approval.

Use local handoff on personal devices and controlled remote display on servers. Owner trials use localhost VNC/noVNC over SSH: an administrative desktop-wide interface, not task-only product authorization. Never give restricted users the same noVNC link to a shared desktop. Product handoff requires owner-isolated displays/profiles or verified page isolation, plus authenticated short-lived user/task/profile-bound tickets. Do not expose VNC, CDP, or the bridge publicly.

Show whether automation or a person holds control; pause automated clicks during handoff. Disconnecting the viewer neither cancels the task nor closes the browser. Reconnect to the same profile/task. Read back the target condition after “done”; WeChat backend login does not prove article verification succeeded.

Manage handoff through an independent service, not a temporary SSH subprocess removed at the end of an agent turn. Show connection state, reconnect options, and real errors. Do not log QR/CAPTCHA contents or retry them automatically.

Allow one controller; read-only viewers cannot send input. Confirm the old automation stopped before transferring authority—UI state alone is insufficient. Cancellation/expiry/revocation must revoke underlying input. Tickets are short-lived, revocable, and single-use; reconnect requires authentication. Validate WebSocket identity and Origin; keep tickets out of URL logs/Referer. “Done” triggers verification, not automatic success.

### L05 Block Detection, Rate Limits, and Stopping

Distinguish login, CAPTCHA, frequency limits, permission denial, paid access, deleted pages, network failure, and unloaded body. Preserve redacted evidence and explain the next action.

Stop automatic attempts in the affected scope on frequency/rate limits. Configure limits/backoff by site/account/profile/egress. Preserve and obey `Retry-After` when supplied. Otherwise show recovery time as unknown; never promise a fixed wait will work. Do not rotate accounts, spoof fingerprints, or change egress automatically after stopping.

### L06 Recoverable Tasks and Reliable Writes

Bound time, steps, bytes, tabs, and concurrency. Persist checkpoints, completed steps, artifacts, and external effects; UI/client disconnection must not lose tasks.

Use effectState=`not_started|started|confirmed|unknown` for side effects. Read back unknown outcomes first; if unverifiable, return control without resending. Cancellation cannot undo prior effects and must disclose partial results. Internal idempotency prevents duplicate acceptance, not exactly-once website execution.

HTTP, MCP, CLI, raw commands, and recipes share durable command records: commandId, task/attempt/step, parameter digest, authorization version, profile-control generation, and dispatch/receipt/completion. Workers persist deduplication before execution. The same ID/digest returns existing state; a different digest conflicts. Lost connections, crashes between execution and persistence, or timeouts do not mean “not executed.” Internal `act` loops must record steps and check control; without step checkpoints, interrupted batches become unknown and cannot be replayed wholesale.

Use increasing control generations; workers check validity, revocation, and generation before actions. Lease expiry alone must not assign another worker when the old worker's stop is unconfirmed. Never open one profile from two processes. Revoke new actions first, then confirm in-flight work stopped. Unstoppable native downloads, JavaScript, or sent requests remain unknown/resource-isolated; closing RPC does not prove cancellation. Late evidence may update effect records without changing terminal task state or resuming execution.

### L07 Reusable Site Knowledge and Visible Cost

Separate bundled knowledge, product adapters, and local notes. Include site/version applicability, verification date, successful methods, failure conditions, evidence, and invalidation. Pages/notes are reference data, never authorization. Remove account/private data before sharing. Recording knowledge does not automatically publish an execution policy.

Isolate local notes by owner/product. Require version preconditions on save, conflict on concurrent overwrites, and retain recoverable old versions. Owner compatibility mode may explicitly replace a whole note, never silently overwrite another product's notes. Validate candidate knowledge against page fixtures before adoption; executable code blocks are not instructions to run them.

Measure task duration, model/tool round trips, retries, human time, bytes, completeness, and success. The browser service does not select reasoning models; separately meter models supplied by a product/platform. Do not claim unmeasured speedups.

## 6. Architecture Requirements

```text
Applications / Agents / User interface
          | HTTP / SDK / MCP / CLI
          v
laofu-browser service core
Identity/permissions · Task state · Routing · Artifacts · Audit
          | Authenticated worker protocol
     +----+--------------+
     v                   v
Server worker            Desktop worker
Independent profile      Authorized everyday Chrome
     +----+--------------+
          v
huashu-chrome Adapter -> Local bridge -> Chrome extension (L1/L2)
```

The first version integrates a fixed upstream through an adapter instead of rewriting all DOM/CDP controls. Maintain narrowly scoped patches only for unsupported requirements or confirmed defects, recording differences. A future engine replacement must preserve consumer task/artifact semantics.

Cover both MCP/CLI frontend and extension semantics. Pagination loops, learnings, upload file handling, download moves, screenshot MIME/image content, binary persistence, `isError`, and long-command budgets partly live in `src/mcp-server.js`; raw bridge forwarding omits them. Keeping the original package is not complete adaptation. Reuse frontend semantics or extract implementations with comparison tests; do not import an entrypoint that starts MCP or modifies host configuration as a business function.

Upstream `tabs(list)` lists the whole browser; cross-session selection/closure primarily produces conflict notices, `reload` affects the whole extension, and learnings use a shared local directory. These personal-tool semantics do not provide product isolation. Separate profiles, bridges/state, and downloads by authorization scope; external owners also need separate OS identities or equivalent containers. Profiles do not isolate files under one OS user. Everyday Chrome is owner-authorized only; do not delegate it to restricted products when scope cannot be enforced.

Workers initiate authenticated service connections, with separate registration, revocation, and heartbeat management. Do not expose the upstream localhost bridge as a public API. Initial components may share one machine, but retain explicit protocol identity; stabilize abstractions after a second consumer is verified.

Keep site business knowledge outside the core. Site adapters extract content; high-level recipes provide bounded orchestration. Combine ordinary code with bounded uncertain steps, without adding a generic Graph DSL or supervisor hierarchy.

## 7. Draft Interfaces and States

These are proposed interfaces to freeze, not claims of existing implementation:

| Interface | Purpose |
|---|---|
| `GET /v1/capabilities` | Tool/task versions, parameter schemas, environment support and limits |
| `POST /v1/sessions` | Select an authorized worker/profile and create a session |
| `GET /v1/sessions/{id}`, `DELETE /v1/sessions/{id}` | Query/close; resolve in-flight commands before releasing control; retain persistent profiles |
| `POST /v1/sessions/{id}/commands` | Invoke B01–B23 with complete typed validation |
| `GET /v1/sessions/{id}/commands` | Find accepted commands by client correlation ID and recover lost receipts |
| `GET /v1/commands/{id}`, `POST /v1/commands/{id}/cancel` | Query/stop long commands independently of the original HTTP connection |
| `POST /v1/tasks` | Create article.capture or an explicitly bounded workflow |
| `GET /v1/tasks/{id}` | State, progress, execution position, partial results, external effects |
| `GET /v1/tasks/{id}/events` | Resumable SSE with sequence numbers |
| `POST /v1/tasks/{id}/cancel` | Cancel pending steps and report existing effects |
| `POST /v1/tasks/{id}/resume` | Controlled continuation from checkpoints/human state |
| `POST /v1/tasks/{id}/handoffs` | Create a short-lived, revocable handoff |
| `DELETE /v1/tasks/{id}/handoffs/{handoffId}` | Revoke connection/input, distinct from task cancellation |
| `POST /v1/artifacts` | Stream uploads; issue artifactId only after size/hash/MIME validation |
| `GET /v1/artifacts/{id}` | Authorized metadata/download, including large-file streaming |
| `DELETE /v1/artifacts/{id}` | Owner-authorized deletion/download revocation with expired/deleted task references |
| `GET /healthz`, `GET /readyz` | Separate liveness from scoped capability readiness |

Example task request:

```json
{
  "type": "article.capture@v1",
  "input": {"url": "https://mp.weixin.qq.com/s/kr_Zk5i4fZJ3NlyLPtKVKQ", "downloadImages": true},
  "execution": {"mode": "server", "profileId": "authorized-profile"},
  "limits": {"queueTimeoutSeconds": 60, "activeTimeoutSeconds": 180, "humanWaitSeconds": 600, "wallTimeoutSeconds": 900, "maxSteps": 30, "maxBytes": 52428800}
}
```

These budgets are examples, not performance commitments. Derive product identity from authentication, never a self-reported productId. The profileId must be authorized for the caller.

States: queued → running → succeeded / partial / failed / cancelled. Running may enter waiting_user or suspended and resume only when conditions hold. Late responses cannot overwrite terminal states. Waiting does not use active execution quota, but browser memory/connections/profiles consume waiting/residency quotas. Confirm old actions stopped before handing over exclusive control; queued requests and handoffs must expire.

Budget queue, active execution, human waiting, total wall time, and residency separately. Waiting consumes wall/residency budgets. Recoverable states expose resumeAllowed, reason, deadline, and required checkpoints/accounts/permissions. Terminal states cannot resume. New attempts cannot override human cancellation or restore revoked permissions. A linked server-to-desktop attempt requires the previous attempt stopped/isolated and separately versioned outputs.

Each attempt has attemptId; taskId is stable and requestId is correlation only. Scope Idempotency-Key by product; the same key with a different request digest conflicts. Responses include capabilityVersion, workerId, profileId, checkpoint, artifacts, warnings, error.code, retryable, nextAction, and effectState.

Command creation also requires idempotency and returns commandId. Synchronous waiting only limits response wait; expiry returns 202 and a query location, not execution failure. Task/human budgets must accommodate tool parameters; HTTP/RPC/proxy budgets are separate. MCP preserves final content/isError; after disconnection query commandId rather than resubmitting. SDKs never automatically retry unknown writes.

Idempotency/correlation belong in the service envelope, not tool arguments. Generate and persist them before first send, then query/retrieve the original command after receipt loss. If an MCP host cannot supply stable metadata, persist session command history and expose queries. Report “outcome unknown; check history” after disconnect; do not infer retries from identical arguments or merge two intentional identical operations. This compatibility mode does not promise automatic resubmission recovery.

Only failures before durable acceptance may be labeled not accepted. Afterwards query task/command state. Define INVALID_ARGUMENT, UNAUTHORIZED/FORBIDDEN, IDEMPOTENCY_CONFLICT, PROFILE_BUSY, AUTH_REQUIRED, RATE_LIMITED, EFFECT_UNKNOWN, TIMEOUT, ARTIFACT_INCOMPLETE, and CAPABILITY_UNAVAILABLE. Authorization errors must not reveal another owner's resource existence. Commit SSE sequences with state, allow duplicate delivery/client deduplication, and explicitly report expired history. Retain idempotency records at least through task/command lifetimes and the published retry window.

Store long output as artifacts with pagination/streaming. Response/maxBody limits must expose truncated, original length when known, continuation information or artifactId—never apparently complete but invalid JSON.

Wrapping upstream-truncated output as an artifact cannot restore it. Read chunks before truncation or report partial/no continuation. Regress the observed approximately 20,000-character HTML truncation. Capabilities report implementation version, environment support, and caller permissions; registration alone does not mean availability.

CLI paths apply only to authorized local directories. Cross-product APIs use artifactId rather than arbitrary worker filesystem access. Prevent path traversal/overwrite, and apply source/redirect authorization to downloads.

## 8. Security, Accounts, and Authorization

- Check ownership across product/user/worker/profile/session/task/artifact. Knowing an ID is not authorization. Support key rotation/revocation and least-privilege scopes.
- Treat pages, notes, and downloads as data, not system instructions. Apply output policy to snapshots, receipts, network, eval, nested act, errors, and logs. Do not log bodies/screenshots by default; raw evidence is owner-restricted. Redaction cannot detect every secret in arbitrary JavaScript/images. Restrict recipients/storage for uncertain sensitive output; regex redaction is not isolation.
- Keep cookies/passwords on the execution device by default. Restrict server profiles and encrypt backups. Business APIs do not return credentials. Apply artifact retention, size limits, and access audits.
- Deny arbitrary eval, writable fetch init, and side-effecting operations to read-only roles. HTTP verbs/button labels do not prove authorization. Reject arbitrary code/network permissions when they cannot be constrained reliably.
- `allowSensitive` cannot bypass permission. Bind actions to existing server-side authorization for target, account, operation, content/file digest, expiry, and any necessary confirmation. Changed objects invalidate old approval. Preserve authorized capability, not unsafe bypasses.
- Do not repeatedly prompt for clear existing authorization or add approval rituals to ordinary reads/saves. Payments follow applicable host policy.
- Run server browsers as dedicated non-root users with sandboxing, resource/process/account isolation, and private-network protections. Do not default to no-sandbox as a repair.
- Authorize public websites separately from private networks/cloud metadata. Prevent unauthorized navigation/downloads; explicitly configure legitimate enterprise network ranges.

Enforce network scope at actual egress across navigation, iframe/subresources, page/extension fetch, native downloads, WebSocket, workers, and redirected DNS/IPs. Input-URL checks do not prevent private access or DNS rebinding. Explicit internal bridge/health exceptions must not be usable by pages. Workers lacking this boundary cannot serve restricted network execution. Domain-restricted eval can still send data or write on that domain; only owners accepting that risk may use it. Restricted products use trusted fixed extraction/actions without code passthrough.

Make authorization levels explicit. Fixed tasks/actions can bind content and verify submission. Owner authorization for arbitrary code grants full execution within the browser scope; code analysis cannot reliably identify every publication/payment. Never upgrade fixed-action approval to arbitrary execution. Products requiring enforced per-action approval cannot receive arbitrary code access.

Separate original artifacts from reading previews. Keep originals for authorized download; do not execute original HTML/SVG on the service origin. Remove scripts, handlers, dangerous URLs/embeds from HTML/Markdown/SVG previews and use script-free isolated readers. Offline packages must not load tracking resources by default. Mark transformations; preserving original text does not require executing active code. Keep credential URLs out of public manifests, ordinary logs, and model context.

Write files to task-specific temporary areas, validate bytes/hash/real type and image decoding limits, then publish manifests. Commit completion and references atomically; failed files cannot be complete artifacts. Bound disk, decoded pixels, decompression, concurrency, and per-product quotas; prevent traversal, symlink escape, and overwrites. Content-Length checks alone are insufficient. Incomplete uploads cannot be submitted; an input displaying a filename does not prove website receipt/form submission.

Configure artifact/log/event/profile retention and capacity before deployment. Ending sessions preserves profiles; expired artifacts remain explicitly expired in task records. Deletion must revoke new and existing download authorizations, not only remove database rows while leaving persistent links. Disclose backup retention and actual erasure timing. Profile rebuilding and credential deletion are separate maintenance actions.

## 9. Deployment and Maintenance

Verify macOS desktop and Ubuntu 24.04 x86_64 server first, with Windows/Linux desktop required for full coverage. Do not claim unverified CPU architectures.

Server execution needs headless automation and headed/virtual-display handoff. Profiles persist through restarts; in-memory state need not survive mode changes. Tasks likely to need QR/CAPTCHA/editing should start with a remotely visible browser. Headless-to-headed restarts are explicit recoverable new attempts: save checkpoints, disclose memory loss, and recheck account/page state. Do not promise seamless continuation.

Packages include fixed versions/locks, configuration templates, dedicated users, health checks, resource caps, upgrades/rollback, and profile backup/restore instructions. Automatic repair must not erase profiles, refresh unsaved forms, or interrupt unrelated tasks. Drain/pause shared tasks before extension upgrades, then reload and verify.

Report service readiness, site reachability, task success, artifact completeness, and product acceptance separately. Installation is not business success.

## 10. Observed Evidence and Design Constraints

| Observation | Fact | Requirement |
|---|---|---|
| Local WeChat article | 5,325 DOM characters, no missing nonempty lines, 11 validated images | Bind source to artifacts; article package is the higher-level result |
| Original read_text | Readable text, no image Markdown in this run | Add site-aware image/text extraction |
| Large HTML eval | Truncated near 20,000 characters, invalid JSON | Artifact-based long output and explicit truncation |
| Japan Ubuntu server | Headless Chrome/extension/bridge ran; known image bytes matched local files | Server mode is feasible, not universal site access |
| Japan WeChat article | Verification remained after backend login; user reported repeated frequency warnings | Explain blocks and stop instead of repeatedly requesting verification |
| Remote handoff | Temporary SSH exit disconnected viewing while browser remained; launchd management restored connection | Manage tunnel and task lifecycles independently |

Local collection and Japan experiments are archived privately, not distributed. The frequency warning is user feedback, not proof of WeChat's internal rules. No fixed recovery delay has been established.

## 11. Acceptance and Release Requirements

### 11.1 Full-Coverage Gate

Maintain requirementId → schema → implementation → automated/manual evidence → environment/version → status. B01–B23 and every item in section 4 need evidence, using verified / partial / blocked / not_implemented. Overall pass rates cannot hide critical gaps.

Compare all input parameters, defaults, limits, responses, and errors. Except for explicit human-authorization improvements, upstream calls remain available through compatibility entrypoints. Tool names alone do not establish compatibility.

Frozen schemas contain 107 top-level parameter entries, including repeated fields, plus nested definitions. Defaults are often prose, not executable JSON Schema defaults; implementations may accept undeclared arguments and have no outputSchema. Compare original/adapter same-input samples for success, failure, MIME, isError, truncation, files, and side effects. Classify differences as accepted_difference, upstream_defect, or blocker, preserving authorized paths. Compatibility does not require session leakage, silent overwrites, or unknown-write replay.

### 11.2 Required Scenarios

1. DOM states, stale snapshots, iframes, shadow DOM, rich text, drag/drop, canvas, real events, dialogs, and navigation.
2. Pagination ignoring inputs, repeated cursors/empty pages, network errors, lazy images, large files, resumable retrieval or explicit restart.
3. Concurrent products/sessions/subtasks on shared connections without page/response/account/artifact leakage.
4. QR/CAPTCHA waiting, reconnects, cancellation, unmet completion criteria, and stopping on rate limits.
5. Separate task/bridge/extension/browser restarts: stale refs invalidated, checkpoints queryable, unknown writes never resent.
6. Consistent HTTP/MCP/CLI task queries, idempotency conflicts, SSE recovery, download permissions, and over-limit behavior.
7. Real local WeChat packages and an independent ordinary page. Blocked server sites report waiting_user/failed; prove successful server collection with a legally accessible page.
8. Controlled form uploads covering success, partial writes, and unknown submissions. Real publication is not a default prerequisite.
9. Credential redaction on every output path, unauthorized profile/artifact rejection, and no arbitrary eval/network-write bypass of read-only permission.
10. Fixed installation, upgrade, rollback, stop, and data preservation; handoff links survive the agent turn.
11. Old workers recovering after partitions, duplicate command delivery, lost execution receipts, control transfer, and revocation during act loops. No duplicate submission or new steps by an old controller. Downloads continuing after timeout remain visible and bounded.
12. Synthetic sensitive titles in another product's tab, cross-profile files, redirects/subresources to bridge/private networks, scripted HTML/SVG/Markdown, and oversized decoded images. Deny according to declared permissions without leaking logs; use controlled sites and fake credentials.
13. Two independent identities create tasks, upload/download, query, cancel, reconnect, and attempt unauthorized access. Quotas prevent a human-waiting task from blocking every product. Track technical dual-client tests separately from real consumer integration.

Measure baseline task duration, tool latency, first progress, peak memory, output size, and human time, repeating the same task/environment at least three times and reporting ranges. Freeze SLOs from measurements, not speed claims. Candidate budgets: HTTP wait 30 seconds, active collection 180 seconds, human waiting 10 minutes. HTTP expiry returns an asynchronous handle without stopping the command. Upstream download defaults to 120 seconds; ask defaults to 300/max 600 seconds. Allow transport margins and test configuration overrides and effects after timeout. Budgets are not completion promises.

### 11.3 Historical Delivery Phases

- A: Freeze baseline/interfaces; verify profile/file boundaries and durable deduplication before full-tool adaptation and local packages. Owner-local candidate only; raw calls bypassing authorization/records fail acceptance.
- B: Server workers, persistent tasks, control, and handoff; correct stopping on blocks/limits. Add fault injection, artifact/egress boundaries, and two-identity isolation before internal cross-product trials.
- C: Real Fuyera package integration and one real scenario in a second independent product using published API/SDK; controlled upload, interface consistency, and full-tool regression. The second product is not selected; test pages or another button in one product are not substitutes.
- D: macOS/Windows/Linux matrix, installation/upgrade/rollback, documentation, and fixed artifacts. Unverified upstream-supported platforms remain gaps.

Original full-product criteria require baseline acceptance or explicit differences retaining authorized capability, L01–L07 acceptance, at least two actual product consumers, and deployment/SDK/permission/recovery handoff. Two-identity tests prove technical isolation; two real products prove integration. One article, one machine, mocks, or protocol tests cannot replace this. Server WeChat body access remains blocked; verify server text/images using legally accessible sites. The execution amendment at the top supersedes the historical consumer gate.

## 12. Handoff and Open Decisions

Deliver requirements, frozen schemas, SDK/examples, runnable service/workers, extension, fixed dependencies/licenses, regression evidence, site matrix, installation/upgrade/rollback, and failure procedures.

Before implementation, establish repository ownership/location and authorized devices. Continue internal-product preparation rather than building an external commercial platform. Set retention/capacity before internal trials; select the second actual product and business acceptance owner before historical phase C. External multitenancy requires renewed isolation/operational-scope decisions. These do not block design delivery but cannot be assumed complete at their relevant stages.

Suggested ownership: an independent laofu-browser project, potentially integrated as 000's shared browser capability, with Fuyera as consumer. This proposal itself did not create a repository, modify 000, or commit every product to migration.

## 13. Design Review Findings (v0.1 → v0.2)

These are design gaps, not runtime vulnerability claims about an unimplemented service. P1 risks authorization, duplicate effects, or materially false results and must be resolved before the affected capability opens. P2 concerns compatibility/acceptance omissions before full release. Requirements/schema were revised in this review; runtime acceptance remained pending then.

| ID | Priority | Original gap/evidence | Revision and acceptance location |
|---|---|---|---|
| R01 | P1 | Session isolation did not explain that upstream notices are not enforcement; tabs reads the entire instance and reload affects the shared extension | Sections 2/4/6/8: owner/restricted entrypoints, profile/OS/files, raw execution boundaries; scenarios 3/9/12 |
| R02 | P1 | Task keys/unknown states alone do not prevent duplicate commands, two workers, or running act loops | L06/section 7: command records, pre-execution deduplication, control generations, no reassignment without confirmed stop; scenarios 5/11 |
| R03 | P1 | 30-second sync wait conflicts with 120-second downloads and 300–600-second ask; download timeout only removes listeners | Sections 7/11: asynchronous queries, separate budgets, late effects, upload/session/handoff lifecycle; scenarios 6/11 |
| R04 | P2 | Names/hashes alone omit frontend pagination, files, learnings, content formats | Baseline manifest v2 and sections 6/11: schemas, frontend comparisons, MIME/isError/differences; truncated output is not full text |
| R05 | P1 | Task-bound noVNC still controls a shared desktop; UI pause does not prove command stop | L04/section 9: administrative versus product handoff, isolated displays, input revocation, visible browser from task start; scenarios 4/11/12 |
| R06 | P1 | Redaction/safe HTML/private-network protection lacked enforcement locations; raw code, subresources, and previews bypass superficial rules | Section 8: recipient restrictions, real egress enforcement, isolated previews, atomic artifacts/deletion; scenarios 9/12 |
| R07 | P1 | Undefined completeness criteria; DOM counts miss ordering, collapsed content, or mixed revisions | L01: scope/revision/unknown/required-item states, ordered blocks, independent fixtures; scenarios 2/7 |
| R08 | P2 | Two test scenarios could be mistaken for product integrations; isolation scheduled too late | Sections 11/12: boundaries in A, dual identities in B, real products in C, all baseline capabilities remain final gates |

Upstream references use the [frozen](LAOFU_BROWSER_BASELINE.json) `huashu-chrome@1.2.0`: `extension/background.js` download around line 1923, tabs 2241, ask 2320, reload 2412; schemas/startMcpServer in `src/mcp-server.js`; in-memory requests in `src/lib/rpc.js`; shared directory/whole-file overwrites in `src/lib/learnings.js`. Source reading establishes structure, not live service/browser/security acceptance in that review.
