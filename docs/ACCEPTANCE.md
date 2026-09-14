# laofu-browser 本机开发版验收

日期：2026-09-14；版本：0.1.0-dev.1。结论：独立服务和接入包已经可运行，当前只开放本人所有者入口。**P4 Mac候选门槛尚未全部通过，P5内部v1.0未完成。**受限产品的公网正向探针失败，保持关闭；不以其他测试通过抵消这个缺口。

本报告中的 verified 只适用于对应场景和环境，不表示一个工具所有参数组合、所有站点或所有宿主均已经实测。静态基线中的 not_implemented 是设计冻结时的历史字段，当前映射以本报告和 [traceability.json](traceability.json) 为准。

2026-09-14 完整本机复测：**17 组检查，16 组通过、1 组隔离网络检查未通过**。19 项行为/HTTP、23 工具、25 项原版对照及安装回退等已重新执行。详细命令、修正和缺项见 [本轮测试报告](TEST_REPORT.md) 与 [机器可读结果](evidence/full-test.json)。

## 当前交付及环境

- 独立801工程、不可变58文件上游快照、精确依赖和锁文件、补丁生成器、扩展、HTTP服务、执行端、五区React控制台、OpenAPI/Schema。
- TS tgz、Python wheel、MCP、CLI、20个原版宿主的配置发现/预览/备份安装/卸载、Mac固定Node/Chromium制品、版本管理和自启动配置生成器。
- 本人所有者完整工具入口；受限产品使用独立Docker容器/profile/文件卷/显示和出站网关。执行端重启会使隔离证明失效。

|环境|实际验证|状态|
|---|---|---|
|macOS 26.6.2 arm64，Node22.23.2，PW1.63.0，配套Chromium153，扩展1.2.0|原始工具、图文、HTTP、SDK、控制台、安装回退|verified，限本报告场景|
|Mac Docker Desktop，Linux arm64，自建非root镜像|namespace/进程/网络/seccomp沙箱，私网拒绝，独立显示接手|partial：公网访问失败|
|本人日常Chrome已有真实profile|外部浏览器接管生命周期使用独立测试Chrome复现；未读取本人真实账号|partial：人工安装实际日常Chrome待确认|
|日本Ubuntu24.04 x86_64|保留旧huashu现场；本产品未部署|blocked：须先通过P4|
|Windows11 x86_64|已提供源码准备和登录会话配置生成入口|blocked：没有可用的实际测试机|

## 证据索引

当前仓库的 [evidence/index.json](evidence/index.json) 保存本轮报告、截图来源及SHA-256；原始详细现场保留在801的workspace下，不把凭据、真实Cookie、浏览器profile或故障现场数据库加入证据包。压缩包中的证据对应其构建时快照，具体提交与哈希见包外 `releases/DELIVERY.json`。

