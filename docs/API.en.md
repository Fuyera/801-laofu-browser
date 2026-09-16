# HTTP, SDK, MCP, and CLI contracts

[简体中文](API.md) | **English**

All API paths use `/v1`. Executable request validation is defined in `src/contracts.ts`; `openapi.json` is exported from actual Fastify routes. Request, response, and error definitions are in `schemas.json`. The frozen schemas for the 23 original tools do not add idempotency parameters; their 107 parameter definitions match upstream.

## Authentication and permissions

Every HTTP endpoint except health probes requires `Authorization: Bearer <product-token>` or a local administration cookie. A one-time initialization ticket valid for 10 minutes exchanges for an HttpOnly, SameSite=Strict cookie valid for 8 hours. The default listener is loopback only. Product credentials can be revoked separately; an owner's daily Chrome cannot be granted to a product identity.

|Purpose|Endpoints|
|---|---|
|Capabilities and environment|`GET /v1/capabilities`, `GET /v1/profiles`, `GET /v1/diagnostics`|
|Product credentials|`GET/POST /v1/admin/products`; `POST /v1/admin/products/:id/rotate`; `DELETE /v1/admin/products/:id`|
|Workers|`GET/POST /v1/admin/workers`; `DELETE /v1/admin/workers/:id`; `POST /v1/admin/workers/:id/attest`|
|Browser authorization|`PATCH /v1/admin/profiles/:id`; recover quarantined profiles with `POST /v1/admin/profiles/:id/recover`|
|Sessions|`POST /v1/sessions`; `GET/DELETE /v1/sessions/:id`; `GET /v1/sessions/:id/commands`|
|Raw tools|`POST /v1/sessions/:id/commands`; `GET /v1/commands/:id`; `POST /v1/commands/:id/cancel`|
|Tasks|`POST/GET /v1/tasks`; `GET /v1/tasks/:id`; `POST /v1/tasks/:id/cancel`, `/resume`; `GET /v1/tasks/:id/events`|
|Files|`POST/GET /v1/artifacts`; `GET/DELETE /v1/artifacts/:id`; `GET /v1/artifacts/:id/content`, `/preview`|
|Takeover|`POST /v1/tasks/:id/handoffs`; `DELETE /v1/tasks/:id/handoffs/:handoff`; `WS /v1/handoffs/:id/socket`|
|Site notes|`GET /v1/learnings?domain=...`; `PUT /v1/learnings/:domain`; `POST /v1/learnings/:domain/restore`|

`GET /v1/tasks?includeCommands=1` lets the console/MCP recover all tasks and commands belonging to the same identity. `/tasks/:id/resume` and takeover endpoints also accept command IDs waiting for human action. Task listings otherwise return high-level tasks only. SSE supports resuming from an event ID and closes when credentials become invalid.

Restricted products initially receive `article.capture` and `artifacts.write`; `browser.read` and `learnings.write` may also be granted. `browser.read` includes only snapshot, read_text, query, screenshot, and status. Arbitrary scripts, writes, and cross-tab management are owner-only. Each restricted product must exclusively own a profile that passed actual isolation testing. Its browser data cannot be reassigned to another product. After worker restart, isolation evidence must be rebound to the new boot instance.

## Requests, states, and idempotency

```http
POST /v1/tasks
Authorization: Bearer <product-token>
Idempotency-Key: caller-saved-stable-key
Content-Type: application/json

{"type":"article.capture@v1","execution":{"profileId":"prf_...","mode":"desktop"},"input":{"url":"https://example.com/article","downloadImages":true},"requestId":"consumer-request-001"}
```

HTTP tasks and raw commands immediately return 202 with a persistent ID. MCP raw commands wait up to 30 seconds, then return queryable task status. SDK `wait` can wait longer but returns to the caller on human waiting, suspension, or a terminal state. Disconnecting does not cancel work.

A raw command has the shape `{"tool":"click","args":{"tabId":123,"selector":"#button"},"inputArtifacts":{},"requestId":"caller-id"}`. Idempotency keys belong in headers; budgets and requestId remain outside tool arguments. The same identity/type/key/request returns the same ID; a different request with the same key returns 409. The TS SDK retries a GET read once after ECONNRESET / UND_ERR_SOCKET; POST, writes, and other errors are not retried automatically. The SDK never generates a new key to retry an unknown write. CLI `call` saves its key in local `cli-requests` before submission, reuses the product/profile session across calls, and accepts `--session`. CLI `capture` generates a fresh key on each call without `--key` and does not write that recovery file; explicitly save and pass `--key` to avoid duplicate captures.

|state|Meaning|
|---|---|
|queued / running|Queued or executing|
|waiting_user|Automation stopped for human action; confirmation or the original ask condition is required to continue|
|suspended|Worker/service disconnected; previous effects need verification; no automatic replay|
|succeeded|Declared scope and required items were satisfied; not proof of final third-party business settlement|
|partial|Usable output exists, but images are missing, output is truncated, the page changed, or a batch is incomplete|
|failed|No acceptable completed result; inspect error and raw tool output|
|cancelled|Cancellation has settled; external effects may already exist, so inspect effectState|

