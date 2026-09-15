# laofu-browser

老傅的独立浏览器能力服务。当前为 `0.1.0-dev.2` 内部开发版；真实通过项与尚未完成的 P4/P5 门槛见 [验收报告](docs/ACCEPTANCE.md)，不能据此宣布跨系统 v1.0。

提供 huashu-chrome 1.2.0 的23个原始工具，以及图文采集、持久任务、文件产物、独立凭据、人工接手。服务代码均在本工程；没有改造 Fuyera、祈道或000。

私有仓库：[Fuyera/801-laofu-browser](https://github.com/Fuyera/801-laofu-browser)，主分支 `main`。

## 文档入口

- [用户指南](docs/USER_GUIDE.md)：登录、采集、下载、人工接手、状态判断与日常问题。
- [研发指南](docs/DEVELOPMENT.md)：源码环境、架构、测试矩阵、样本准备与证据收口。
- [接口文档](docs/API.md)：HTTP、TS/Python SDK、MCP 和 CLI 契约。
- [运行手册](docs/OPERATIONS.md)：固定包安装、升级回退、隔离部署与故障恢复。
- [验收报告](docs/ACCEPTANCE.md)：实际通过项、环境边界与 P0–P5 缺项。
- [完整本机测试报告](docs/TEST_REPORT.md)：当前检查矩阵的结果、修正和证据。

干净克隆不含运行时、依赖、浏览器和发行包；首次使用源码请先按研发指南安装依赖并构建。

## 当前 Mac 源码运行

在本工程运行，包装命令会使用固定 Node 22.23.2：

```sh
bin/laofu-browser init
bin/laofu-browser serve
```

另一个终端配对本人专用浏览器：

```sh
bin/laofu-browser pair --name 本人专用浏览器
bin/laofu-browser worker --config /上一步返回的/worker-配置.json
bin/laofu-browser console-login
```

最后一个命令输出10分钟有效的一次性控制台地址。本机服务默认 `http://127.0.0.1:17889`；页面和API均需鉴权。不要把输出中的登录票据转给产品调用方。

也可使用本机管理器一次启动服务和专用浏览器：

```sh
.runtime/node-v22.23.2-darwin-arm64/bin/node scripts/local.mjs start --browser
.runtime/node-v22.23.2-darwin-arm64/bin/node scripts/local.mjs status
.runtime/node-v22.23.2-darwin-arm64/bin/node scripts/local.mjs stop
```

本人日常 Chrome 使用 `pair --attach` 后启动执行端，在该 Chrome 的 `chrome://extensions` 开启开发者模式，加载执行端显示的独立扩展目录。等待期间显示浏览器离线；配对成功后自动变为可用。每份扩展只连接自己指定的桥和 profile；不读取或复制已有 Chrome 的 Cookie/密码，不把日常 Chrome 授予产品身份。此人工加载流程需要本机实操确认，详见验收报告。

## 接口和接入包

- [HTTP 契约与示例](docs/API.md)、[OpenAPI](docs/openapi.json)。能力发现：`GET /v1/capabilities`。
- TypeScript：安装 `releases/laofu-browser-0.1.0-dev.2.tgz`；示例 `examples/consumer.mjs`。
- Python：安装 `releases/laofu_browser-0.1.0.dev2-py3-none-any.whl`；示例 `examples/consumer.py`。
- MCP：`bin/laofu-browser mcp-config --profile <profileId>` 生成不含凭据的宿主配置；MCP 服务为 `bin/laofu-browser mcp`。
- CLI：`bin/laofu-browser help`。同一任务可以从 SDK、CLI、MCP 和控制台查询。

SDK 不自动重试未知写入。提交前保存幂等键，连接断开后用原键查询原命令；`waiting_user`、`suspended`、`partial` 均不表示完成。

## 构建与验证

使用 Node22 环境执行 `npm ci && npm run build && npm test`。`npm run verify:baseline` 校验58个原版文件和23工具清单。真实浏览器回归脚本、证据分类与环境限制见 [验收报告](docs/ACCEPTANCE.md)。

安装、升级、回退、Docker隔离和故障处理见 [运行手册](docs/OPERATIONS.md)。受限入口只有实际隔离报告全部通过才开放；单个执行端只有新启动对应的完整实测证明通过，才能授权产品。
