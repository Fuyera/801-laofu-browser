# 当前状态

**简体中文** | [English](CURRENT_CONTEXT.en.md)

更新：2026-09-27。**0.1.0-dev.5，macOS Apple Silicon 开发者预览版已发布，本机日常安装已升级。** 产品为连接 AI 助手与浏览器的本地浏览器助手。P5、跨平台和日本服务器部署继续暂停；X 列表遗漏仍为已知限制。

## 交付状态

已按用户授权提交、推送 main 并发布 [v0.1.0-dev.5](https://github.com/Fuyera/801-laofu-browser/releases/tag/v0.1.0-dev.5)。固定构建提交 `61717d1f35165e178add48225e350ba940138fc5`，构建工作树干净。发布时间为 2026-09-27 11:53:59 UTC。9 个附件大小及 SHA-256 与 GitHub 资产摘要一致；匿名 Release 访问和 TypeScript SDK 下载校验通过。

本版修复上游标签关闭回调中不存在的 childKey 引用，恢复 session 清理和 tab_closed 通知，不影响其他标签状态。补丁仅通过构建脚本生成，vendor 原版不变。包内文档为构建时快照，最终结果以 main 及 Release 附件为准，不覆盖历史发行包。

证据：[验收](docs/evidence/release-dev5/acceptance.json)、[交付清单](docs/evidence/release-dev5/delivery.json)、[发布回执](docs/evidence/release-dev5/publication.json)、[缺陷与本地验证](docs/evidence/tab-cleanup-20260927.json)。

## 日常安装

current.json 指向 `~/.local/share/laofu-browser/releases/0.1.0-dev.5-macos-arm64`，previous 为 dev.4。状态仍为同级 `state`，端口 17992/18992；升级前完整备份位于 `backups/pre-dev5-20260927`。184 条原任务、3 条 unknown 效果记录、所有者凭据与 worker 配置保留，未知写结果不重放。

服务和 worker 运行 dev.5，原 Chrome 扩展已重载；ready=true、quarantined=false，18 个扩展实现文件一致。新 dev.5 stdio MCP 的 28 个工具可列出，实际开页、读取、快照、关闭均通过，无新 childKey 异常。Chrome 保留的历史连接拒绝记录不代表当前断线。101 项目 MCP 启动路径仍固定 dev.3；未自动改动业务消费者配置。

## 验证与范围

- 54 项测试通过；缺陷测试修复前复现 ReferenceError、修复后通过。
- 隔离真实 Chromium 后台验证无异常，local/session 清理、登记列表缩减、其他标签数据保留通过。最终压缩包解压后 19,860 条目校验通过，包内扩展重复专项通过。
- 日常安装使用与公开 Release 相同的固定制品；本轮未重跑 dev.4 的完整安装/回退与 SDK 运行矩阵，SDK 版本及哈希已核对。此前证据见 [dev.4 验收](docs/evidence/release-dev4/acceptance.json)。
- dev.4 引入的双语控制台、快照加载/滚动/截断信息、MCP 结构化结果与参数检查继续保留。partial/unknown 不作为普通成功返回。
- 当前为未签名、未公证的 macOS arm64 预览，不是跨平台稳定 v1.0；没有本轮 Windows/Linux 桌面、P5 或 Chrome 商店验收。文章/列表完整覆盖不作保证。

## 公开范围

自有代码 MIT，保留上游版权、许可证及来源。凭据、Cookie、profile、数据库和原始现场日志不提交。既有独立本地验收报告及目录未纳入本次提交或发行包。历史日常安装验收见 [dev.3](docs/evidence/release-dev3/acceptance.json) 和 [dev.4 本地升级](docs/evidence/release-dev4/local-upgrade.json)，历史状态不替代当前探针。
