# 老傅 Browser（laofu-browser）

**简体中文** | [English](README.en.md)

老傅 Browser 是连接 AI 助手与浏览器的**本地浏览器助手**。它让 AI 在你的授权下阅读网页、操作页面、执行浏览器任务，并在需要登录、验证或确认时由你接手。支持 MCP、HTTP API、SDK 和 CLI 接入，提供任务记录、执行状态和结果管理。

程序由本机服务、浏览器扩展和网页控制台组成，可使用独立的 Chromium，也可连接你已登录的 Chrome。你还可以直接在控制台提交文章链接，将当前可见正文和图片保存为 Markdown、HTML 与 ZIP，查看任务进度，并在需要登录或验证时人工接手。

当前版本为 **`0.1.0-dev.3` 预览版**，面向 **macOS Apple Silicon（arm64）**。源码采用 MIT 许可证；安装包和最终验收记录见 [GitHub Releases](https://github.com/Fuyera/801-laofu-browser/releases)。也可按下方步骤从源码运行。Windows、Linux 桌面和服务器部署暂未验收。

项目仓库：[https://github.com/Fuyera/801-laofu-browser](https://github.com/Fuyera/801-laofu-browser)

## 功能介绍

### 任务与管理

|功能|你可以做什么|
|---|---|
|网页控制台 UI|在一个界面里管理浏览器与设备、任务、图文产物、产品凭据、诊断与经验；查看进度、预览结果、下载文件、取消或继续任务。|
|持久任务与多步执行|将操作保存为可查询的任务，组合多步浏览器流程；关闭控制台或客户端断线后仍可按 ID 找回状态，区分完成、部分完成、等待人工与效果未知。|
|图文交付与文件管理|提交文章链接，准备懒加载正文和图片，生成 Markdown、安全 HTML、原图、ZIP 与带哈希的清单；明确列出缺图、截断和未下载媒体，支持上传、下载、预览与删除。|
|应用接入|通过独立 HTTP 服务、OpenAPI、TypeScript／Python SDK、MCP 或 CLI 接入同一任务和结果系统，便于 AI 助手与应用调用。|
|身份、权限与隔离|为不同应用分配凭据、工具权限、配额和浏览器访问范围；区分本人浏览器与受限产品，支持独立执行端、容器／网络隔离和站点账号核验。隔离效果以已验收环境为限。|
|人工接手与继续|需要登录、验证或手动操作时暂停任务，由本人接手后继续或取消；隔离浏览器支持控制台远程接手、短时单次票据和断线重连。|
|恢复与结果确认|记录已执行步骤和操作效果，确认超时与取消结果；效果未知时挂起等待核验，不自动重放写操作。提供站点冷却和过期临时文件清理。|
|站点经验管理|在控制台读取、编辑站点经验，按产品控制访问，保留版本和历史，检查并发修改冲突并支持恢复。|
|安装与运行管理|提供固定 Mac 安装包、完整性校验、运行诊断、状态备份、升级及程序回退。|

### 浏览器操作

23 种工具覆盖从读取页面到完成交互的日常工作：

|能力|工具与用途|
|---|---|
|页面与标签页|`navigate` 导航、前进后退或刷新；`tabs` 管理标签页；`status` 查看浏览器状态。|
|阅读与定位|`snapshot` 获取带元素引用的页面快照；`read_text` 读取正文；`query` 查询页面结构；`screenshot` 截图。|
|点击与表单|`click` 点击；`type` 输入；`select` 选择选项；`fill` 填写表单；`key` 发送按键。|
|滚动与等待|`scroll` 滚动页面；`wait` 等待页面条件。|
|网络与文件|`network` 查看捕获的网络请求；`fetch` 在浏览器上下文请求数据；`download` 下载；`upload` 上传。|
|组合操作|`act` 批量执行步骤；`eval` 执行页面表达式；`ask` 请求人工操作。|
|经验与扩展维护|`learnings` 读取或保存站点笔记；`reload` 在更新后重载扩展。|

按任务选择信息来源：结构化数据可先看网络响应，页面交互使用快照和元素引用，需要视觉核对时再截图。浏览器级真实输入用于需要真实事件的控件；每次操作应结合页面变化与返回状态核对结果。不同身份可用的工具受权限限制。

浏览器登录态保留在自己的执行环境。可以使用专用 Chromium，也可以连接已有 Chrome；通过 MCP 交给 AI 助手操作、通过 API／SDK／CLI 接入应用，或在网页控制台直接管理任务。

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
- dev.3 的最终安装包、两套 SDK 和日常 Chrome 停止／重连已验收，结果随 Release 提供；当前不承诺 Windows、Linux 桌面或服务器可直接安装使用。

## 文档与反馈

全套项目自有 Markdown 文档均提供中文和英文版，页首可切换语言；英文指南之间使用英文链接。源码版网页控制台也支持中英文切换并记住选择；首次按浏览器首选语言显示。已发布 dev.3 安装包为此前固定快照，尚未包含此次 UI 更新。

- [用户指南](docs/USER_GUIDE.md)：采集、成果下载、人工接手和常见问题。
- [研发指南](docs/DEVELOPMENT.md)：源码构建、架构、SDK 打包和回归。
- [接口文档](docs/API.md)：HTTP、SDK、MCP 与 CLI。
- [运行手册](docs/OPERATIONS.md)：安装、备份、恢复及隔离部署。
- [验收状态](docs/ACCEPTANCE.md)：已通过项与剩余范围。
- [设计说明](docs/DESIGN.md)与[实施计划](docs/IMPLEMENTATION_PLAN.md)：需求、决策及暂停范围。
- [测试报告](docs/TEST_REPORT.md)、[X 验收](docs/X_READ_ACCEPTANCE.md)与[兼容说明](docs/COMPATIBILITY.md)：证据与限制。
- [原始对抗报告](docs/ADVERSARIAL_TEST.md)、[逐项复核](docs/ADVERSARIAL_REVIEW.md)与[已确认缺陷修复](docs/ADVERSARIAL_FIXES.md)：问题、裁定和修复结果。
- [项目卡](docs/PROJECT_CARD.md)、[当前状态](CURRENT_CONTEXT.md)、[协作规则](AGENTS.md)与[来源许可](NOTICE.md)：项目范围及维护信息。

反馈问题时附上版本、系统、复现步骤和脱敏错误信息。不要提交 Cookie、登录票据、API 密钥、浏览器 profile 或完整个人状态目录。历史测试报告的公开副本已按[证据说明](docs/evidence/README.md)处理本机路径；运行日志和原始账号数据不在仓库中。

## 许可证、上游致谢与修改范围

本项目自有代码采用 [MIT 许可证](LICENSE)，Copyright (c) 2026 Fuyera and laofu-browser contributors。第三方组件继续遵循各自许可证，详见 [NOTICE](NOTICE.md)。

感谢 **花叔（alchaincyf）** 的 **huashu-chrome**。上游仓库：[https://github.com/alchaincyf/huashu-chrome](https://github.com/alchaincyf/huashu-chrome)。本项目基于其 **1.2.0** 浏览器工具、Chrome 扩展与桥接能力开发；保留原始快照、完整 [MIT 许可证](vendor/huashu-chrome-1.2.0/LICENSE)及署名 **Copyright (c) 2026 花叔 (alchaincyf)**。

本项目的新增与扩展范围包括：独立网页控制台、HTTP 服务与 SDK、持久任务和多步执行、产品权限与执行隔离、图文交付与产物管理、人工接手流程、恢复与结果确认、站点经验版本管理，以及安装、备份和回归验证。对照基线为 huashu-chrome 1.2.0；原始 `vendor/` 快照保持不变，扩展与桥接适配由生成脚本输出到 `runtime/`。详细行为差异见[兼容说明](docs/COMPATIBILITY.md)。
