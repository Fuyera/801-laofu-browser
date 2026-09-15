# laofu-browser Mac P4 验收

更新：2026-09-14（本地）。版本 `0.1.0-dev.2`，分支 `fuyera/p4-macos`。**完整矩阵 22/22 通过；P4 尚余日常 Chrome 人工入口，干净来源候选的制品复验已通过。** P5、跨平台、日本部署和跨端自动选择暂停。旧 dev.1 仅归档，历史包迁移已退出本轮门槛。

## 已实现及证据

|范围|当前证据|适用边界|
|---|---|---|
|工程与契约|58 个 vendor 文件不变；23 工具、107 参数；30 项单元/HTTP；完整矩阵 22/22|[完整报告](evidence/p4/full.json)；包含性能服务管理步骤|
|容量与账号|产品磁盘/排队/驻留额度；精确站点与账号指纹；错配等待、规则变更取消旧任务|anonymous 不要求账号核验，不保证无 Cookie；未实现跨设备匹配|
|持续运行|[7 组](evidence/p4/runtime.json)：30 次采集回收、保留原有页、tab 预算、doctor、SSE 续传与撤销|真实浏览器与自建样本|
|限流及产物|真实 429/Retry-After 跨重启生效；MIME 识别、上传重新验权、删除中止下载、保留 deleted|解除不重放；已下载字节不能追回|
|隔离与双身份|[8 组](evidence/p4/isolated.json)：两容器八项隔离及同卷重启，TS/Python 安装包采集公网|Mac Docker Desktop/Linux arm64；账号页为合成样本|
|人工接手|两身份实际 noVNC 输入、单次票据拒绝重放、新票据重连、同任务继续和越权拒绝|未自动操作真实验证码/第三方账号；不等于消费者接入|
|原版兼容|[43 项对照](evidence/p4/parity.json)；[6 组边界](evidence/p4/compatibility-edge.json)|含 CSP、并发 debugger、会话/截图隔离及 L2 不可用；不是所有浏览器版本和参数组合|
|图文、故障与接入包|7 组自建图文/控制台、4 组故障、2 组下载、2 组接手；TS/Python 实际安装|根目录公众号证据是历史单篇，未冒充本轮新抓取|
|新包安装|[11 项](evidence/p4/install.json)：独立采集、完整性、同 ID 内容冲突、重启保留、故障恢复和幂等|当前 dev.2 候选；合成版本切换，不承诺历史 dev.1 降级|
|实际宿主|[Codex 3 项](evidence/p4/codex-host.json)：配置识别、真实浏览器调用、卸载|实际已安装 app-server；临时协议上下文，无模型轮次；其他 19 宿主未逐一启动|

环境：macOS arm64、Node 22.23.2、Playwright 1.63.0。矩阵候选镜像 `sha256:2f2ae06755667edf59d8d6ee0107b6b8c8b9d25f5d0c8cd40989d8d9e2d0c3ef`，来源为 `2b2fdad` 加本轮未提交改动。容器非 root、真实 Chromium 沙箱、独立卷/网络/显示；公网代理显式使用宿主原有 `8.8.8.8/8.8.4.4`，内部 DNS 及私网/保留地址检查有效。

## P4 剩余出口

1. 日常 Chrome：最后 UI 观察报告再次锁定；待解锁并允许临时加载 laofu-browser 扩展后，只读取新建公开页，验证停止 worker 保留浏览器，再移除本次扩展。独立测试 Chromium 的 attach 通过不能代替该入口。
2. 人工入口通过后冻结 dev.2，更新 `releases/DELIVERY.json`。源码 `580a6cf` 的干净候选已完成安装 11/11、双身份 8/8、Mac 解压 19,789 文件及 Docker 42 blob 哈希核验，见 [提交后复验](TEST_REPORT.md#已提交来源的交付复验)；旧档案不覆盖。

Mac 合盖造成的历史中断已恢复；后续发现的 SDK GET 断线缺陷已修正并由当前完整矩阵验证。更多细节见 [TEST_REPORT](TEST_REPORT.md)。

|阶段|判断|
|---|---|
|P0|本机两个容器八项隔离通过；每次重启须重新证明|
|P1–P3|本轮 Mac 范围的功能、契约、故障与安全回归通过|
|P4|自动回归、实际 Codex 宿主、干净来源制品通过；人工浏览器入口与最终冻结待收口|
|P5|用户暂停；不宣称跨平台 v1.0，也不自动恢复开发|

[P4 证据索引](evidence/p4/index.json)记录来源/范围/哈希，[traceability](traceability.json)保留需求映射。根 `docs/evidence/` 为 dev.1 历史。Cookie、凭据、数据库和 profile 留在受控目录。未推送、公开发布或改动业务消费者。
