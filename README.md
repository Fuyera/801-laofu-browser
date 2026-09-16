# 老傅 Browser（laofu-browser）

老傅 Browser 是连接 AI 助手与浏览器的**本地浏览器助手**。它让 AI 在你的授权下阅读网页、操作页面、执行浏览器任务，并在需要登录、验证或确认时由你接手。支持 MCP、HTTP API、SDK 和 CLI 接入，提供任务记录、执行状态和结果管理。

程序由本机服务、浏览器扩展和网页控制台组成，可使用独立的 Chromium，也可连接你已登录的 Chrome。你还可以直接在控制台提交文章链接，将当前可见正文和图片保存为 Markdown、HTML 与 ZIP，查看任务进度，并在需要登录或验证时人工接手。

当前版本为 **`0.1.0-dev.3` 预览版**，面向 **macOS Apple Silicon（arm64）**。源码采用 MIT 许可证；安装包和最终验收记录见 [GitHub Releases](https://github.com/Fuyera/801-laofu-browser/releases)。也可按下方步骤从源码运行。Windows、Linux 桌面和服务器部署暂未验收。

项目仓库：[https://github.com/Fuyera/801-laofu-browser](https://github.com/Fuyera/801-laofu-browser)

## 可以做什么

- 读取网页正文、快照和页面元素，执行导航、点击、输入、滚动、截图等 23 种浏览器工具。
- 将当前可见文章保存为 Markdown、安全阅读 HTML、图片与 ZIP，并报告缺图、嵌入媒体和内容范围。
- 持久保存任务、命令和产物；需要登录或人工处理时暂停，结果不确定的写操作不会自动重放。
- 通过本地控制台、HTTP API、TypeScript／Python SDK、MCP 或 CLI 使用同一服务。
- 为应用配置独立身份、权限和浏览器；受限身份的容器隔离需单独完成运行环境验证。

浏览器登录态保留在自己的执行环境。专用 Chromium 与连接已有 Chrome 是两条独立入口。

## 安装预览包

在 [下载页](https://github.com/Fuyera/801-laofu-browser/releases)选择 macOS arm64 压缩包，同时下载对应 `.sha256` 文件。包内包含 Node、Chromium 和依赖，不需要先安装开发工具。校验、安装与启动命令见[运行手册](docs/OPERATIONS.md#固定mac制品)。这是开发者预览包，尚未做 Apple 签名或公证，也未上架 Chrome 商店。

## 从源码开始

需要 macOS arm64、Git 和 **Node.js 22**（验证版本为 22.23.2）。Python 3.10+ 仅用于 Python SDK；Docker Desktop 仅用于隔离浏览器部署。原生依赖若需要本地编译，还需安装 Xcode Command Line Tools。

```sh
git clone https://github.com/Fuyera/801-laofu-browser.git
cd 801-laofu-browser
npm ci --no-audit --no-fund
node node_modules/playwright/cli.js install chromium
npm run build
node scripts/local.mjs start --home workspace/local-state --browser
bin/laofu-browser console-login --home workspace/local-state
```

打开最后一条命令输出的一次性控制台地址，在“浏览器与设备”确认专用浏览器已就绪，然后创建任务。默认服务仅监听本机 `127.0.0.1:17889`，需要鉴权。登录地址含临时票据，不要公开或转发。

查看状态与停止：

```sh
node scripts/local.mjs status --home workspace/local-state
node scripts/local.mjs stop --home workspace/local-state
```

停止服务会保留任务、产物和浏览器状态。源码仓库不包含 Node、浏览器、依赖、凭据或发行包；上述构建与浏览器安装不能省略。

需要使用已登录的日常 Chrome 时，按[连接已有 Chrome](docs/OPERATIONS.md#本人日常chrome)的步骤配对并加载扩展。该入口具有本人浏览器的完整权限，应只用于本人授权的操作。

## 接入 AI 工具与应用

- **MCP**：`bin/laofu-browser mcp-config --profile prf_实际ID --home workspace/local-state` 生成宿主配置；完整接入步骤见[接口文档](docs/API.md)。
- **HTTP API**：通过 `/v1/capabilities` 查询浏览器与能力；[OpenAPI](docs/openapi.json)列出接口。
- **CLI**：`bin/laofu-browser help` 查看命令；[用户指南](docs/USER_GUIDE.md)包含采集、查询、下载和人工接手示例。
- **SDK**：源码在 `sdk/typescript/` 与 `sdk/python/`。本地构建接入包的方法见[研发指南](docs/DEVELOPMENT.md#接入包安装候选与-docker)，示例在 `examples/`；`releases/` 中的本地产物不随 Git 克隆提供。

## 已验证范围与限制

- macOS arm64 的服务、隔离浏览器、安装候选及 SDK 有真实测试记录，详见[测试报告](docs/TEST_REPORT.md)。测试环境、代码和安装包的版本应分别核对。
- X 的公开主页、单帖、搜索和滚动读取已经实测可用。**列表读取可能漏掉屏幕外帖子，不保证全量无遗漏**；完整性要求较高时应取得帖子链接后逐帖核对。该问题暂缓处理，见[X 验收记录](docs/X_READ_ACCEPTANCE.md)。
- 网站的登录、验证码和限流可能需要本人处理。图文采集范围为当前授权可见内容，不保证折叠、付费、分页或音视频全部归档。
- 版本对应的安装与日常 Chrome 验收结果随 Release 提供；当前不承诺 Windows、Linux 桌面或服务器可直接安装使用。

## 文档与反馈

- [用户指南](docs/USER_GUIDE.md)：采集、成果下载、人工接手和常见问题。
- [研发指南](docs/DEVELOPMENT.md)：源码构建、架构、SDK 打包和回归。
- [接口文档](docs/API.md)：HTTP、SDK、MCP 与 CLI。
- [运行手册](docs/OPERATIONS.md)：安装、备份、恢复及隔离部署。
- [验收状态](docs/ACCEPTANCE.md)：已通过项与剩余范围。

反馈问题时附上版本、系统、复现步骤和脱敏错误信息。不要提交 Cookie、登录票据、API 密钥、浏览器 profile 或完整个人状态目录。历史测试报告的公开副本已按[证据说明](docs/evidence/README.md)处理本机路径；运行日志和原始账号数据不在仓库中。

## 许可证、上游致谢与修改范围

本项目自有代码采用 [MIT 许可证](LICENSE)，Copyright (c) 2026 Fuyera and laofu-browser contributors。第三方组件继续遵循各自许可证，详见 [NOTICE](NOTICE.md)。

感谢 **花叔（alchaincyf）** 的 **huashu-chrome**。上游仓库：[https://github.com/alchaincyf/huashu-chrome](https://github.com/alchaincyf/huashu-chrome)。本项目基于其 **1.2.0** 浏览器工具、Chrome 扩展与桥接能力开发；保留原始快照、完整 [MIT 许可证](vendor/huashu-chrome-1.2.0/LICENSE)及署名 **Copyright (c) 2026 花叔 (alchaincyf)**。

本项目的修改与新增范围：

- 替换产品名称、图标和对外文案；保留必要的上游版权、来源及兼容标识。
- 通过生成脚本适配扩展与桥接，包括实例配对、输出状态、下载处理和异常恢复；`vendor/` 原始快照保持不变。
- 新增独立 HTTP 服务、持久任务、权限与身份隔离、图文产物、人工接手和网页控制台。
- 新增 TypeScript／Python SDK、CLI／MCP 服务接入，以及安装、诊断、回归和交付验证。

逐项行为差异见[兼容说明](docs/COMPATIBILITY.md)。
