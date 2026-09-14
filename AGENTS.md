# laofu-browser 协作规则

- 先读 CURRENT_CONTEXT.md；产品范围以 docs/DESIGN.md 和 docs/IMPLEMENTATION_PLAN.md 为准。
- 独立公共能力工程；不直接依赖或改造 Fuyera、祈道、000。
- 原版 vendor/huashu-chrome-1.2.0 为不可变基线；补丁只通过 scripts/build-engine.mjs 生成到 runtime/。
- 功能、协议、权限、恢复用行为测试和真实执行证据验收。Mock/代码存在不等于现场通过。
- 保留凭据和浏览器配置于受控运行目录，不提交；未知写结果不得重放。
- 按用户批准的 P0→P5 持续完成；没有 Windows 等环境时实录缺项并继续其余实现，不能冒充完整 v1.0。
- 不自动公开仓库、上架、推送或改动业务消费者。
