# 研发指南

适用版本：`0.1.0-dev.1`。仓库：[Fuyera/801-laofu-browser](https://github.com/Fuyera/801-laofu-browser)，私有，主分支 `main`。当前交付与缺项以 [CURRENT_CONTEXT](../CURRENT_CONTEXT.md) 和 [验收报告](ACCEPTANCE.md) 为准；能构建不代表 P4/P5 已通过。

## 代码与契约入口

|目录或文件|职责|
|---|---|
|`src/server.ts`、`contracts.ts`|Fastify HTTP、鉴权、资源归属、请求与响应契约|
|`src/store.ts`、`broker.ts`|SQLite 持久任务、幂等、profile 控制权、排队、断线隔离|
|`src/worker.ts`|独立执行端、执行前 journal、控制权代次、取消与人工等待|
|`src/browser.ts`|每个 profile 的桥、扩展配对和原始工具适配|
|`src/article.ts`、`artifacts.ts`|图文完整性、原图与产物、限额、哈希及原子发布|
|`src/network.ts`、`relay.ts`|受限浏览器出站校验和控制接口代理|
|`src/client.ts`、`sdk/python/`、`src/mcp.ts`、`src/cli.ts`|TS/Python、MCP 与 CLI，共用服务契约|
|`web/`|React 控制台：浏览器与设备、任务、图文产物、产品凭据、诊断与经验|
|`vendor/huashu-chrome-1.2.0/`|58 个文件的不可变上游快照，含 MIT 许可证|
|`scripts/build-engine.mjs`|集中生成适配补丁，输出 `runtime/engine`|
|`test/`、`scripts/*regression.mjs`|行为/HTTP 测试与真实浏览器回归|

执行链为 `API / SDK / MCP / CLI → server → broker → worker → browser → 扩展与桥`。服务与执行端各自持久化；Cookie 留在执行端，不能共享或搬运 SQLite 文件来代替远程协议。所有者保留完整工具；受限产品使用通过实测证明的专属容器与 profile。

产品边界见 [DESIGN](DESIGN.md)，已批准阶段与出口见 [IMPLEMENTATION_PLAN](IMPLEMENTATION_PLAN.md)，接口及状态语义见 [API](API.md)。`docs/openapi.json`、`docs/schemas.json` 是代码导出物，不应手工更改；`LAOFU_BROWSER_BASELINE.json` 是冻结来源，不能为使测试通过而改写基线。

## 从源码准备环境

当前完整本机回归针对 macOS arm64。使用 Node **22.23.2**，Python **3.10+**（SDK 回归还需 venv/pip），Docker Desktop（容器与 noVNC 回归）。项目的 `better-sqlite3` 含原生绑定，切换 Node 主版本后不能直接沿用原 `node_modules`。

```sh
git clone https://github.com/Fuyera/801-laofu-browser.git
cd 801-laofu-browser
node --version
npm ci --no-audit --no-fund
node node_modules/playwright/cli.js install chromium
npm run build
```

`npm ci` 和浏览器安装需要联网。浏览器运行时固定为锁文件中的 Playwright 配套 Chromium，不用日常 Chrome 代替默认测试环境。干净克隆不含 `.runtime/`、`node_modules/`、`runtime/`、`dist/`、`releases/` 和 `workspace/`。包装命令 `bin/laofu-browser` 优先采用包内 Node 或本机 `.runtime` 中的固定 Node，否则使用 PATH 中的 Node；它不会自动下载运行时。

构建顺序为上游哈希校验与补丁生成 → TypeScript 编译 → Vite 控制台构建。扩展补丁只改生成器，不直接改 `vendor/` 或把手工改过的 `runtime/` 当源码。

## 基础检查

在项目根目录、Node 22 环境执行：

```sh
npm run build
npm run typecheck
node --import tsx --test test/*.test.ts
npm run verify:baseline
node scripts/export-contract.mjs
git diff -- docs/openapi.json docs/schemas.json
```

`node --import tsx --test` 与 `npm test` 执行同一组测试，前者不需要 tsx CLI 的额外 IPC socket。契约导出还逐项比较 23 工具、107 个顶层参数及嵌套定义。成功标准是命令退出码为 0、测试没有失败；真实浏览器报告还必须逐项检查，不能只看进程退出码。

## 真实回归

先 `mkdir -p workspace`。下列脚本在 `workspace/` 建立独立服务、profile、日志和报告；不要指向日常浏览器或现有业务状态。顺序执行：部分固定端口重用，尤其原版对照与 noVNC 都占用 17972。需要操作系统允许本机监听、Chromium 子进程及相关 Docker 操作。

|命令|覆盖与前置条件|
|---|---|
|`node scripts/smoke.mjs`|真实服务启动、采集、ZIP 下载与哈希|
|`node scripts/tool-regression.mjs`|23 个原始工具、自建表单、文件、iframe、Shadow DOM、扩展重载|
|`node scripts/upstream-parity.mjs`|原版/适配版同输入对照、错误及重连；原版只调整隔离路径与连接端口|
|`node scripts/article-console-regression.mjs`|长文、原图、坏图、版本变化、403/429、控制台与移动布局；需下述历史样本|
|`node scripts/fault-regression.mjs`|自建 POST 已发生但回执未到时中断服务/桥，同键重投、旧 worker、act 取消|
|`node scripts/sdk-smoke.mjs`|工程外安装本地 TS tgz/Python wheel，上传下载、等待恢复、取消、CLI/MCP 同任务；需本地接入包|
|`node scripts/attach-regression.mjs`|独立外部测试 Chrome 的配对、离线与停止保留浏览器|
|`node scripts/download-regression.mjs`|32 MiB 慢速流超时/取消、传输确实停止、无完整产物、原键不重放|
|`node scripts/handoff-regression.mjs`|Docker 独立桌面中的 noVNC 输入、重连、继续、ask 取消；需本地镜像|
|`node scripts/isolated-smoke.mjs`|真实容器隔离检查；全部通过才继续受限身份采集，失败仍不能开放入口|
|`node scripts/install-regression.mjs`|候选安装包完整性、实际启动、升级/回退、启动失败恢复、备份、plist|
|`node scripts/performance-probe.mjs`|现有 `workspace/local-state` 本人专用浏览器上的 180 段页面，连续 3 次；需要该测试服务在线|

`container-probe.mjs`、`network-probe.mjs` 在隔离容器内部执行，不应直接在 Mac 上运行。`reload-probe.mjs` 是人工诊断脚本，输出扩展生命周期信息，没有完整通过断言；重载验收依靠 tools/parity 的行为结果。

### 历史样本

`article-console-regression.mjs` 支持 `LAOFU_WECHAT_FIXTURE`，样本目录需含 `article.json`（正文在 `body`）、`image-text.json`（JSON 字符串，段落间含 11 个 Markdown 图片块）、`images/image-01.jpg` 至 `image-11.jpg`。通过时只证明**历史样本离线重放**。该脚本旧默认值指向本机 101 项目的历史产物；其他机器必须显式提供已有授权样本，不能把这个个人路径当作项目依赖：

```sh
LAOFU_WECHAT_FIXTURE=/已有样本的绝对路径 node scripts/article-console-regression.mjs
```

缺少样本时该脚本会失败，不应伪造一份历史公众号结果来消除失败。不依赖样本的正文转换由 `test/article.test.ts` 覆盖，基础真实采集由 smoke 覆盖。

### 接入包、安装候选与 Docker

```sh
node scripts/package-sdk.mjs
python3 -m pip wheel --no-deps --no-build-isolation --no-index sdk/python -w releases
node scripts/package-release.mjs --staging
node scripts/install-regression.mjs
```

Python 离线打包需本机已具备 `setuptools>=68` 及 wheel。TS 生成 `releases/laofu-browser-0.1.0-dev.1.tgz`，Python 生成对应 wheel。Mac 打包器从本机固定 Node、浏览器和依赖构建 `workspace/package-candidate`；已存在则拒绝覆盖，应先核对并保留旧候选。安装回归会临时篡改这个**专用候选副本**后恢复，不能把正式发行目录直接当测试副本。不会启用系统自启动。

交付打包前先提交已验证源码和文档；将现有同版本目录及包归档到受忽略的 `workspace/`，然后运行 `node scripts/package-release.mjs`，生成 `releases/` 下的 Mac 目录、tar.gz 和 SHA-256。`RELEASE.json` 的 `source.commit`、`source.dirty` 应指向目标提交且为干净工作区；非 Git 环境无法识别时为 null。解压最终包到专用候选再执行安装回归，核验清单全部文件；在包外 `DELIVERY.json` 保存该提交、所有交付包哈希、镜像 ID 和验证报告。压缩包保留本地，不随源码提交，也不会自动创建 GitHub Release。

Docker 测试默认使用本地 `laofu-browser:0.1.0-dev.1` 镜像；构建入口为 `docker build -t laofu-browser:0.1.0-dev.1 -f deploy/docker/Dockerfile .`，需要安装系统依赖与浏览器的网络条件。`handoff-regression.mjs` 与 `isolated-smoke.mjs` 支持 `LAOFU_TEST_IMAGE` 指定单独的回归镜像；部署器使用 `--image`。报告必须保存实际 image ID、架构和对应代码版本，不能仅凭同名 tag 推断源码一致。Mac Docker 的 Linux arm64 结果不计为日本 Ubuntu x86_64 或 Windows 通过。

## 证据与收口

原始日志、任务 JSON、Cookie 和 profile 留在受控的 `workspace/`；提交的证据只包含经过检查的报告及控制台截图。固定报告在 `docs/evidence/`，哈希索引为 `index.json`，要求映射为 `docs/traceability.json`。旧 `collect-evidence.mjs` 固定引用历史工作目录，重跑前应先核对输入，不能用它把旧现场覆盖成“本轮”。

报告写明版本/提交、系统、执行时间、命令、退出码、通过与失败项、原始现场路径。复用既有制品或历史样本要标明；出现已执行但结果未知的动作，不自动换键或换通道重试。网络未通过时可记录其余检查，不能放宽私网/保留地址校验来取得绿色结果。

完成改动后检查 [验收报告](ACCEPTANCE.md)、[当前状态](../CURRENT_CONTEXT.md) 与用户文档是否一致。仅文档变更验证命令、链接与实际界面；协议或行为变化执行对应回归。开发版通过项不能自动升级为 P4/P5 通过。
