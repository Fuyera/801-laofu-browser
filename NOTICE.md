# 来源与许可证

**简体中文** | [English](NOTICE.en.md)

laofu-browser 的自有代码采用 [MIT 许可证](LICENSE)。Copyright (c) 2026 Fuyera and laofu-browser contributors。

`vendor/huashu-chrome-1.2.0/` 是花叔（alchaincyf）的 [huashu-chrome](https://github.com/alchaincyf/huashu-chrome) 1.2.0 原始快照。该部分采用 MIT，保留原版权声明 `Copyright (c) 2026 花叔 (alchaincyf)` 和完整许可证：`vendor/huashu-chrome-1.2.0/LICENSE`。项目根许可证不替换上游署名。

原始快照保持不变；`runtime/engine/` 由 `scripts/build-engine.mjs` 和 `scripts/download-handler.txt` 生成适配补丁。修改范围包括实例配对与输出适配、下载和异常处理；新增服务、权限隔离、持久任务、图文产物、控制台、HTTP／SDK／MCP／CLI 及安装验证。具体兼容差异见 [兼容说明](docs/COMPATIBILITY.md)。

Node.js、Chromium、Playwright、SQLite、React、Fastify 及其他依赖分别适用其自带许可证。固定版本和完整性来源记录于 `package-lock.json`、上游基线及发行包的 `RELEASE.json`；分发时保留随包版权和许可证。

MIT 授权范围是本项目软件，不改变所访问网站、用户账号数据或采集内容本身的权利归属。