Evaluate `effectState = not_started | started | confirmed | unknown` separately from task state. `confirmed` confirms the execution receipt. Write tools explicitly report `externalEffects.outcome=not_independently_verified` when final third-party business outcomes were not independently checked. Unknown effects inside a batch propagate upward. Cancellation stops dispatch, revokes control, then awaits confirmation that in-flight work stopped; the profile stays quarantined if this cannot be confirmed.

## Files and integrity

Uploads use application/octet-stream, an encoded bare filename in `X-Filename`, optional `X-Mime-Type`, and optional `X-SHA256`. Success returns artifactId, byte count, and hash. Pass original tool file input through `inputArtifacts.path=artifactId`; HTTP does not accept caller host absolute paths. MCP handles local paths on its trusted host and transfers data through the artifact API.

Downloads include Content-Length, X-SHA256, and attachment headers. SDKs stream, verify integrity, and atomically publish the destination file. Deletion immediately makes a resource inaccessible. Interrupted uploads, bad hashes, budget/quota limits, and disk errors do not produce files marked complete. Native downloads have a separate default 512 MiB limit; drag-and-drop retains the original 48 MiB limit.

article.capture defaults to a 50 MiB content budget. Text is read in chunks from one frozen DOM, recording its revision hash, ordered blocks, image order, and original-image SHA-256. Changes during capture return partial. The manifest's complete_for_scope means only the currently authorized DOM scope; no 100% claim is made for collapsed content, pagination, or unknown totals. A detected but uncaptured next page returns partial. Every article produces Markdown, safe HTML, a manifest, and a ZIP with relative image paths. Safe preview serves only service-generated HTML and disables scripts, forms, and external resources.

## SDK

```typescript
import { BrowserClient } from '@laofu/browser';
const browser = new BrowserClient(process.env.LAOFU_URL!, process.env.LAOFU_TOKEN!);
const task = await browser.submitTask({type:'article.capture@v1', execution:{profileId:process.env.LAOFU_PROFILE!}, input:{url:'https://example.com/article'}}, 'stored-key-001');
const result = await browser.wait(task.id);
if (result.state === 'succeeded' || result.state === 'partial') {
  const zip = result.artifacts.find(a => a.filename.endsWith('.zip'));
  if (zip) await browser.download(zip.id, './article.zip');
}
```

Python uses the same contract through `BrowserClient.submit_task`, `wait`, `upload`, `download`, `cancel`, and `resume`. `examples/consumer.*` are independent-install acceptance programs requiring a self-hosted test fixture; their unlock step is not a real sign-in feature.

MCP retains the 23 original tools and adds laofu_task, laofu_job, laofu_jobs, laofu_cancel, and laofu_resume. Pagination and local-file behavior share one adapter rather than a second browser-action implementation.

## dev.2 capacity, accounts, and lifecycle

- `POST /v1/admin/products` accepts `limits`; `PATCH /v1/admin/products/:id` updates that object. Fields: `artifactBytes` (default 2 GiB, range 1 KiB–10 GiB), `maxQueued` (default 20), and `maxResident` (default 24, including queued, running, waiting, and suspended; both count limits range 1–1000). The global 10 GiB limit also applies. Identical requests with the original key always return the original ID; new excess work returns `PRODUCT_QUEUE_FULL` / `PRODUCT_QUOTA_EXCEEDED`.
- Task `limits.maxTabs` defaults to 8, range 1–50. Tabs are counted before opening a capture page. Only pages created by that task are reclaimed after successful delivery; existing pages are not cleaned automatically.
- Owner `GET/PUT /v1/admin/profiles/:id/account-policy` manages `{mode:"anonymous"|"required", origins:["https://example.com"], selector?, attribute?, expectedHash?}`. Origins must be exact, with at least one for required mode. The fingerprint is SHA-256 of the configured element's specified attribute or trimmed textContent. Plain account values do not enter task results. Default anonymous means no account is required, not that the browser has no cookies. Changing rules stops unfinished profile tasks; saving identical rules does not.
- Required tasks verify the site before opening, loading, and extracting the target. Mismatched/unknown accounts wait for a human; delivery requires successful verification. Only controlled configuration is accepted, not caller-injected verification scripts. Restricted identities cannot bypass this with raw reads on a required profile.
- `GET /v1/admin/cooldowns` lists cooldowns; owner `POST /v1/admin/cooldowns/:id/release` explicitly releases one. Admission, execution, and resumption check them. New keys, other products sharing the egress, and service restarts cannot bypass them. The browser records actual HTTP 429 response headers; `error.details` includes `until`, `retryAfter`, or the cooldown ID. Without a trusted recovery time, until is null and explicit release is required. Old tasks are not replayed.
- `POST /v1/tasks/:id/handoffs` returns `ticket`, `ticketExpiresAt`, and sets a dedicated HttpOnly, SameSite=Strict browser cookie. Tickets last at most 60 seconds, are single-use, and bind the current identity/task/profile. Non-browser WebSockets use existing authentication plus `x-handoff-ticket`. Tickets never appear in URLs; POST again after disconnecting. A handoff ID alone is not a ticket.
- Artifacts retain `metadata.declaredMime`; unrecognized content uses `application/octet-stream`. Deletion/revocation aborts unfinished server-side downloads. Authorization is checked on each upload chunk and before publication. Task `artifacts` and `result.artifacts` retain deleted state; bytes already downloaded cannot be recalled.
- `/healthz` and `/v1/capabilities` expose software `version`, `apiVersion:v1`, and `build`; workers report the same build fields. Version output does not replace environment-specific passing evidence.

