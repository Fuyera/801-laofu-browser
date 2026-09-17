# 限流事件归属

**简体中文** | [English](RATE_LIMIT_SCOPE.en.md)

服务启动的 Chromium 将请求开始时的执行代次、实际 Page 和任务 ID/fence 绑定。子 Frame 请求归属于其 Page。429 只有属于本次已绑定页面才会停止当前任务；跨站子资源仍保留限流保护。旧请求在任务切换或人工接手前后迟到，不得取消下一代执行。

Chrome tabId 通过扩展的内部、受当前 controller 保护的 tab_target 查询映射到 CDP target ID，再与 Playwright Page 逐一精确匹配；不按 URL、页面顺序或标题猜测。同 URL 多标签页也不共享归属。target ID 在页面建立时读取并缓存，不修改 DOM。

显式 tabId 命令在执行前绑定。tabs.new 的回执携带新 tabId；其新页面初始导航的 429 可以在身份核验后补归属。旧页面的历史后台请求不会因后来绑定而追溯归属。待归属样本上限 128 条，每次任务代次切换清空。

图文采集先建立空白页、完成绑定，再导航。没有显式 tabId 且不能确定实际目标的旧 Session 命令不猜测归属；调用者应显式提供 tabId。无法关联 Page 的 Service Worker 流量只记诊断。attach 模式没有此 Playwright Context 监听器，仍使用原有工具级错误与页面状态检测，不能宣称获得同等网络覆盖。

这不是网络访问授权层。代理、私网阻断、站点冷却、人工接手及未知写结果禁止重放等保护不应因此被关闭。发布前还须在支持的实际 Chrome 环境验收扩展 target 映射、L2 操作、初始导航和多标签页时序；Node 测试替身不替代这些验收。