|报告|实测结论|边界|
|---|---|---|
|[tools.json](evidence/tools.json)|23/23工具场景通过；截图JPEG/PNG、接口分页、5MiB下载、上传/拖放、iframe/Shadow、批处理、ask、重连|当前Mac真实浏览器；参数定义107项另做静态逐项比对|
|[parity.json](evidence/parity.json)|原版与适配版25/25同输入语义对照：23工具、错误、重连|原版仅替换私有状态路径和两条连接路径的端口，未应用工具语义补丁；ref和文件路径分别映射|
|[article-console.json](evidence/article-console.json)|180段普通网页、代码/表格/链接、图片、ZIP、五区UI、390px布局、预览；坏图/变化/403/429正确分类|历史公众号为离线重放，5325字符、11张原图哈希/顺序；不称为新现场公众号采集成功|
|[faults.json](evidence/faults.json)|服务/桥在外部效果后、回执前被杀；旧worker重连及同键重投无第二次提交；act取消后无后续提交|受控表单真实POST；不是对第三方发布接口的结果确认|
|[sdk.json](evidence/sdk.json)|工程外独立安装TS/Python发布包，真实服务采集、12MiB上传下载校验、查询、取消、人工等待恢复，CLI/MCP同任务|两个独立调用程序通过所有者入口；不是受限身份成功采集，也不是两个业务产品已接入|
|[handoff.json](evidence/handoff.json)|真实noVNC键盘输入、断开重连同一浏览器、明确继续、原始ask取消/继续|自建登录式测试页；不是自动处理真实验证码|
|[attach.json](evidence/attach.json)|未加载扩展时不误报就绪、外部浏览器配对后可调用、停止worker保留浏览器|独立外部测试Chrome，未改本人日常Chrome|
|[install.json](evidence/install.json)|固定包独立安装、真实采集、文件保留、篡改/额外文件拒绝、兼容升级、回退、启动失败恢复、备份、plist语法|同一程序的合成版本切换和故意失败版本；未启用系统自启动|
|[downloads.json](evidence/downloads.json)|32MiB慢速流超时和取消后传输停止、无完整产物、原键不重放|状态保守地保留unknown；超时后profile可能需核验恢复|
|[isolation.json](evidence/isolation.json)|8项中7项通过；nonRoot、实际browserSandbox、internalNetwork、directEgressDenied、controlRoutesDenied、privateNetworkDenied、noSharedDesktop|publicEgressAllowed=false，未提交通过证明，产品调用仍拒绝|
|[performance.json](evidence/performance.json)|同一180段本地页面连续3次510–1029ms；每次8个工具步骤，0模型调用；修正连接清理后正常退出|含SDK500ms轮询；不是公网SLO。200ms进程树RSS采样约2.61–2.95GB，含共享内存重复计数与既有浏览器状态，不是独占内存|
|[capture-verification.json](evidence/capture-verification.json)|既有新公众号现场任务成功；本轮离线复核30张图片哈希/引用和Markdown哈希通过|原现场为2026-09-14 14:05 UTC，约19秒；当前可见正文范围，另有1项未下载嵌入媒体；本轮未重新请求公众号|
|[source-verification.json](evidence/source-verification.json)|离线构建新回归镜像；23个运行源码/锁文件/生成器哈希一致，SDK包与源码相等|新镜像用于本轮测试，未覆盖旧发布镜像或部署日本环境|

构建、TypeScript检查和19项本地行为/HTTP测试通过。测试覆盖幂等冲突、终态、控制权、凭据吊销、旧授权、两个身份的任务/文件越权拒绝、原始eval拒绝、路径穿越、哈希/流式配额、脚本预览和经验版本恢复。磁盘不足目前采用ENOSPC故障注入，没有填满用户真实磁盘。

## B01–B23及运行能力

所有工具通过同一 `src/worker.ts → src/browser.ts → runtime/engine` 管道；原始参数来自 `docs/LAOFU_BROWSER_BASELINE.json#/tools`，`scripts/export-contract.mjs`逐项核验107个顶层条目及嵌套定义与HTTP契约相等。具体证据和源码文件映射见 [traceability.json](traceability.json)。

|ID|工具|本轮实际验证|
|---|---|---|
|B01|snapshot|交互树、状态ref、同源/跨源iframe存在、Shadow元素|
|B02|navigate|真实页面导航及返回|
|B03|click|真实事件、选择目标、expect、实际计数|
|B04|type|输入、清空、值断言|
|B05|select|选项值实际变化|
|B06|fill|实际snapshotId/ref批量字段填写|
|B07|key|按键序列及真实事件|
|B08|read_text|text/markdown正文|
|B09|screenshot|JPEG MCP内容、PNG完整页文件产物|
|B10|tabs|创建、查询、命名和会话归属|
|B11|wait|selector/text/idle；明确超时返回后可继续调用|
|B12|network|捕获、reload、响应体读取|
|B13|fetch|分页文件、JSON文本、二进制原图哈希|
|B14|scroll|顶部、底部及实际scrollY|
|B15|download|5MiB文件产物；图文另验证大于12MiB原图原生下载|
|B16|upload|文件选择框、拖放、实际文件名|
|B17|query|选择器、表格字段提取|
|B18|act|repeat/if/assert/read、实际动作次数、取消后停止后续步骤|
|B19|ask|成功条件、持久等待、继续、取消、真实显示接手|
|B20|status|文字反馈及重连后执行|
|B21|eval|同步表达式、Promise值、结构化结果|
|B22|learnings|保存/读取、版本、CAS、历史恢复为新版本|
|B23|reload|扩展重载及后续命令实际恢复|

