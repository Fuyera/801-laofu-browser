# 当前状态

更新：2026-09-14（本地）。分支 `fuyera/p4-macos`，版本 **0.1.0-dev.2**，P4 代码和报告保存在本分支。私有仓库 [Fuyera/801-laofu-browser](https://github.com/Fuyera/801-laofu-browser)，main 已推送 `2b2fdad`。**完整矩阵 22/22 通过；已提交来源的新包/镜像复验通过，P4 尚余日常 Chrome 人工入口及最终冻结。P5/跨平台/日本部署/跨端自动选择暂停。旧 dev.1 仅归档，不要求历史包迁移。**

## 实现与当前证据

产品磁盘/排队/驻留额度；精确站点与账号指纹；持久冷却/Retry-After；正文有界加载与成功页回收；MIME、上传重新验权、删除中止下载/deleted；接手单次票据；统一版本/构建信息、证据收集、包验证和离线镜像构建。容器先关闭 Chromium 再关闭显示，保留同卷配置。vendor 58 文件不变，23 工具/107 参数契约保留。

- `workspace/full-regression-e00XRn`：2026-09-15 02:03–02:11 UTC 完整 22/22；30 项单元/HTTP、图文 7、运行 7、双身份 8、安装 11、兼容边界 6、实际 Codex 宿主 3 均通过。
- 矩阵原版对照 40/40；随后补 CSP 的 `workspace/parity-ivgTQD` 单独复跑 43/43。两会话默认页/后台截图、当前 Chromium 并发 debugger、禁用 L2 拒绝无效果、原键不重放实测通过。
- 安装复测发现并修正服务重启后 GET 复用失效连接：仅 ECONNRESET/UND_ERR_SOCKET 重连一次，POST 不重放。完整矩阵在修正后通过。
- Docker A/B 各八项真实隔离、正常同卷重启、TS/Python 安装包公网采集、两身份 noVNC 输入/重连/同任务继续/文件归属/越权拒绝通过。账号是合成样本；公网是真实访问。
- 候选镜像 `sha256:2f2ae06755667edf59d8d6ee0107b6b8c8b9d25f5d0c8cd40989d8d9e2d0c3ef`，dirty 来源。公网网关仅用宿主原有 DNS 8.8.8.8/8.8.4.4；内部解析及私网/保留 IP 拒绝保留。
- 实际 Codex app-server 通过配置识别/浏览器工具调用/卸载；专用配置、临时协议上下文，没有模型轮次或持久任务。不代表 20 宿主全覆盖。

## 剩余与交付

已完成源码提交 `580a6cf35e614e697bd802f8cc780ece6675a142`。干净来源候选 `workspace/p4/package-clean-580a6cf`；安装 `workspace/install-LBOn3J` 11/11，镜像 `workspace/p4-isolated-4a55Pp` 双身份 8/8。新镜像 `sha256:cdfd0dce6016cf6f30f26192ea71a197f176ff7e960cae2555f8851100393ef8`，Mac 包解压 19789 文件与镜像包 42 blob 哈希均过。压缩包、SDK、来源与哈希见 `workspace/p4/CANDIDATE.json`。后续报告提交只更新文档，不改动该候选的来源。

日常 Chrome 临时扩展加载仍待权限答复；计划只读新建 example.com，停止 worker 后验证浏览器保留，再移除本次扩展。用户开盖后自动回归已完成；最后 UI 观察又报告 Mac 锁定，人工步骤需要解锁。未加载新扩展，专用测试服务已停止；配对配置留在 `workspace/p4/daily-chrome-state`，恢复时用 local.mjs start --home 指向该目录（17992/18992）。原有扩展不改动。

人工步骤通过后才冻结最终 dev.2 并更新 releases/DELIVERY.json；旧 dev.1 档案和 DELIVERY 保留。本轮只做本地提交，未推送或公开发布。
证据索引 docs/evidence/p4/index.json；范围和复现见 docs/ACCEPTANCE.md、TEST_REPORT.md、IMPLEMENTATION_PLAN.md。根 docs/evidence 为 dev.1 历史，不混成当前一次回归。

## 运行与历史图文

本人旧服务 http://127.0.0.1:17889，状态 workspace/local-state，本轮未切换；用固定 Node 运行 scripts/local.mjs status/start/stop。凭据、Cookie/profile 不提交。

历史公众号任务 yK65CvMwzhQqu5_E5EfVVQ（2026-09-14 14:05 UTC）：约 19 秒、30/30 图哈希/引用核对，正文版本一致，1 项嵌入媒体未下载；成果留在 workspace/captures。本轮没有再次请求公众号，单篇不代表所有站点全文。