## Protocol additions from confirmed fixes on 2026-09-15

- `GET /v1/tasks` (including `includeCommands=1`) and `GET /v1/artifacts` accept `limit` (default 50, range 1–200) and `cursor`, returning `{items,truncated,nextCursor}`. Null nextCursor means the end. Follow cursors for older records instead of treating page one as complete. MCP `laofu_jobs` accepts the same parameters; the console provides older-task/artifact navigation.
- `browser.flow@v1` rejects flows containing `reload` before admission with `CAPABILITY_UNAVAILABLE`; use a separate maintenance command. After ask resumption or an explicit `until` condition, automatic control is restored before proceeding. Cancellation, timeout, or disablement stops subsequent steps. Flow `humanWaitSeconds` is a cumulative human budget and caps each ask timeout.
- Resume refuses quarantined/offline workers while preserving the waiting state. Uncertain resume-message errors suspend with `RESUME_UNKNOWN`; blind retransmission is forbidden. Cancellation flags, `cancel_requested` events, and queued-task terminal states are committed together; wall-clock timeout also records an event. Terminal states close active takeover connections.
- Interrupted act after some steps returns partial with `effectState=unknown`, quarantines the original controller, and retains receipts for verification. Explicit pre-execution rejection remains distinct from unknown in-flight outcomes. `fetch.pages` supplies structured `truncated/originalLength` at its text-output limit and partial command state if usable results exist. Error summaries exceeding 1,000 characters add `messageTruncated/originalMessageLength`; full content is retained.
- Screenshot image content stays compatible up to 256 KiB base64; larger images become controlled artifacts with download references. Extension receipts separately cap encoded output at 16 MiB; exceeding it yields `LIMIT_EXCEEDED`, requiring a smaller screenshot region. `full:true` is the original full-PNG parameter.
- CLI `call upload` first uploads the local file, then submits `inputArtifacts.path`; the same `--key` reuses the prepared artifact and original command. MCP connection errors during submission/wait return `EFFECT_UNKNOWN` and recovery data containing the original key, sessionId, and known commandId, directing callers to `laofu_jobs/laofu_job`. Definite pre-admission rejection keeps its original error.
- Rate-limit detection covers subresources and fetch commands. Top-level URL, command `args.url`, and all flow step URLs participate in shared-egress cooldown checks. Evidence persists and stops later automation; release never replays old work. HTTP JSON larger than 2 MiB returns 413 / `LIMIT_EXCEEDED`.

Article capture waits a bounded time for page loading and detects login walls/loading placeholders. Required sign-in remains waiting_user with `code:AUTH_REQUIRED`, not a terminal failure. Missing content after loading yields `ARTICLE_NOT_READY`. Lazy loading allows at most 32 scrolls within 9 seconds, without auto-expanding or following pagination. Suspected 1×1/2×2 placeholders are marked `SUSPECTED_PLACEHOLDER`, not successful images. srcset candidates are selected by size; embedded media record type, position, and undownloaded state individually.

Freezing binds metadata and DOM together. Each chunk's length and the final revision are checked; races yield partial and short chunks are rejected. `documentRevision` is SHA-256 of frozen source HTML, `contentHash` hashes delivered `article.html` bytes, and `markdownHash` hashes Markdown. `verification` explains hash/block coverage. Ordered blocks follow p/h1–h6/pre/table/img document order within HTML main. `textHash` hashes parsed element text with whitespace preserved under Cheerio text semantics; images also include relative paths. Table-cell pipes are escaped to avoid extra columns.

Article files are initially saved as `metadata.publication=staged`, hidden from lists and downloads. After all references validate, files and task succeeded/partial state publish in one database transaction. Upload or commit failure never exposes an incomplete package. Ordinary single-file uploads still publish independently. Users explicitly delete delivered artifacts; they do not expire automatically.

Consumer-facing source URLs redact credential paths, unknown query values, and fragments; original requests remain in controlled state. Original article sources and image retry URLs live separately in worker `source-metadata/<jobId>.json`, directory 0700/file 0600, default retention 7 days, excluded from ZIP. Manifest `sourceUrlRedacted/finalUrlRedacted` and image `sourceReference/sourceRedacted` explain the correspondence. Journals do not duplicate binary bodies. Ordinary receipt bodies last 7 days; expiration clears payloads but permanently retains command digests, states, and idempotency records. Legacy journal retention begins on first execution of the new version; expired results cannot be replayed. Startup and minute-based cleanup remove expired metadata, terminal staged packages, and component-owned temporary leftovers older than 24 hours. Unknown tasks are not automatically recovered.
