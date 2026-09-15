# 与huashu-chrome 1.2.0的兼容差异

原版MIT署名和源码快照保留。23工具的公开参数保持原定义；HTTP的profile、requestId、幂等键、输入产物与原工具args分离。仅tools/params数量一致不能证明语义相同；本轮代表性双实现同输入对照43项通过，另有6组实际兼容边界；范围见ACCEPTANCE。

|差异|类别|实际行为与原因|
|---|---|---|
|本人所有者与受限产品分开|accepted_difference|所有者保留23工具。受限产品仅开放声明的只读原始工具和高层采集；eval/fetch/act等任意代码或写能力拒绝，不能继承日常Chrome权限|
|独立路径和实例配对|accepted_difference|每个profile自己的桥端口、扩展配对、命令记录、下载和浏览器目录；不扫描其他实例并自动选中|
|命令持久化|accepted_difference|所有动作先记账；HTTP长命令返回可查询ID。原版同步入口通过MCP封装；30秒后返回持久句柄|
|未知动作不自动换L2重试|accepted_difference|仍支持显式real:true与完整L2。已发出但无效果证据时返回EFFECT_UNKNOWN，先核验外部效果，防止二次点击/提交|
|同长度目标文字变化|upstream_defect|原版仅看字符长度会漏掉1→2；本版比较短时间稳定的同一目标文字。只作为页面变化证据，不声称第三方业务已成功|
|wait超时与断线区分|accepted_difference|保留TIMEOUT/isError，同时携带浏览器明确回执标志；已结束的wait不封锁profile，通信失联保持unknown|
|批处理和截断|accepted_difference|completed=false、doneCount、截断及效果未知向任务状态传播，不把部分完成包装成成功|
|文件路径|accepted_difference|HTTP只接受受控artifactId及纯文件名；MCP在受信任调用端上传/下载本地路径。服务不返回或接受任意主机路径|
|大图片通道|accepted_difference|扩展二进制通道12MiB保留；明确超限的图像GET可转受控原生下载，保存原始字节与哈希。默认文件预算512MiB、图文50MiB、拖放48MiB|
|下载超时|upstream_defect|请求取消并验证停止结果；无停止确认时保持未知，不把取消请求等同于已停止|
|ask|accepted_difference|保留prompt/targets/until/focus等，新增持久waiting_user、控制台/独立显示接手、继续和取消；自动控制撤销后才交人|
|经验|accepted_difference|原版domain/save语义仍在；新增产品权限、版本、CAS、历史恢复，新经验不自动成为指令或授权|
|Promise eval|upstream_defect|MAIN world表达式显式await Promise后输出，不返回尚未完成的空对象|
|宿主安装|accepted_difference|保留20宿主配置支持；默认显示差异、--apply写入并备份，卸载只删本产品项；扩展安装仍需对应浏览器加载|
|bridge生命周期|accepted_difference|直接bridge子命令提示使用worker；桥由具备配对/命令协议的执行端管理，避免旁路|
|登录态和环境|accepted_difference|Cookie/密码留在执行端；不复制到服务器。验证/限流停止，不切IP/profile规避|
|Mac/其他系统|blocker|当前只验证Mac arm64及Mac容器Linux arm64；Ubuntu/Windows不能使用同一Mac二进制包冒充支持|

P4 对照已包含异常分页、Shadow、富文本、画布拖动、弹窗、失效 ref 和 CSP。另实测两会话同连接的默认页与后台截图不串页。当前 Chromium 153 允许另一扩展并发 debugger，点击只发生一次且另一连接仍可用；显式禁用 L2 时，真实点击/CSP 执行返回 NEEDS_L2、没有效果或降级重放。恢复后须新请求，旧幂等键仍返回原失败。这些结果不推断所有 Chrome 版本、DevTools 状态或参数组合。当前完整矩阵 22/22，日常 Chrome 与固定交付状态见 [测试报告](TEST_REPORT.md)。
