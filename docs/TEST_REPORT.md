# P4 本轮测试报告

日期：2026-09-14（本地；运行日志为 2026-09-15 UTC）。版本 `0.1.0-dev.2`，源码基线 `2b2fdad6df4a712cd33f594fd1c9399587199e14` 加 `fuyera/p4-macos` 本轮改动。**完整矩阵 22/22 通过；日常 Chrome 人工入口仍待关闭，干净来源候选的包/镜像复验已通过。** P5/跨平台暂停。

## 当前结果

完整矩阵在 02:03:10–02:11:11 UTC 执行，见 [完整报告](evidence/p4/full.json)。每组退出码为 0，真实运行报告逐项通过。22 组包含性能服务的初始化、启动和停止，不是 22 个功能或 22 个平台。

|检查|结果|实际来源|
|---|---|---|
|类型、构建及原版基线|通过；58 个 vendor 文件不变|矩阵 typecheck/baseline；`workspace/p4/build-read-reconnect.log`|
|行为及 HTTP|30/30|[unit](evidence/p4/unit.json)，含读取断线重连及写请求不重放|
|契约、基础采集、原始工具|通过；23 工具、107 参数|矩阵 contract/smoke；[tools](evidence/p4/tools.json)|
|原版同输入对照|矩阵 40/40；补 CSP 后单独复跑 43/43|[parity](evidence/p4/parity.json)，`workspace/parity-ivgTQD`|
|兼容边界|6/6|[compatibility-edge](evidence/p4/compatibility-edge.json)：会话、后台页截图、并发 debugger、禁用 L2/CSP、原键不重放|
|图文及控制台|7/7|[article](evidence/p4/article.json)，仓库自建样本，不是新公众号现场|
|P4 实际运行|7/7|[runtime](evidence/p4/runtime.json)：doctor、30 次回收、账号、SSE 续传/撤销、下载删除、429/重启|
|双隔离身份|8/8|[isolated](evidence/p4/isolated.json)：两身份各八项隔离、同卷重启、安装 SDK、公网、合成账号与 noVNC|
|故障、下载、接手|4/4、2/2、2/2|[faults](evidence/p4/faults.json)、[downloads](evidence/p4/downloads.json)、[handoff](evidence/p4/handoff.json)|
|TS/Python 与 attach|通过|[sdk](evidence/p4/sdk.json)、[attach](evidence/p4/attach.json)；attach 使用独立测试 Chromium|
|dev.2 独立安装|11/11|[install](evidence/p4/install.json)：篡改、同 ID 合法清单冲突、数据保留、恢复、幂等记录|
|实际 Codex 宿主|3/3|[codex-host](evidence/p4/codex-host.json)：识别配置、真实工具调用、卸载|
|本地性能样本|3 次通过|[performance](evidence/p4/performance.json)：180 段固定本地页面，1.533–2.045 秒；进程树 RSS 峰值约 1.69–1.71 GiB，包含共享页重复计数，不是物理独占内存或公网 SLO|

所有固定报告的来源、范围和 SHA-256 见 [索引](evidence/p4/index.json)。矩阵中的候选镜像为 `sha256:2f2ae06755667edf59d8d6ee0107b6b8c8b9d25f5d0c8cd40989d8d9e2d0c3ef`，Mac 安装候选为 `workspace/p4/package-final-matrix`；均记录 dirty 来源，不能冒充已提交的固定发行。43 项对照是补充执行，不能篡改矩阵中原有的 40 项结果。

## 修正与范围

- 服务重启后，TS SDK 可能复用已被关闭的 HTTP 连接，GET 报 `ECONNRESET`。仅对 GET 的 `ECONNRESET` / `UND_ERR_SOCKET` 重建连接重试一次；POST、写操作和其他失败均不自动重试。真实 HTTP 断线测试证明写请求只发生一次；安装 11 项及 SDK 复测通过后，完整矩阵再次通过。
- 容器退出由 worker 统一关闭持久 Chromium，再关闭显示服务；同卷正常重启退出码为 0，旧 boot 证明失效。未删除 profile 锁或丢弃原配置来使测试通过。
- 先注册受控页面再导航，避免漏掉初次导航 429。实际 `Retry-After: 120` 保存并跨服务重启阻止再次访问；解除冷却不重放旧任务。
- 当前 Chromium 153 允许两个扩展并发使用 debugger，实测另一调试连接保持可用且点击只发生一次。显式禁用 L2 时，真实点击与 CSP 执行以 `NEEDS_L2` 拒绝、效果计数为零；恢复 L2 后新请求可读，旧幂等键仍不重放。该结果不推断其他 Chrome 版本或所有 DevTools 状态。
- 实际宿主是已安装的 Codex app-server，使用专用目录配置与临时协议上下文；发现工具、调用浏览器并读取自建页面、卸载均通过。没有模型轮次、持久用户任务或个人宿主配置变更；不代表 20 宿主应用全覆盖。
- 两容器的公网访问、隔离与 noVNC 均是真实执行；账号/Cookie 内容使用明确标注的合成样本。公网网关仅使用宿主原有 DNS `8.8.8.8/8.8.4.4`，内部 Docker 解析及私网/保留 IP 检查保持有效。

