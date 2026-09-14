# 完整本机回归报告

日期：2026-09-14。版本：`0.1.0-dev.1`。运行源码基线：`fd4699795d647cebcf0d5302e49ca9607143faf7`；本轮另外修改了测试镜像选择和性能探针收尾逻辑。原始现场目录：`workspace/full-test-efFfYK`。

**17 组当前可执行的本机检查，16 组通过，1 组未通过。P0 公网隔离检查仍失败，P4 与 P5 未通过。** 这里的“完整”指本轮检查矩阵全部有结果，不代表所有系统、站点、参数组合或业务接入均已验证。

机器可读结果见 [full-test.json](evidence/full-test.json)，全部固定报告和截图的来源及 SHA-256 见 [index.json](evidence/index.json)。本报告与 [产品验收报告](ACCEPTANCE.md) 分工：前者说明这次执行，后者维护产品要求与阶段门槛。

## 执行结果

|检查组|结果|证据与范围|
|---|---|---|
|构建|通过|上游校验、24 处补丁生成、TypeScript、Vite 构建均退出 0|
|类型检查|通过|`tsc --noEmit` 退出 0|
|行为及 HTTP|19/19 通过|权限、资源归属、幂等、控制权、文件限额、预览、经验恢复|
|上游基线|通过|58 个文件 SHA-256；23 工具清单|
|接口契约|通过|23 工具、107 个参数及嵌套定义逐项相等；重新导出的 OpenAPI/Schema 无差异|
|基础真实采集|通过|独立服务、Chromium、正文/图片、ZIP 下载与哈希|
|原始工具|23/23 通过|[tools.json](evidence/tools.json)|
|原版语义对照|25/25 通过|[parity.json](evidence/parity.json)，包含错误和扩展重连|
|图文及控制台|7 个报告场景通过|[article-console.json](evidence/article-console.json)，另包含小预算拒绝与恶意 HTML 预览拒绝断言|
|故障恢复|4/4 通过|[faults.json](evidence/faults.json)，外部 POST 后回执前中断、旧 worker、同键重投、act 取消|
|SDK 与多入口|通过|[sdk.json](evidence/sdk.json)，工程外安装 TS/Python 本地包，上传下载、取消、人工等待恢复、CLI/MCP 同任务|
|外部浏览器配对|通过|[attach.json](evidence/attach.json)，独立测试 Chrome；不是日常账号安装|
|慢速下载|2/2 通过|[downloads.json](evidence/downloads.json)，超时与取消后流停止、无完整产物、原键不重放|
|远程人工接手|2/2 通过|[handoff.json](evidence/handoff.json)，与源码匹配的新容器镜像；实际 noVNC 输入/重连、继续与取消|
|隔离执行环境|7/8，通过组判定为失败|[isolation.json](evidence/isolation.json)，失败项为公网正向访问|
|Mac 安装与回退|10/10 通过|[install.json](evidence/install.json)，本次新建专用候选、真实启动/采集/上传、完整性、升级/回退、失败恢复、备份、plist|
|性能固定样本|3/3 通过，进程正常退出|[performance.json](evidence/performance.json)，180 段本地页面，每次 510–1029 ms、8 步、0 模型调用|

测试运行于 macOS arm64、Node 22.23.2、Playwright 1.63.0 与其配套 Chromium。容器为 Mac Docker Desktop 上的 Linux arm64。性能数字含 SDK 轮询；进程树 RSS 约 2.61–2.95 GB，包含共享页重复计数与现有专用浏览器状态，不能当作独占内存、长时间稳定性或公网 SLO。

控制台已执行真实登录、提交、ZIP 下载、安全预览、五区切换、390 px 无横向溢出断言及页面错误检查；另外人工查看了[桌面截图](evidence/console-tasks.png)和[移动截图](evidence/console-mobile.png)。

## 未通过项

隔离容器中的系统 DNS 将 `example.com` 解析为 `198.18.1.151`，属于保留地址；网关公共 IP 检查拒绝后，浏览器得到 `ERR_TUNNEL_CONNECTION_FAILED`。非 root、浏览器 Namespace/Seccomp 沙箱、内部网络、直接出站拒绝、控制接口拒绝、私网拒绝和独立桌面均通过。

本轮调用实际部署器分别完成全部检查并保存失败报告，`isolationVerified=false`、`enabledForProducts=false`。没有提交虚假的隔离通过证明，没有修改 DNS、替换外部解析器或放宽地址校验。两个受限身份的完整正向流程须待这道门槛关闭后再运行；现有 HTTP 越权拒绝测试不抵消正向流程缺失。

## 本轮修正与制品对应

- 性能脚本首次已得到 3 次成功采集，却留下到测试端口 17976 的 TCP 连接，进程不退出。保存现场后停止了该探针；新增对这个测试服务器的 `closeAllConnections()`，复跑三次成功并以退出码 0 正常结束。
- 旧 Docker tag 的源码与工作区字节不完全相同，差异包含扩展标签更新。使用既有依赖与 Chromium，在 `--network=none` 下构建独立镜像 `laofu-browser:0.1.0-dev.1-retest-fd46997`，随后重跑接手和完整隔离。最终镜像 ID 为 `sha256:543a46f66b1b00fb49e8c915005273e6d6e1fbab901447348c60f4af76aa83ac`，23 个源码、锁文件及补丁生成器哈希与工作区一致。
- `handoff-regression.mjs`、`isolated-smoke.mjs` 增加 `LAOFU_TEST_IMAGE`，可显式选取独立测试镜像。全 8 项失败现场使用 `deploy/isolated.mjs create/verify --image` 流程采集；避免 smoke 遇到首项错误即提前退出导致其余证据丢失。
- 本轮 SDK 回归安装的是现有本地包；额外比较 TS 包的 8 个 JS/类型文件和 Python wheel 主模块，均与当前构建/源码一致。详见 [source-verification.json](evidence/source-verification.json)。

上述完整回归结束时，新 Mac 候选仅用于安装测试，当时尚未替换发行压缩包。后续压缩包更新的源码提交、时间、SHA-256 和追加验证以包外 `releases/DELIVERY.json` 为准；Mac 包内 `RELEASE.json` 记录来源提交与逐文件哈希。更新制品不改变本报告的失败项与验收范围。测试容器、网络、卷在记录日志后清理；安装回归服务已停止。浏览器 profile、凭据及原始任务日志仍在被 Git 忽略的本地运行目录。

## 公众号证据与其余缺项

本轮执行了 5325 字符、11 张原图的历史公众号离线重放。同时重新核验了 2026-09-14 14:05 UTC 既有现场采集《用GPT-6 Astra操控Blender玩3D，保姆级教程来了。》的 Markdown 哈希、30/30 图片哈希和相对引用，均通过；正文记录为当前可见范围完整、未截断且版本一致，仍有 1 项音视频或嵌入内容未下载。[复核记录](evidence/capture-verification.json)

本轮没有重新向公众号发送采集请求。该单篇现场成功与历史离线重放分别记录，不推广为所有公众号、折叠正文、分页或全部媒体完整。

下列项目保留缺项：Windows 11 x86_64 真实机器、日本 Ubuntu 24.04 x86_64 部署、日常 Chrome 真实账号人工安装、所有 107 参数组合和全部边界、20 个宿主应用逐一启动。联网 npm 漏洞审计本轮未重跑，此前该外发动作被拒绝；依赖与锁文件未因此更换。

研发复现步骤与数据准备见 [DEVELOPMENT](DEVELOPMENT.md)；实际使用见 [USER_GUIDE](USER_GUIDE.md)。
