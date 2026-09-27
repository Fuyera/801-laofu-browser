# 当前状态

**简体中文** | [English](CURRENT_CONTEXT.en.md)

更新：2026-09-25。**0.1.0-dev.4，macOS Apple Silicon 开发者预览版已发布**。产品为连接 AI 助手与浏览器的本地浏览器助手。固定包包含完整双语文档、中英文控制台、Agent 观察与结果反馈优化，以及 macOS/Linux 进程身份核验修复。P5、跨平台和日本服务器部署继续暂停；X 列表遗漏仍为已知限制。

2026-09-27 本地 dev.5 已安装（公开 Release 仍为 dev.4）：修复上游关闭标签回调中未定义的 childKey 引用。54 项测试、隔离真实 Chromium 后台清理和日常 MCP 开页/读取/关闭通过；后台无新 childKey 异常。184 条原任务、3 条 unknown 效果记录和原凭据保留，备份位于 `~/.local/share/laofu-browser/backups/pre-dev5-20260927`，previous 为 dev.4。固定构建提交 `61717d1f35165e178add48225e350ba940138fc5`；19860 个清单条目校验通过。Chrome 仍保留历史连接拒绝记录，不代表当前断线。[修复和本地验收](docs/evidence/tab-cleanup-20260927.json)。本次未推送或发布，也未改业务消费者配置。


## 交付状态

按用户授权已推送 main、发布标签及 GitHub 预览版。固定构建提交为 `1800ada796dd07ca4fa8a674aab2d3bc4dd56dc3`，来自干净工作树。Release 于 2026-09-26 02:58:11 UTC（本地 9 月 25 日）发布，9 个附件大小及 SHA-256 与 GitHub 资产摘要全部一致；匿名 Release 访问和 TypeScript SDK 下载校验通过。安装包、两套 SDK、SHA256SUMS、DELIVERY.json 与 ACCEPTANCE-dev4.json 均已上传。

项目地址：https://github.com/Fuyera/801-laofu-browser

预览版地址：https://github.com/Fuyera/801-laofu-browser/releases/tag/v0.1.0-dev.4

包内状态文档是发布准备阶段快照，最终验收与发布结果见 Release 附件和 main 的[验收](docs/evidence/release-dev4/acceptance.json)、[交付清单](docs/evidence/release-dev4/delivery.json)、[发布回执](docs/evidence/release-dev4/publication.json)。后续文档提交不改变固定包或标签。原版 vendor 保持不变，不覆盖历史发行包；此次不提供 Docker 镜像发行包。

## 日常安装审计与升级

2026-09-25 审计发现 dev.3 的 19,818 个清单条目完整，但服务未运行，旧 worker PID 被 tipsd 复用导致误报。[原审计](docs/evidence/release-dev4/audit.json)。随后按用户“升级本地”指令完成 dev.4 日常升级；current.json 指向 dev.4，保留 dev.3 作为 previous。升级前完整状态及版本指针备份于 `~/.local/share/laofu-browser/backups/pre-dev4-20260925`，安装器另生成数据库备份。

9 月 25 日升级验收时，服务、worker 均从固定 dev.4 目录运行，原 Chrome 扩展重载后 ready=true、quarantined=false。18 个扩展实现文件与发行包一致；180 条旧任务及 3 条 unknown 效果记录保留，不重放；所有者凭据和 worker 配置未变。新 dev.4 stdio MCP 列出 28 个工具，Example Domain 读取和新 observation 元信息实测通过，验收页已关闭。[升级证据](docs/evidence/release-dev4/local-upgrade.json)。101 项目的 MCP 启动配置仍固定 dev.3；遵循不自动改动业务消费者规则，未修改该配置。

## 验证

- 完整构建及 53 项单元/接口测试通过；上游 58 文件、23 工具基线不变。
- 6 项真实 Chromium + MCP stdio 专项和双语控制台实测通过。快照增加加载、滚动与截断元信息，并识别有名称的 pointer 图片；MCP 增加结构化任务状态、恢复建议、保守只读提示和执行前参数检查。partial/unknown 不作为普通成功返回。
- 最终压缩包解压后 19,853 条目校验通过；独立副本安装、升级、回退与恢复 11/11，回归后再次校验通过。版本切换使用合成发行标识，不代表日常 dev.3 已升级。
- 最终 TS/Python SDK 独立安装、真实浏览器采集/上传/下载/查询/取消/恢复，以及 CLI/MCP 同任务验证通过。
- 23 项原工具回归复用本轮功能修改后、版本号和 PID 管理器改动前的实测；未冒称整个交付矩阵全部重跑。[观察专项证据](docs/evidence/browser-use-observation-20260925.json)。
- 历史 dev.3 的日常 Chrome 停止/重连等证据见[此前验收](docs/evidence/release-dev3/acceptance.json)。历史成功不代表当前日常服务正在运行。

## 公开范围与边界

自有代码 MIT，保留上游版权／许可证，README 底部保留署名、完整来源地址及修改范围。当前公开文档已脱敏，凭据、Cookie、profile、数据库、原始现场日志和账号数据不提交。当前文件及历史提交的定向密钥／私人服务器地址扫描无命中；历史报告含本机目录路径，保留原始 Git 历史，不宣称完整安全审计。双语范围覆盖项目自有 Markdown；不可变上游文档、机器可读契约／证据及原始许可证正文保留原格式。

以下为 9 月 17 日历史验收，当前运行状态以上述日常审计为准。9 月 17 日按用户要求将本机日常运行从源码目录切换到 GitHub 固定发行包：程序为 `~/.local/share/laofu-browser/releases/0.1.0-dev.3-macos-arm64`，状态为同级 `state`，端口仍为 17992／18992。旧状态路径保留兼容链接，801 源码保留；完整旧状态和原 Codex 项目配置备份在同级 `backups/pre-release-install-20260917`。下载 SHA-256 和安装器逐文件校验通过，Chrome 已重新加载发行包扩展，18 个实现文件一致；真实浏览器配置 ready=true、quarantined=false，新 stdio MCP 的 28 个工具可列出且标签页读取成功。历史未知效果保留、不重放。101 的 MCP 配置已改用发行包，用户重启 Codex 后已实测确认 MCP 进程来自发行包目录，未发现旧开发版 MCP 进程，当前会话标签页读取成功；验收证据在安装目录 `release-install-verification.json`。公众号原链接实测约 22 秒得到 Markdown、HTML 和 7/7 图片；采集状态为 partial，正文加载稳定性未确认，不宣称全文完整或已入库 M01。 旧 `workspace/local-state` 未切换。预览包未签名／公证、未上架 Chrome 商店；不能称为跨平台稳定 v1.0。