运行支持：20宿主配置语义、CLI、MCP内容类型、扩展重连、文件/分页、错误和截断元数据已实现。20个宿主应用逐一启动、画布拖拽、全部旧快照/弹窗/参数边界的原版双实现组合回归仍需扩充；不把工具数量通过当成这些场景已全部验证。

## 特色和八类缺口

|要求|实现与证据|状态|
|---|---|---|
|L01图文包 / R07完整性|article.ts；长文/原图/manifest/有序块/来源哈希/变化与坏图测试|verified 当前DOM范围；折叠和跨页未知项保留，不推断全站全文|
|L02跨产品API / R08接入验收|server/contracts/client/MCP/SDK；独立安装两客户端，技术双身份拒绝测试|partial：服务/接入包通过；受限产品正向链路待网络边界通过|
|L03桌面/服务器协同|worker协议独立SQLite，execution.mode，远程显示代理；Linux准备入口|partial：Mac容器已测；日本/Windows未测|
|L04人工接手 / R05控制权|broker/worker、持久ask、独立noVNC、撤销自动控制和viewer|verified 所有者容器接手；受限产品端到端仍blocked|
|L05受阻与停止|article.accessState，429/403、登录/验证页分类，限时人工等待|verified 固定场景；已有单篇公众号新现场图文成功，媒体缺项与范围单独记录|
|L06可靠任务 / R02重复执行|SQLiteWAL+FULL，前置journal、幂等、fence、终态及迟到证据；faults|verified 故障场景；未知写入仍必须人工核验|
|L07经验及成本|notes CAS/history/restore、doctor、任务耗时/步骤/RSS/人工时长/0模型调用|verified 核心行为；无模型账单系统|
|R01执行隔离|owner不可转授、一个隔离profile绑定一个产品、OS/卷/控制面隔离|blocked 公网正向探针；入口保持关闭|
|R03长命令/取消|持久command句柄、30秒转查询、原生下载取消确认、ask继续/取消、总预算|verified 本报告慢速下载/ask/故障场景；不声称穷尽全部竞态|
|R04全参数/前端兼容|107 schema、原版25项对照、MIME/文件/错误/经验；COMPATIBILITY|partial：代表性语义通过，全部边界组合未穷尽|
|R06数据/出站/产物|受控文件、独立身份、预览无脚本、DNS公共IP校验、流式配额、原子发布|partial：静态/HTTP拒绝与7项容器检查通过；公网正向及受限产品完整链路待验|

## 阶段门槛及后续执行

|阶段|当前结论|剩余出口|
|---|---|---|
|P0|blocked|Docker系统DNS将公网域名解析为198.18/15保留地址，禁止放松公共IP检查；需解决授权的DNS/网络环境|
|P1|partial|23工具及故障路径已实现通过；补充完整边界对照，与实际隔离报告合并验收|
|P2|partial|普通网页、历史公众号离线包及单篇新现场图文通过；折叠/跨页和未支持媒体仍保留范围限制|
|P3|partial|控制台/真实接手/两SDK/CLI/MCP已通过；受限产品正向链路未开放|
|P4|partial|Mac安装包与回退实现/实测完成；P0安全边界与残余兼容场景关闭前不宣布候选验收通过|
|P5|blocked|P4出口后再在日本独立部署；Windows实际测试机待提供，Linux/Windows准备脚本不等于验证|

先修复DNS环境并复验容器全部8项，再运行两个受限产品各自profile的采集/接手/文件及越权回归；随后补兼容边界场景并固定P4验收。只有P4通过才进行日本部署，保留原huashu试验目录。用户尚未答复的Windows环境问题保持待定。其他业务产品没有改造，没有公开发布。

自动审批曾拒绝启用Cloudflare DoH：尚未授权将目标域名元数据发送给这个外部DNS服务。未启用、未换用其他外部解析器规避审批、未放松私网和保留地址检查。该问题记录为环境/授权阻塞，不记为实现成功。

最终重新运行npm audit的动作也被自动审批拒绝，因依赖元数据外发到npm服务尚未获明确授权；未执行该次外发，不将其记为最终检查通过。固定依赖没有因此更换。
