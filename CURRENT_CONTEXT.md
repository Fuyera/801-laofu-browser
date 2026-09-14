# 当前状态

更新：2026-09-14。当前0.1.0-dev.1本机开发版，**17组完整本机回归16组通过、1组隔离网络失败；P4/P5未通过**。私有仓库[Fuyera/801-laofu-browser](https://github.com/Fuyera/801-laofu-browser)，主分支main。未改Fuyera/祈道/000业务代码，未动日本原huashu试验。

## 已实现与验证

- Node22.23.2/TS/Fastify、SQLite服务+独立执行端、58文件不可变上游、23工具和107参数原定义、集中补丁、React五区控制台、HTTP/OpenAPI、TS/Python SDK、MCP/CLI。
- 23工具真实场景通过；原版与适配版25项同输入对照通过。修复等长目标文字漏判、wait明确超时误隔离、批处理未完成误报；未知动作禁止自动换方式重试。
- 本轮重跑19项行为/HTTP、构建/契约、23工具和25项对照均通过；真实POST后回执前中断、旧worker重连、同键重投和act取消无重复提交。
- 长文/表格/代码/原图/Markdown/安全HTML/ZIP/manifest；180段普通网页和历史公众号5325字符11图离线重放通过；>12MiB原图走受控原生下载并校验；坏图/变化/403/429不伪报完整。
- 工程外TS/Python安装包调用真实服务，上传/下载/采集/查询/取消/等待恢复，MCP/CLI同任务；属于所有者入口技术接入，不称业务产品或受限身份正向接入。
- 实际noVNC输入/断开重连/继续、原版ask继续取消；外部浏览器配对及停止worker保留浏览器。未操作本人日常Chrome真实账号。
- Mac固定包安装/升级/回退等10项通过。修复性能探针遗留连接不退出；3次固定样本510–1029ms并正常收尾。容器镜像离线重建后23个源码哈希一致，接手复验通过；未启用自启动。

本轮结果见[测试报告](docs/TEST_REPORT.md)，使用与研发分别见[用户指南](docs/USER_GUIDE.md)、[研发指南](docs/DEVELOPMENT.md)。要求映射见[验收报告](docs/ACCEPTANCE.md)。新证据在docs/evidence，原始现场在workspace/full-test-efFfYK及各回归目录。压缩包的构建提交、时间、SHA-256与追加安装验证以releases/DELIVERY.json为准；制品不含账号/profile数据库。

## 最新公众号现场采集

2026-09-14，通过当前本机laofu-browser服务成功采集《用GPT-6 Astra操控Blender玩3D，保姆级教程来了。》（yK65CvMwzhQqu5_E5EfVVQ），约19秒，正文未截断、版本一致、30/30图片下载且本地哈希/引用校验通过。保存于[Markdown](workspace/captures/yK65CvMwzhQqu5_E5EfVVQ/article.md)，同目录保留ZIP、manifest和任务结果。发现1项音视频或嵌入内容未下载；这是新现场图文成功证据，不是音视频完整归档或所有公众号均可采的证明。

## 运行入口

本机loopback服务：http://127.0.0.1:17889。开发状态目录：workspace/local-state。使用固定Node运行`scripts/local.mjs status/start/stop --home workspace/local-state`；一次性控制台登录：`bin/laofu-browser console-login --home workspace/local-state`。没有注册开机自启。产品调用保持鉴权。

## 未关闭门槛与下一步

1. P0本轮完整8项仍7项通过；example.com解析为198.18.1.151保留地址，公网探针失败，受限入口保持关闭。未改DNS或放宽地址检查；此前外部DoH动作被拒绝。网络环境修复后须复验全部8项。
2. 网络通过后跑两受限身份各自profile的采集/接手/文件与越权端到端，补充全部兼容边界场景后固定P4。当前25项代表性对照不等于所有107参数组合实测。
3. 新公众号单篇现场图文已通过，见上方记录；本人日常Chrome人工安装仍待确认。其他文章与环境不据此自动记为通过。
4. P4后才去日本Ubuntu24.04x86_64独立目录部署；Windows11x86_64真实测试机待用户答复。准备脚本和Mac容器Linuxarm64不能代替目标系统验收。
