# 研发指南

适用版本：`0.1.0-dev.2`。仓库：[Fuyera/801-laofu-browser](https://github.com/Fuyera/801-laofu-browser)，主分支 `main`。当前交付与缺项以 [CURRENT_CONTEXT](../CURRENT_CONTEXT.md) 和 [验收报告](ACCEPTANCE.md) 为准；能构建不代表 P4/P5 已通过。

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
|`node scripts/article-console-regression.mjs`|长文、原图、坏图、版本变化、403/429、控制台与移动布局；默认项目内自建样本；历史样本可选|
|`node scripts/fault-regression.mjs`|自建 POST 已发生但回执未到时中断服务/桥，同键重投、旧 worker、act 取消|
|`node scripts/sdk-smoke.mjs`|工程外安装本地 TS tgz/Python wheel，上传下载、等待恢复、取消、CLI/MCP 同任务；需本地接入包|
|`node scripts/attach-regression.mjs`|独立外部测试 Chrome 的配对、离线与停止保留浏览器|
|`node scripts/compatibility-edge-regression.mjs`|两会话及后台截图、并发 debugger、禁用 L2/CSP 失败无效果；独立测试 Chromium|
|`LAOFU_CODEX_BINARY=/Applications/ChatGPT.app/Contents/Resources/codex node scripts/codex-host-regression.mjs`|实际 Codex app-server 配置识别、工具调用与卸载；临时协议上下文，无模型轮次|
|`node scripts/download-regression.mjs`|32 MiB 慢速流超时/取消、传输确实停止、无完整产物、原键不重放|
|`node scripts/handoff-regression.mjs`|Docker 独立桌面中的 noVNC 输入、重连、继续、ask 取消；需本地镜像|
|`node scripts/isolated-smoke.mjs`|真实容器隔离检查；全部通过才继续受限身份采集，失败仍不能开放入口|
|`node scripts/install-regression.mjs`|候选安装包完整性、实际启动、升级/回退、启动失败恢复、备份、plist|
|`node scripts/performance-probe.mjs`|指定 `LAOFU_TEST_STATE` 的专用测试服务上的 180 段页面，连续 3 次；完整矩阵自行启动隔离的本机服务|

`container-probe.mjs`、`network-probe.mjs` 在隔离容器内部执行，不应直接在 Mac 上运行。`reload-probe.mjs` 是人工诊断脚本，输出扩展生命周期信息，没有完整通过断言；重载验收依靠 tools/parity 的行为结果。

### 历史样本

`article-console-regression.mjs` 支持 `LAOFU_WECHAT_FIXTURE`，样本目录需含 `article.json`（正文在 `body`）、`image-text.json`（JSON 字符串，段落间含 11 个 Markdown 图片块）、`images/image-01.jpg` 至 `image-11.jpg`。通过时只证明**历史样本离线重放**。默认在自己的测试目录生成 11 图的合成样本，报告标注 synthetic-browser-fixture；如需重放历史材料，必须显式提供已有授权样本：

```sh
LAOFU_WECHAT_FIXTURE=/已有样本的绝对路径 node scripts/article-console-regression.mjs
```

显式指定的历史样本缺失时会失败；合成样本不会被标注为历史公众号证据。不依赖样本的正文转换由 `test/article.test.ts` 覆盖，基础真实采集由 smoke 覆盖。

### 接入包、安装候选与 Docker

```sh
node scripts/package-sdk.mjs
python3 -m pip wheel --no-deps --no-build-isolation --no-index sdk/python -w releases
node scripts/package-release.mjs --staging --output workspace/新候选目录
LAOFU_PACKAGE_CANDIDATE="$PWD/workspace/新候选目录" node scripts/install-regression.mjs
```

Python 离线打包需本机已具备 `setuptools>=68` 及 wheel。TS 生成 `releases/laofu-browser-0.1.0-dev.2.tgz`，Python 生成对应 wheel。Mac 打包器从本机固定 Node、浏览器和依赖构建指定输出目录（未指定时为 `workspace/package-candidate`）；已存在则拒绝覆盖，应先核对并保留旧候选。安装回归会临时篡改这个**专用候选副本**后恢复，不能把正式发行目录直接当测试副本。不会启用系统自启动。

交付打包前先提交已验证源码和文档；为新发行使用新的版本号，然后运行 `node scripts/package-release.mjs`，生成 `releases/` 下的 Mac 目录、tar.gz 和 SHA-256。`RELEASE.json` 的 `source.commit`、`source.dirty` 应指向目标提交且为干净工作区；非 Git 环境无法识别时为 null。解压最终包到专用候选再执行安装回归，核验清单全部文件；在包外 `DELIVERY.json` 保存该提交、所有交付包哈希、镜像 ID 和验证报告。压缩包保留本地，不随源码提交，也不会自动创建 GitHub Release。

Docker 测试默认使用本地 `laofu-browser:0.1.0-dev.2` 镜像；构建入口为 `docker build -t laofu-browser:0.1.0-dev.2 -f deploy/docker/Dockerfile .`，需要安装系统依赖与浏览器的网络条件。`handoff-regression.mjs` 与 `isolated-smoke.mjs` 支持 `LAOFU_TEST_IMAGE` 指定单独的回归镜像；部署器使用 `--image`。报告必须保存实际 image ID、架构和对应代码版本，不能仅凭同名 tag 推断源码一致。Mac Docker 的 Linux arm64 结果不计为日本 Ubuntu x86_64 或 Windows 通过。

## 证据与收口

自有代码与 SDK 采用根目录 MIT 许可证；修改许可证时同步 `sdk/typescript/LICENSE`、`sdk/python/LICENSE` 及包元信息。Mac 和 Docker 分发须保留根 `LICENSE`、`NOTICE.md` 及上游许可证。公开报告的脱敏与哈希规则见 [证据说明](evidence/README.md)。

原始日志、任务 JSON、Cookie 和 profile 留在受控的 `workspace/`；提交的证据只包含经过检查的报告及控制台截图。固定报告在 `docs/evidence/`，哈希索引为 `index.json`，要求映射为 `docs/traceability.json`。`collect-evidence.mjs RUN_MANIFEST.json OUTPUT_DIRECTORY` 要求显式报告清单、来源、结果与范围，不自动更新需求状态；禁止引用旧现场冒充本轮。

报告写明版本/提交、系统、执行时间、命令、退出码、通过与失败项、原始现场路径。复用既有制品或历史样本要标明；出现已执行但结果未知的动作，不自动换键或换通道重试。网络未通过时可记录其余检查，不能放宽私网/保留地址校验来取得绿色结果。

完成改动后检查 [验收报告](ACCEPTANCE.md)、[当前状态](../CURRENT_CONTEXT.md) 与用户文档是否一致。仅文档变更验证命令、链接与实际界面；协议或行为变化执行对应回归。开发版通过项不能自动升级为 P4/P5 通过。

## P4 完整矩阵和构建来源

```sh
node scripts/build-container.mjs --base 本地已核验基础镜像 --tag 本轮候选镜像
node scripts/package-release.mjs --staging --output workspace/本轮候选
LAOFU_TEST_IMAGE=本轮候选镜像 LAOFU_PACKAGE_CANDIDATE="$PWD/workspace/本轮候选" node scripts/full-regression.mjs
node scripts/verify-release.mjs workspace/本轮候选
```

Mac 运行浏览器矩阵时须保持开盖唤醒；合盖休眠会让持久任务的墙钟预算到期，应保留现场并重新核验，不自动重放未知写入。

`full-regression` 按顺序运行并记录已完成结果及当前活动步骤；配置 `LAOFU_CODEX_BINARY` 时额外运行实际宿主检查。当前 22 组全过，矩阵中的原版对照 40 项加上后续 CSP 对照复跑 43 项分别留证；性能样本使用自己的服务目录，不借用日常开发服务。`p4-runtime-regression` 覆盖 30 次采集、账号范围、下载撤销、doctor、SSE 游标续传/凭据撤销和真实 Retry-After/重启；`p4-isolated-regression` 用实际两个隔离容器和工程外 SDK，分别记录真实公网检查与浏览器内合成账号样本。合成页面只在测试入口的保留 URL 前缀生效，生产部署不使用该入口。

公网解析可通过部署器 `--dns` 或测试的 `LAOFU_PUBLIC_DNS` 显式配置已有授权 DNS IP；只作用于公网代理，内部控制通道沿用 Docker 解析。内部主机名、私网、映射 IPv6 和保留地址仍拒绝。不得默认换到其他解析服务。

版本以 package.json 为入口；构建生成 runtime/build.json。HTTP、worker、MCP 和 CLI 使用同一软件版本，API 版本另为 v1。固定发行要求已提交且干净的 Git 来源；开发候选会如实记录 dirty。镜像构建先校验基础依赖，记录实际基础/结果 image ID 与源码提交。
