# 来源与许可证

本产品为内部开发版。`vendor/huashu-chrome-1.2.0/` 固定保存花叔（alchaincyf）的 huashu-chrome 1.2.0；该部分使用 MIT 许可证，原许可证随源码和本地制品保留。上游仓库：https://github.com/alchaincyf/huashu-chrome 。

`runtime/engine/` 是从上述快照生成的派生代码，自有修改集中在 `scripts/build-engine.mjs` 与下载处理补丁。原版功能来源与自有服务、隔离、持久任务、图文转换和接入包分别列在兼容说明中。

Node.js、Chromium、Playwright、SQLite、React、Fastify 及其他依赖分别适用其随包许可证；固定版本和完整性来源保存在 package-lock.json、上游基线和 RELEASE.json。Chromium/Node 的随包 LICENSE 保留。自有源码未在本次任务中公开发布或授予新的开源许可。
