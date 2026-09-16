# Attribution and Licenses

[简体中文](NOTICE.md) | **English**

Original laofu-browser code uses the [MIT license](LICENSE). Copyright (c) 2026 Fuyera and laofu-browser contributors.

`vendor/huashu-chrome-1.2.0/` is the original 1.2.0 snapshot of [huashu-chrome](https://github.com/alchaincyf/huashu-chrome) by 花叔 (alchaincyf). It is MIT-licensed; its original `Copyright (c) 2026 花叔 (alchaincyf)` notice and complete license remain in `vendor/huashu-chrome-1.2.0/LICENSE`. The root license does not replace upstream attribution.

The original snapshot remains unchanged. `scripts/build-engine.mjs` and `scripts/download-handler.txt` generate adapted patches in `runtime/engine/`. Changes cover instance pairing, output adaptation, downloads, and error handling; additions include the service, permission isolation, persistent tasks, article artifacts, console, HTTP/SDK/MCP/CLI, and installation verification. See [compatibility differences](docs/COMPATIBILITY.en.md).

Node.js, Chromium, Playwright, SQLite, React, Fastify, and other dependencies retain their respective licenses. Fixed versions and integrity sources are recorded in `package-lock.json`, the upstream baseline, and each release's `RELEASE.json`. Preserve bundled copyright and license files when distributing.

MIT applies to this project's software; it does not change rights to visited websites, account data, or captured content.
