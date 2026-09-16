# 当前状态

更新：2026-09-16。版本 **0.1.0-dev.3**，分支 `fuyera/p4-macos`，HEAD `592b5c97530c3c716909fb3cda66bf6f5dceece7` 加未提交改动。仓库 [Fuyera/801-laofu-browser](https://github.com/Fuyera/801-laofu-browser) 仍为私有。

## 当前主线：预览版交付收尾

用户已授权自有代码采用 **MIT**，保留上游版权和许可证，README 最底部保留署名、来源链接及修改范围；用户现已明确授权完成剩余交付，包括同步 main、公开 GitHub 仓库和发布预览版 Release。范围为 macOS Apple Silicon 预览版，P5／跨平台／日本部署继续暂停。

已加入根 LICENSE，更新 NOTICE、README、SDK 许可与 Mac／Docker 打包入口。README 提供源码安装、能力说明、支持范围和已知限制。公开文档与证据副本已清除个人绝对路径和私人服务器地址；原始副本留在忽略目录 `workspace/public-prep/originals`，公开报告标记脱敏并保存原哈希，索引校验公开副本。未修改 vendor 基线。整理工作不等于已公开仓库；未推送、创建 GitHub Release、重写历史或升级日常服务。

本轮验证：临时副本的 TS／Python SDK 打包均包含 MIT；上游 58 文件不变，46 项证据索引哈希及文档链接通过。226 个拟公开文件的定向凭据模式检查无命中；这不是完整安全审计。记录 `workspace/public-prep/verification.json`。

## 已确认缺陷与验证

此前授权仅修复对抗复核 **28 条 A 类问题中成立部分**；B 类 8 条、C 类 2 条、D 类 3 条暂不处理。28 条已实现，逐项见 [修复记录](docs/ADVERSARIAL_FIXES.md)，原裁定见 [复核](docs/ADVERSARIAL_REVIEW.md)。

功能修复证据：单元／接口 **50/50**、隔离浏览器 **19/19**、双身份 Docker **8/8**、接手 **2/2**。首轮矩阵 **22/24**；旧 Python 选用问题与 Docker 默认 DNS 的保留地址问题，经 Python 3.11 和原有公共 DNS 配置补跑解决。**24 个矩阵项目均有通过证据**，首轮失败保留。[证据索引](docs/evidence/adversarial-fixes/index.json)区分阶段与修复时源码哈希；本轮公开整理及打包许可修改不冒充当时已测内容。

X 的公开主页、两篇单帖、搜索和滚动基础读取已通过日常 Chrome 实测；列表 DOM 12 条而 text／Markdown 仅返回 11 条且未标截断。用户决定 **X-READ-01 暂缓处理，作为预览版已知限制，不阻塞此次开放准备**。不承诺列表全量无遗漏。实测环境为 08:58 UTC 的已安装构建，尚不包含最新修复。见 [X 验收](docs/X_READ_ACCEPTANCE.md)。

## 交付与待完成项

P4 尚余最新候选的日常 Chrome 生命周期验收与最终冻结。日常扩展已完成安装、品牌、连接及旧构建 X 读取；配对目录 `workspace/p4/daily-chrome-state`，服务／桥端口 17992／18992。旧服务 `workspace/local-state` 未切换。Cookie、凭据与 profile 不提交。

干净来源候选 `workspace/p4/package-clean-580a6cf` 和 `workspace/p4/CANDIDATE.json` 不含后续修复。`workspace/adversarial-package-candidate` 是修复过程中的隔离回归候选，也不是最终包；正式 `releases/DELIVERY.json` 仍记录归档 dev.1。下一交付须固定最新源码、重建并验收对应安装包。旧 dev.1 仅归档，不要求历史包迁移。

已定向检查当前 226 文件和历史 4 个提交的 367 个 blob，未命中常见密钥和私人服务器地址；历史报告仍有本机目录路径，不含凭据。保留历史，不重写 Git。新包采用 dev.3，避免覆盖旧版本；最终安装与日常 Chrome 生命周期验收后发布。

## 历史现场边界

日本服务器历史只读核验确认机房出口和浏览器自动化特征，未证明 IP 是公众号验证的唯一原因；未购买住宅出口、改网或恢复 P5。具体地址及原始证据留在受控本地，方案见 IMPLEMENTATION_PLAN。

历史公众号图文曾核对 30/30 图片哈希与引用，1 项嵌入媒体未下载；本轮未重新访问公众号。成果留在 `workspace/captures`。