## 复现

需要 Mac 开盖唤醒、Docker 可用，使用专用候选目录：

```sh
export PATH="$PWD/.runtime/node-v22.23.2-darwin-arm64/bin:$PATH"
export npm_config_cache="$PWD/workspace/p4/npm-cache"
npm run build
node scripts/package-sdk.mjs
python3 -m pip wheel --no-deps --no-build-isolation --no-index ./sdk/python -w releases
node scripts/build-container.mjs --base laofu-browser:0.1.0-dev.1-delivery-2b2fdad --tag laofu-browser:0.1.0-dev.2-p4-candidate
node scripts/package-release.mjs --staging --output workspace/p4/新候选目录
LAOFU_CODEX_BINARY=/Applications/ChatGPT.app/Contents/Resources/codex LAOFU_PUBLIC_DNS=8.8.8.8,8.8.4.4 LAOFU_TEST_IMAGE=laofu-browser:0.1.0-dev.2-p4-candidate LAOFU_PACKAGE_CANDIDATE="$PWD/workspace/p4/新候选目录" caffeinate -i -s node scripts/full-regression.mjs
```

DNS 参数仅适用于当前已授权路径。未配置 `LAOFU_CODEX_BINARY` 时不执行实际宿主组，不能据此称 22 组通过。安装回归会修改专用副本，勿指向已冻结发行目录。完整矩阵包含现在的 43 项对照。

## 已提交来源的交付复验

源码提交 `580a6cf35e614e697bd802f8cc780ece6675a142`，打包时 Git 干净。新镜像 `sha256:cdfd0dce6016cf6f30f26192ea71a197f176ff7e960cae2555f8851100393ef8`，包目录 `workspace/p4/package-clean-580a6cf`。

- [安装复验](evidence/p4/clean-install.json) 11/11；[双身份复验](evidence/p4/clean-isolated.json) 8/8。
- [Mac 压缩包解压核验](evidence/p4/mac-archive.json)：19,789 文件；[Docker 压缩包核验](evidence/p4/docker-archive.json)：42 个 blob 哈希、OCI 索引、平台与源码标签一致。Docker OCI 索引 ID 与配置 blob digest 是不同字段，分别记录。
- [镜像版本](evidence/p4/image-version.json)：软件、TS SDK、源码提交及 dirty=false 一致。离线构建也覆盖当前 deploy、SDK、测试和脚本源码，避免继承旧基础镜像的同名文件。
- 压缩包及 SDK 的字节数/哈希在 `workspace/p4/CANDIDATE.json`。Mac 包 SHA-256 为 `6d4de8edd9ad38a7c825adb064b165e6a94735d42c9848d38265e5a9f56ed4da`。仍标候选，未替换旧 DELIVERY 或公开发布；后续文档提交不改变这些包的构建提交。

## 剩余与历史

日常 Chrome 尚待允许临时加载扩展后，完成公开 `example.com` 读取、停止 worker 保留浏览器与移除本次扩展。当前已完成候选来源与包/镜像复验；人工入口通过后冻结发行并更新交付记录。最后 UI 观察再次报告 Mac 已锁定，尚未加载新扩展；已停止专用测试服务并保留配对配置，待授权和解锁后恢复。

此前 [合盖中断报告](evidence/p4/full-interrupted.json)保留为历史；它已由本轮 22/22 结果替代。开盖后的首次矩阵发现 GET 断线问题，修正后的当前矩阵全部通过。旧 dev.1 仅归档，不要求历史包迁移；新包安装回退使用同程序的合成发行标识，不声称历史 dev.1 降级兼容。

历史 dev.1 报告与公众号单篇 30 图证据留在 `docs/evidence/` 根目录；本轮没有再次请求公众号。没有 Windows、Ubuntu、日本部署或 20 个宿主全部现场通过的声明。最终判断见 [ACCEPTANCE](ACCEPTANCE.md)。
