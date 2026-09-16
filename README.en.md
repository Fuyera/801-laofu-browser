# Laofu Browser (老傅 Browser)

[简体中文](README.md) | **English**

Laofu Browser is a **local browser assistant connecting AI assistants to your browser**. With your authorization, it lets AI read web pages, interact with pages, and run browser tasks, while handing control back to you for sign-in, verification, or confirmation. MCP, HTTP API, SDK, and CLI integrations share task records, execution status, and results.

It consists of a local service, a browser extension, and a web console. Use a dedicated Chromium browser or connect your existing signed-in Chrome. The console also lets you submit an article URL, save currently accessible text and images as Markdown, HTML, and ZIP, follow task progress, and take over when needed.

The current release is **`0.1.0-dev.3`, a preview for macOS Apple Silicon (arm64)**. The project's own code is MIT-licensed. Installation packages and acceptance records are available on [GitHub Releases](https://github.com/Fuyera/801-laofu-browser/releases). You can also build from source below. Windows, Linux desktop, and server deployment have not completed acceptance testing.

Repository: [https://github.com/Fuyera/801-laofu-browser](https://github.com/Fuyera/801-laofu-browser)

## Features

### Tasks and management

|Feature|What you can do|
|---|---|
|Web console UI|Manage browsers and devices, tasks, article artifacts, product credentials, and diagnostics/site notes in one interface. Track progress, preview results, download files, cancel tasks, or resume them.|
|Persistent tasks and multi-step execution|Save operations as queryable tasks and combine browser steps into workflows. Find status by ID after closing the console or disconnecting a client, with distinct completed, partial, waiting, and unknown-outcome states.|
|Article delivery and file management|Submit an article URL, prepare lazy-loaded text/images, and generate Markdown, safe HTML, original images, ZIP, and hashed manifests. Missing images, truncation, and unsupported media are explicit; files support upload, download, preview, and deletion.|
|Application integrations|Use an independent HTTP service, OpenAPI, TypeScript/Python SDKs, MCP, or CLI to access the same tasks and results from AI assistants and applications.|
|Identity, permissions, and isolation|Assign application credentials, tool permissions, quotas, and browser access scopes. Separate owner browsers from restricted products, with independent workers, container/network isolation, and site/account checks. Isolation claims are limited to tested environments.|
|Human takeover and resumption|Pause for sign-in, verification, or manual action, then resume or cancel. Isolated browsers support remote takeover from the console, short-lived single-use tickets, and reconnection.|
|Recovery and outcome tracking|Record executed steps and effects; confirm timeout and cancellation outcomes. Suspend unknown outcomes for verification instead of replaying writes. Site cooldowns and expired temporary-file cleanup are included.|
|Site-note management|Read and edit site notes in the console, control access by product, retain versions and history, detect concurrent-edit conflicts, and restore earlier content.|
|Installation and operations|Use fixed Mac packages, integrity checks, runtime diagnostics, state backups, upgrades, and program rollback.|

### Browser operations

The 23 tools cover everyday work from reading pages to completing interactions:

|Capability|Tools and uses|
|---|---|
|Pages and tabs|`navigate` opens URLs, moves back/forward, or reloads; `tabs` manages tabs; `status` reports browser status.|
|Reading and locating|`snapshot` returns page snapshots with element references; `read_text` reads content; `query` inspects page structure; `screenshot` captures images.|
|Clicks and forms|`click` clicks; `type` enters text; `select` chooses options; `fill` fills forms; `key` sends keystrokes.|
|Scrolling and waiting|`scroll` scrolls pages; `wait` waits for page conditions.|
|Network and files|`network` inspects captured requests; `fetch` requests data in the browser context; `download` downloads files; `upload` uploads them.|
|Combined actions|`act` runs batches of steps; `eval` evaluates page expressions; `ask` requests human action.|
|Notes and extension maintenance|`learnings` reads or saves site notes; `reload` reloads the extension after an update.|

Choose the information source to fit the task: inspect network responses for structured data, use snapshots and element references for interactions, and take screenshots when visual checks are needed. Browser-level input supports controls that require trusted events. Check page changes and returned status to verify outcomes. Tool availability depends on the calling identity's permissions.

Browser sign-in state stays in its execution environment. Use dedicated Chromium or connect existing Chrome; let an AI assistant operate it through MCP, integrate an application through API/SDK/CLI, or manage tasks directly in the web console.

## Install the preview package

On the [download page](https://github.com/Fuyera/801-laofu-browser/releases), choose the macOS arm64 archive and its matching `.sha256` file. The package includes Node, Chromium, and dependencies; development tools are not required for package installation. Verification, installation, and startup commands are in the [operations guide](docs/OPERATIONS.en.md#fixed-mac-artifacts). This developer preview is not Apple-signed or notarized and is not listed in the Chrome Web Store.

## Build from source

You need macOS arm64, Git, and **Node.js 22** (tested with 22.23.2). Python 3.10+ is needed only for the Python SDK; Docker Desktop is needed only for isolated browser deployment. Native dependencies may require Xcode Command Line Tools if compiled locally.

```sh
git clone https://github.com/Fuyera/801-laofu-browser.git
cd 801-laofu-browser
npm ci --no-audit --no-fund
node node_modules/playwright/cli.js install chromium
npm run build
node scripts/local.mjs start --home workspace/local-state --browser
bin/laofu-browser console-login --home workspace/local-state
```

Open the one-time console URL printed by the last command. In “浏览器与设备” (Browsers and devices), confirm that the dedicated browser is ready, then create a task. By default, the service listens only on `127.0.0.1:17889` and requires authentication. The login URL contains a temporary ticket; do not share it.

Check status or stop the service:

```sh
node scripts/local.mjs status --home workspace/local-state
node scripts/local.mjs stop --home workspace/local-state
```

Stopping preserves tasks, artifacts, and browser state. A Git clone does not include Node, browsers, dependencies, credentials, or release packages; the build and browser installation steps above are required.

To use your signed-in Chrome, follow [Connect existing Chrome](docs/OPERATIONS.en.md#personal-daily-chrome) to pair and load its extension. This connection has your browser's full permissions and is intended only for your authorized operations.

## Connect AI tools and applications

- **MCP:** `bin/laofu-browser mcp-config --profile prf_YOUR_PROFILE_ID --home workspace/local-state` generates host configuration. See the [API guide](docs/API.en.md).
- **HTTP API:** query `/v1/capabilities` for available browsers and capabilities. The [OpenAPI specification](docs/openapi.json) lists the endpoints.
- **CLI:** run `bin/laofu-browser help`. The [user guide](docs/USER_GUIDE.en.md) covers capture, status queries, downloads, and human takeover.
- **SDKs:** source is in `sdk/typescript/` and `sdk/python/`. See the [development guide](docs/DEVELOPMENT.en.md#sdk-packages-installation-candidates-and-docker) for package builds and `examples/` for consumers. Locally generated files in `releases/` are not included in a Git clone.

## Verified scope and limitations

- The macOS arm64 service, isolated browser execution, installation candidates, and SDKs have real execution records. See the [test report](docs/TEST_REPORT.en.md); check the code, package, and environment versions separately.
- Reading public X profiles, individual posts, search results, and scrolled pages has been tested. **List extraction can omit offscreen posts and is not guaranteed to be exhaustive.** For completeness-sensitive work, collect post links and verify individual detail pages. The list issue is deferred; see [X acceptance](docs/X_READ_ACCEPTANCE.en.md).
- Website sign-in, CAPTCHAs, and rate limits may require your intervention. Article capture covers currently authorized, accessible content; it does not guarantee archives of collapsed, paid, paginated, audio, or video content.
- The final dev.3 package, both SDKs, and daily Chrome stop/reconnect lifecycle passed acceptance. Results accompany the Release. Windows, Linux desktop, and server installation are not currently promised.
- The source-build console and complete project documentation support Chinese and English. The existing fixed dev.3 download predates this UI update.

## Documentation and feedback

All project-owned Markdown documents have Chinese and English editions. Use the language links at the top of each page. English guides link to other English guides. The source-build console offers a language switch, remembers your choice, and initially follows your preferred browser language.

- [User guide](docs/USER_GUIDE.en.md): capture, downloads, human takeover, and troubleshooting.
- [Development guide](docs/DEVELOPMENT.en.md): source builds, architecture, SDK packaging, and regression tests.
- [API guide](docs/API.en.md): HTTP, SDK, MCP, and CLI.
- [Operations guide](docs/OPERATIONS.en.md): installation, backup, recovery, and isolation.
- [Acceptance status](docs/ACCEPTANCE.en.md): verified scope and remaining limitations.
- [Design requirements](docs/DESIGN.en.md) and [implementation plan](docs/IMPLEMENTATION_PLAN.en.md): requirements, decisions, and paused scope.
- [Test report](docs/TEST_REPORT.en.md), [X acceptance](docs/X_READ_ACCEPTANCE.en.md), and [compatibility](docs/COMPATIBILITY.en.md): evidence and limits.
- [Original adversarial report](docs/ADVERSARIAL_TEST.en.md), [item-by-item review](docs/ADVERSARIAL_REVIEW.en.md), and [confirmed fixes](docs/ADVERSARIAL_FIXES.en.md): findings, adjudication, and resolution.
- [Project card](docs/PROJECT_CARD.en.md), [current context](CURRENT_CONTEXT.en.md), [collaboration rules](AGENTS.en.md), and [attribution](NOTICE.en.md): project scope and maintenance information.

When reporting an issue, include the version, OS, reproduction steps, and redacted error details. Do not submit cookies, login tickets, API keys, browser profiles, or complete personal state directories. Public copies of historical test reports redact local paths as explained in the [evidence notes](docs/evidence/README.en.md). Runtime logs and raw account data are excluded from the repository.

## License, upstream credit, and scope of changes

The project's own code is licensed under [MIT](LICENSE), Copyright (c) 2026 Fuyera and laofu-browser contributors. Third-party components retain their respective licenses; see [NOTICE](NOTICE.en.md).

Thanks to **花叔 / Huashu (alchaincyf)** for **huashu-chrome**. Upstream repository: [https://github.com/alchaincyf/huashu-chrome](https://github.com/alchaincyf/huashu-chrome). This project builds on its **1.2.0** browser tools, Chrome extension, and bridge. The original snapshot, full [MIT license](vendor/huashu-chrome-1.2.0/LICENSE), and attribution **Copyright (c) 2026 花叔 (alchaincyf)** are preserved.

Additions and extensions include the independent web console, HTTP service and SDKs, persistent tasks and multi-step execution, product permissions and execution isolation, article delivery and artifact management, human takeover workflows, recovery and outcome tracking, versioned site notes, and installation, backup, and regression verification. The comparison baseline is huashu-chrome 1.2.0. The original `vendor/` snapshot remains unchanged; build scripts generate extension and bridge adaptations in `runtime/`. See [compatibility differences](docs/COMPATIBILITY.en.md) for details.
