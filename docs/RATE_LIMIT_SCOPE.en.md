# Rate-limit attribution

[简体中文](RATE_LIMIT_SCOPE.md) | **English**

Service-launched Chromium binds requests to the execution generation, exact Page, job ID and fence at request start. Child frames belong to their Page. Only a 429 attributed to a bound page stops the active job; related cross-origin resources retain rate-limit protection. Delayed requests cannot affect a new job or a generation after human handoff.

An internal controller-authorized tab_target query maps the Chrome tabId to a CDP target ID, which is matched exactly against Playwright Pages. No URL, title or page-order inference is used. Target IDs are read and cached at page creation without DOM mutation.

Explicit-tab commands bind before dispatch. tabs.new returns its tabId, allowing initial navigation responses for that verified new Page to be attributed after its receipt. Binding an existing Page never retrospectively adopts its earlier background traffic. Pending samples are capped at 128 and cleared on generation changes.

Article capture creates and binds a blank page before navigating. Legacy session commands without an explicit tabId do not guess their target; callers should pass tabId explicitly. Service Worker traffic without a resolvable Page is diagnostic only. Attach mode has no Playwright Context observer and continues to rely on existing tool errors and page-state checks; equivalent network coverage is not claimed.

This is not the network authorization layer. Proxy/private-network protections, cooldowns, human handoff and the prohibition on replaying unknown writes remain unchanged. Release acceptance must exercise extension target mapping, L2 actions, initial navigation and multi-tab timing in a supported real Chrome environment. Node test doubles do not replace those checks.
