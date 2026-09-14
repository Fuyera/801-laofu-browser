# 用户指南

laofu-browser 帮你在授权浏览器中读取网页、执行操作，并保存可查看、可下载的任务成果。当前为 `0.1.0-dev.1` Mac 开发版，已验证的是本人专用浏览器与指定测试场景。受限产品接入、日常 Chrome 安装和跨系统支持的当前状态见 [验收报告](ACCEPTANCE.md)。

## 打开现有本机服务

本项目当前开发服务地址为 `http://127.0.0.1:17889`，状态目录是 `workspace/local-state`。在项目根目录获取一次性登录地址：

```sh
bin/laofu-browser console-login --home workspace/local-state
```

打开输出的完整地址。票据 10 分钟有效且只能交换一次；登录后的管理会话有效 8 小时。过期后重新执行命令。地址包含登录票据，不能转发给其他产品或写入公开文档。直接打开服务首页但没有管理会话时，出现登录提示是正常行为。

如果现有服务已停止，使用项目自带 Node 启动服务和本人专用浏览器：

```sh
.runtime/node-v22.23.2-darwin-arm64/bin/node scripts/local.mjs start --home workspace/local-state --browser
.runtime/node-v22.23.2-darwin-arm64/bin/node scripts/local.mjs status --home workspace/local-state
```

服务首次运行会初始化专属目录；已有状态目录不需要再次执行 `init`。脚本显示进程运行不代表目标网站可访问：还应在控制台确认浏览器就绪，并按任务结果判断成功。

新机器从源码准备环境见 [研发指南](DEVELOPMENT.md)；使用固定 Mac 包时，按 [安装与运行手册](OPERATIONS.md) 安装。GitHub 仓库不包含 Node、Chromium、SDK 制品和本机账号数据，克隆代码本身不等于完成安装。

## 采集一篇文章

1. 在“浏览器与设备”确认本人专用浏览器可用。
2. 打开“任务”，填写完整文章链接，选择执行浏览器，再点“采集图文”。
3. 任务会先排队，再执行。可以离开控制台，稍后从最近任务找回；关闭页面不会取消任务。
4. 查看结果中的正文范围、图片数量、警告和状态，再下载 `article-with-images.zip`。
5. 解压 ZIP，打开 `article.html` 阅读，或用 Markdown 编辑器打开 `article.md`；移动或分享时保留旁边的 `images/` 目录。

输出包括正文 Markdown、安全阅读 HTML、原图和 `manifest.json`。Markdown 保留图文顺序并引用包内相对路径。manifest 记录来源、采集时间、图片数量、字节数和哈希，便于核对遗漏。原图不会套用其他产品的发布压缩规则。

“完成”表示本次请求要求在已声明范围内满足。`complete_for_scope` 的范围是当前已授权可见正文；它不保证折叠、付费、分页或站点未展示的内容也已取得。图片全部保存也不代表音频、视频和嵌入内容都已归档。

## 遇到等待、缺图或失败

|页面状态|该怎么做|
|---|---|
|排队／执行中|等待并查看进度；不要重复点击创建同一任务|
|等待本人处理 `waiting_user`|在对应浏览器完成登录或页面操作，回到任务点“已完成，继续任务”|
|部分完成 `partial`|先下载已有成果，再看缺失图片、截断或版本变化提示；不要把它当作完整归档|
|挂起 `suspended` 或效果未知|先核对原浏览器的操作是否已发生；需要维护者确认恢复，不能直接重发提交|
|失败 `failed`|查看错误原因和任务详情；403、429、验证页和空正文不会被包装成文章|
|正在停止|取消请求已提交，等待停止确认|
|已取消 `cancelled`|任务已收口；已经发生的网页操作未必能撤销，仍需核对效果说明|

本机任务可直接在专用浏览器完成手动操作。有独立远程桌面的任务可点“接手浏览器”；接手断线后可以重新连接同一任务，断开查看不等于取消。完成后关闭接手窗口并明确继续。系统不会自动解决真实验证码，也不会通过换账号或网络重复尝试受限操作。

## 控制台五个区域

|区域|用途|
|---|---|
|浏览器与设备|查看所属模式、连接与就绪状态，确认正在用哪个浏览器|
|任务|创建采集、看进度和结果、取消、继续或人工接手|
|图文产物|下载文件或预览生成的安全 HTML；删除后文件入口立即失效|
|产品凭据|管理独立产品身份及其权限；当前受限浏览器验收未通过时不能开放调用|
|诊断与经验|查看任务耗时、执行情况，以及站点经验的版本与历史|

本人日常 Chrome 的完整权限仅属于本人，不能授予业务产品。需要连接日常 Chrome 时按 [运行手册](OPERATIONS.md#本人日常chrome) 在目标浏览器人工加载独立扩展；专用测试 Chrome 的成功不代表日常账号已经连接。

## 用命令行查询与下载

先在“浏览器与设备”或 `capabilities` 输出中取得实际 profile ID。以下 ID 和网址是示例，必须替换；为同一次请求保存固定幂等键。

```sh
bin/laofu-browser capabilities --home workspace/local-state
bin/laofu-browser capture 'https://example.com/article' --profile prf_实际ID --key article-唯一业务编号 --home workspace/local-state
bin/laofu-browser job tsk_实际ID --home workspace/local-state
bin/laofu-browser download art_实际ID --output ./article-with-images.zip --home workspace/local-state
bin/laofu-browser cancel tsk_实际ID --home workspace/local-state
bin/laofu-browser resume tsk_实际ID --home workspace/local-state
```

`capture` 返回任务 ID，返回排队信息不等于完成。用 `job` 查询状态；待结果中出现产物 ID 后再下载。连接中断时保留原任务 ID 与幂等键查询，不为未知操作生成新键重试。SDK 和 MCP 的接入方法见 [API 文档](API.md)。

## 停止、备份与常见问题

停止当前开发服务和它管理的专用执行端：

```sh
.runtime/node-v22.23.2-darwin-arm64/bin/node scripts/local.mjs stop --home workspace/local-state
```

停止不会删除文章、任务和账号状态；也不等于撤销网页上已执行的操作。先处理正在运行或等待人工的任务。备份、升级、程序回退与可选自启动见 [运行手册](OPERATIONS.md)。当前没有自动注册开机启动。

- **浏览器离线：**确认执行端在运行，扩展已加载；服务在线与浏览器就绪是不同状态。
- **文章打不开：**在任务使用的同一个浏览器查看登录、权限或站点提示；`doctor` 不会自动验证目标网站。
- **图片不显示：**下载完整 ZIP 并保留相对目录；再检查 manifest 是否记录了下载失败或未支持的媒体。
- **配额不足：**默认产物配额 10 GiB，不自动删除旧成果。先保存需要的文件，再由本人选择删除。
- **程序恢复后任务仍挂起：**这是保留未知效果的保护状态；维护者需确认旧动作停止及外部结果，再恢复 profile。
- **Windows 或日本服务器：**当前没有对应系统的完整通过证据，准备脚本不能当作已完成安装验收。
