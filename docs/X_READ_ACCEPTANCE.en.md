# X live reading acceptance

[简体中文](X_READ_ACCEPTANCE.md) | **English**

2026-09-15, 22:55–23:04 UTC. **Basic reading worked in actual tests; exhaustive list reading failed due to omitted offscreen posts.** This run called laofu-browser API and its paired extension directly in signed-in daily Chrome, using a new isolated test tab. No other browser tool performed the reads.

Subsequent user decision: defer the X list issue and accept current basic reading. X-READ-01 remains a known limitation, not a public-preview blocker. That decision does not change the failed completeness result or itself establish repository/artifact publication.

## Environment and results

Actual service: `0.1.0-dev.2`, built `2026-09-15T08:58:26.708Z`, commit `592b5c97530c3c716909fb3cda66bf6f5dceece7`, `dirty=true`. **This daily environment had not been upgraded to the latest 28 adversarial fixes.** These conclusions are not latest-candidate acceptance.

|Scenario|Observation|Assessment|
|---|---|---|
|Public profile `x.com/OpenAI`|Post text readable; DOM supplied author/time/permalink/image count. Scrolling revealed 12 previously unseen post IDs and text reads returned normally|Basic reading passed, not exhaustive history|
|Post `2097786616311840853`|Collapsed profile text was 276 characters; expanded detail text 428, matching read_text with no Show more|Main post passed; replies not fully expanded|
|Search `from:OpenAI`, Latest|All initial 6 post texts matched read_text|Basic search reading passed|
|Reading after search scroll|5 new IDs immediately after scroll; later DOM had 12 posts but output contained 11|Continuation works, completeness fails|
|Detail of omitted post `2097374646148481532`|Expanded 299-character visible text matched completely|Individual fallback read passed|
|Snapshot/scroll receipts|1 snapshot and 2 scrolls returned partial, truncated=true, effectState=confirmed; subsequent DOM proved scroll happened|Truncation preserved correctly; not complete snapshots|

Character counts use JavaScript string length. Matching ignores layout whitespace/zero-width characters and excludes link-helper text marked aria-hidden. Async loading/virtualization changes post counts; different stages do not imply fixed page sizes.

## X-READ-01: unmarked omissions in list output

Reproduced on that installed environment: public post `https://x.com/OpenAI/status/2097374646148481532` was in the search DOM but offscreen. Two text reads and one Markdown read omitted it, each returning succeeded, truncated=false, and **11/12** matches.

Within the same diagnostic eval, reading that post's DOM and cloning the main container using current mainText selection/cleanup still retained the post. Therefore, unloaded content or ARIA-hidden helper text alone cannot explain this omission. The API/DOM discrepancy is confirmed; whether its exact cause is extension context, output path, or page changes remains unresolved, and latest fixes were not retested. Successful detail reading does not eliminate list omissions.

Two detail checks also omitted respectively 2 and 1 offscreen replies from generic text output, while main posts matched fully. These related observations are retained without claiming a common proven cause.

A workable current approach is to obtain permalinks and read details individually. Batch capture still needs ID deduplication, detail fallback, and coverage checks. This run did not implement or accept an automated exhaustive pipeline.

## Evidence and scope

- [Redacted summary and receipt hashes](evidence/x-read/summary.json): 30 commands, 27 succeeded and 3 partial. This is status counting, not 30 passing test cases.
- Raw receipts/scripts remain in ignored `workspace/x-read-live/`; receipts use 0600 and may contain sidebar data, so are excluded from Git. Public summaries retain only statuses, public post links, counts, and hashes.
- The initial script treated all partial results as failures. It was corrected to preserve truncation and continue read-only verification; confirmed scrolling was not replayed to hide the record.
- Only public content was read: no posts, replies, likes, follows, or DMs. No login/CAPTCHA requiring intervention appeared; this does not predict risk controls on other networks.
- The created tab and test session were removed; daily Chrome, original tabs, and sign-in state remained.
- Not tested: signed-out mode, Japan VPS, all history/replies, image/video downloads, or capture article-package export. No extension upgrade, push, or release in this run. P4 lifecycle/freeze remains tracked by current context.
