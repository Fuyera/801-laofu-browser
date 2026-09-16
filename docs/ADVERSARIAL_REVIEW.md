# 对抗报告逐项复核与裁定

**简体中文** | [English](ADVERSARIAL_REVIEW.en.md)

日期：2026-09-15。对象：[原始对抗报告](ADVERSARIAL_TEST.md) 的全部 **41 条**。原报告保持不变。

复核来源：`fuyera/p4-macos`，HEAD `592b5c97530c3c716909fb3cda66bf6f5dceece7` 加现有工作区；直接执行当前 `src/*.ts`，浏览器使用当前生成的 `runtime/engine`。本轮只添加诊断与审阅文档，没有修复业务代码，没有推送、发布或改动日常 Chrome。

## 结论与计数口径

上一轮只是抽样复核，不能回答“全部验证过”。本轮已逐条核对 41 条，并补充实际浏览器、Docker、HTTP、SQLite 和故障注入验证；**逐条复核不等于原报告每个后果都已经端到端复现**。

| 主裁定 | 条数 | 含义 |
| --- | ---: | --- |
| A：包含真实问题 | 28 | 至少有一项实现缺陷或明确契约缺口成立；部分条目混有错误表述，见逐项限定 |
| B：理解偏差／已约定行为 | 8 | 观察可能属实，但不能据此判为产品缺陷 |
| C：报告核心判断错误 | 2 | 漏读现有契约或采用当前架构不成立的并发前提 |
| D：需补证／明确契约 | 3 | 已核实机制或缺项，仍不足以确认报告所声称的产品故障 |
| 合计 | 41 | 每个编号只计一次；不按复合条目的子问题重复计数 |

28 条不等于 28 个独立重大缺陷，也不沿用原报告的全部严重性评级。采集完整性数项存在重叠；契约说明、错误码、事件和容量治理与会导致内容失真的问题应分别排序。

## 证据与范围

下文 `runtime/engine/` 源码位置是历史本地生成文件的引用；执行源码构建后才会生成该目录，不是 GitHub 中跟踪的文件。

- **U，原有测试**：当前源码执行 `node --import tsx --test test/*.test.ts`，**30/30 通过**。第一次沙箱内运行有一项因回环监听权限失败；取得测试权限后重跑全部通过。记录：测试输出（本地留档，不随仓库发布）。
- **C，定向代码执行**：21 组 SQLite／Broker／Worker／Fastify／MCP handler 探针，另 1 组表格转换探针，共 **22 组**。涉及崩溃窗口、断线和浏览器回执的地方使用明确故障注入，不能冒充实际进程崩溃或远端事故。记录：core-results.json（本地留档，不随仓库发布）、table-results.json（本地留档，不随仓库发布）。
- **B，真实浏览器**：**19 组有效定向场景**，使用全新独立 Chromium、真实生成扩展和 MCP、本机合成页面。人工继续由测试调用同一续接处理器，不代表真人 VNC 验收。记录：browser-results.json（本地留档，不随仓库发布）、act 定向补测（本地留档，不随仓库发布）。
- **D，真实 Docker**：1 组，两个新建临时容器按部署器的网络拓扑运行，当前 `src` 只读挂载；测试后删除本次容器及网络。记录：docker-results.json（本地留档，不随仓库发布）。
- **S，代码／契约核对**：用于无发射点、没有分页／保留策略、信任主体及接口约定等判断。没有把“没有某个函数调用”直接视为安全缺陷。

这些诊断断言是在核实当前行为，包含对缺陷行为的成功复现；**不能称为“新增回归全部通过，因此产品已修好”**。没有重新执行完整 22 组交付矩阵，也没有重测日本 VPS、真实公众号、日常账号或其他操作系统。

### 首次 act 探针的反证与修正

首次本机按钮只修改旁边的计数器，执行器在第一步就返回 `EFFECT_UNKNOWN`，未到达预期的第二步 wait。该次输出为 `partial + unknown + stopped:true`，原始失败断言和 Worker journal 已保留。调整**测试页面**为按钮自身文字发生明确变化后，仅重跑 act：第一步本机 POST 实际发生一次，第二步 wait 超时，第三步没有执行，返回 `partial + confirmed + completed:false + stopped:true`。未修改产品实现。

因此，能够确认“内部中断存在 confirmed 路径”，但不能声称“所有中断均 confirmed”，也没有复现“写 RPC 在途失联后造成第二次外部提交”。

## 全部 41 条裁定

### 原 P1 条目

| 编号 | 裁定 | 核实结果与限定 | 证据／源码 |
| --- | --- | --- | --- |
| AT-P1-01 | **A，部分成立** | 真实 act 在一次有页面证据的写动作后，内部 wait 超时，返回 `partial + confirmed`。与 DESIGN L06“尚无逐步检查点时，整批中断标记 unknown”的要求未对齐。真实未知效果路径也能返回 unknown；同幂等键不会自动重放。“主动诱导重复提交”“写在途 TIMEOUT 必定 confirmed”未被证明。不能把所有执行前拒绝也一律升级为 unknown。 | B act 补测、C adapter；[worker.ts](../src/worker.ts#L605)、[DESIGN L06](DESIGN.md#l06-可恢复任务与可靠写入) |
| AT-P1-02 | **A，成立** | 带 password 输入框、长英文登录文案的 article 页被采为 `succeeded / accessible / complete_for_scope`，warnings 为空。正文 6 秒后才出现的 fixture 在约 1.4 秒交付“Loading, please wait…”并报成功。证明存在误收录；不等于所有慢 SPA 都失败，也不意味着网络空闲可以证明全文完整。报告把 `main` 也写入 hasArticle 短路条件不准确：采集 describe 的 hasArticle 只检查 `#js_content,article`，main 仅在正文根节点选择中。 | B wall、slow；[article.ts](../src/article.ts#L35)、[describe](../src/article.ts#L280)、[loading](../src/article.ts#L359) |
| AT-P1-03 | **A，成立** | 长页面中 IntersectionObserver 的真实图片位于四屏之后。实际只滚动 4 次，真实图请求 0 次；1×1 透明 PNG 被计为成功图片，任务 succeeded。属于条件性懒加载缺陷；不能把所有小图一概判错，也不推翻之前真实图片有效的样本。 | B placeholder；[article.ts](../src/article.ts#L90)、[图片校验](../src/article.ts#L472) |

### 原 P2 条目

| 编号 | 裁定 | 核实结果与限定 | 证据／源码 |
| --- | --- | --- | --- |
| AT-P2-01 | **A，部分成立** | 在持久写入 cancelRequested 后、状态转移前注入中断，再执行 tick，queued 任务确实被派发。问题是取消持久化不原子和派发漏查。报告后果有两处错误：此时取消 HTTP 尚未成功回执；完成后实测是 `cancelled + confirmed`，不必然 unknown。未做 kill 精确命中该窗口的进程级试验。 | C Broker 注入；[broker.ts](../src/broker.ts#L248)、[cancel](../src/broker.ts#L320) |
| AT-P2-02 | **A，成立** | 已隔离 profile 的 waiting_user 可被 resume；模拟 socket 已关闭时 send 抛 WORKER_OFFLINE，但状态已变 running。与 resumeAllowed 的门禁不一致。属于状态／门禁缺陷，未证明双执行。 | C Broker；[broker.ts](../src/broker.ts#L342)、[viewJob](../src/server.ts#L188) |
| AT-P2-03 | **C，漏读现有契约** | 同产品、同键、不同 kind 可生成两条记录，执行已确认。但 API.md 第 39 行已经明确“相同身份/类型/键/请求返回同一 ID”，也不是报告所说的尚未明示。DESIGN 的概述应补齐命名空间以消除歧义；不能据此直接改唯一键并破坏现有调用约定。 | C Store、S 文档；[API.md](API.md#L39)、[store.ts](../src/store.ts#L223) |
| AT-P2-04 | **A，成立** | 真实分页 fetch 已在文本中报告超过 maxBody，但没有结构化 output 元信息；Worker 返回 succeeded、truncated=false。属于提前返回分支遗漏。 | B fetch；`../runtime/engine/src/mcp-server.js#L570`、[worker.ts](../src/worker.ts#L584) |
| AT-P2-05 | **A，成立** | 以 CLI 的实际 payload 形状调用真实 HTTP 路由，upload 被 INVALID_ARGUMENT 拒绝；CLI call 构造没有 inputArtifacts。CLI 源码与 HTTP 执行足以确认入口断供，本轮未额外启动 CLI 子进程做端到端上传。 | C Fastify、S CLI；[cli.ts](../src/cli.ts#L348)、[server.ts](../src/server.ts#L589) |
| AT-P2-06 | **A，成立，状态表述有误** | 真实 flow 的 reload 成功后，status 步骤返回 CONTROL_REVOKED，整条 flow **partial**。报告写成必然 failed/unknown 不准确。reload 本身在上游明确属于有破坏性的维护动作；应拒绝在普通 flow 中组合，或实现明确的升级续接协议，不能只假定它像页面 reload。 | B flow reload；[browser.ts](../src/browser.ts#L304)、[worker.ts](../src/worker.ts#L518) |
| AT-P2-07 | **A，成立** | 真实扩展 ask 面板进入 waiting_user，测试经 Worker 的继续处理器结束 ask，下一步 click 返回 CONTROL_REVOKED，flow partial。真实控制权回收缺失已复现；不只是 mock 结论。 | B flow ask、C control 序列；[worker.ts](../src/worker.ts#L297) |
| AT-P2-08 | **A，成立** | 同出口另一 profile 的顶层 input.url 被冷却拦截，args.url 和 steps[].args.url 均未被拦截。需要补命令和 flow 的站点范围解析。 | C Store；[store.ts](../src/store.ts#L184) |
| AT-P2-09 | **D，机制属实，人工竞争链未证实** | 真实延迟 JS 在 `browser.control(cancelled=true)` 回执后仍继续执行，证明该回执不是通用 JS 停止证明。但此探针直接并发调用底层适配器；没有经生产 Worker 的串行流程复现“实际进入人工接手时仍有旧写步骤在途”。原报告不能仅凭 guard 位置把完整人工竞争链当成已发生缺陷。应在 cancel／unknown／handoff 状态链中补端到端可达场景。 | B inflight、S Worker 串行流程；[worker.ts](../src/worker.ts#L297)、[browser.ts](../src/browser.ts#L264) |
| AT-P2-10 | **A，部分成立** | 视频、音频、iframe 合成页确实只有总数 3，没有逐项类型、位置及状态，未达到 L01 的逐项媒体说明要求。但 manifest **已经有未下载媒体 warning**；任务 succeeded 不等于宣称所有媒体均已下载。不能笼统改成“含任何视频就失败”。 | B media；[article.ts](../src/article.ts#L547)、[warnings](../src/article.ts#L565) |
| AT-P2-11 | **B，分母理解错误** | JavaScript 启用的真实页面中，noscript 内的 img 是回退文本，不是可见图片 DOM；样本中 fallback 元素根本不存在。删除 noscript 本身不能证明漏掉当前可见正文图片，否则可能重复计数。若某站把它用作真实懒加载数据，还需提供该站的转换逻辑与遗漏样本。 | B noscript、C prepareArticle；[article.ts](../src/article.ts#L85) |
| AT-P2-12 | **A，成立** | 输入顺序 `large 1600w, small 400w`，实际选择 small。最后一项不等于最高分辨率；另有 src 时当前逻辑甚至不会解析 srcset。应按明确的原图／展示图策略解析，不能把源代码排列顺序当尺寸证据。 | C prepareArticle；[article.ts](../src/article.ts#L95) |
| AT-P2-13 | **B，不能由未使用某枚举值推出缺陷** | 本轮实际有下一页的任务返回 job=partial、textCoverage=complete_for_scope，同时 pagination 明示下一页未采、missingFragments=null。当前文档范围完整与整条任务 partial 可以同时成立；null 没有伪装成“无缺失”。未展开和 current_DOM_only 也已明示。若要求定位全部折叠内容或全文片段，应先明确超出当前 DOM 的采集范围，不能仅因未输出 partial 字符串就判错误。 | B next page、S L01 范围；[article.ts](../src/article.ts#L511) |
| AT-P2-14 | **A，部分成立** | 在真实 describe 与 freeze 间改变页面，能交付旧标题＋新正文且 versionConsistent=true。注入短 chunk 也能无长度校验地成功，这是防御缺口，但不是自然网络截断已复现。contentHash 与 documentRevision 相同本身合法；块 hash 不能组合还原整体 hash 也不自动构成错误。真正问题是缺少可核验的同版绑定／源快照证据和元信息竞态。 | B metadata race、chunk 注入；[article.ts](../src/article.ts#L363)、[freeze](../src/article.ts#L385)、[manifest](../src/article.ts#L526) |
| AT-P2-15 | **A，部分成立** | 实际采集后让第 2 个文件上传失败：job=failed，已上传 article.md 仍能在 task.artifacts 列出并下载 200，manifest 未上传。与“包的完成标志和引用原子提交”有差距。但该文件自身已经完整校验，并非坏字节／半个文件；任务也没有假报 succeeded。应区分“完整单文件”和“未完成图文包”。 | B capture＋真实 artifact 存储＋上传故障注入；[worker.ts](../src/worker.ts#L503)、[server.ts](../src/server.ts#L153) |
| AT-P2-16 | **A，混合真假** | “原任务 URL 无处可查”被反证：任务终态仍保留 input.url。失败图片的原始抓取地址还可能在步骤 journal 参数／原始结果中，但没有结构化、受限、带期限的重试元信息。路径凭据及未匹配的 query 名实测不会脱敏；完整二进制回执 base64 会持久入 journal，缺少 TTL。不能将原 URL 保留与凭据隔离、消费侧脱敏视为同一件事。 | C URL、journal；[store.ts](../src/store.ts#L267)、[util.ts](../src/util.ts#L66)、[worker.ts](../src/worker.ts#L256) |
| AT-P2-17 | **A，契约缺口** | AUTH_REQUIRED 只有码表定义，无发射点；登录处理依赖 waiting_user 的 reason 或其他错误码。能确认冻结码表与实际协议缺少映射，不能解释为“登录功能完全不可用”。可通过定义正常等待与失败错误码之间的映射解决，而非机械把 waiting_user 改成错误。 | S 全 src 检索与状态路径；[contracts.ts](../src/contracts.ts#L280)、[article.ts](../src/article.ts#L304) |
| AT-P2-18 | **A，有条件的输出治理缺口** | 普通截图实际以内联 base64 返回，本次长度 39,520、artifacts=0。保留上游 image content 本身是兼容行为；缺口是较大输出没有应用层大小／产物化策略，最终只能碰传输上限。没有做 32 MiB 截图或内存耗尽实验，不能称普通截图已经导致故障。 | B screenshot、S 输出路径；`../runtime/engine/src/mcp-server.js#L646`、[worker.ts](../src/worker.ts#L556) |
| AT-P2-19 | **A，匿名代理暴露已实测** | 默认 bridge 邻居无凭据对 18880 发 CONNECT 到公网 1.1.1.1:443，实际得到 200；私网目标仍 403，控制路由仍 403。18881 合法 relay 路由会转发到故意不存在的 core 并得到 502，证明 relay 自身不验权，**不证明 core 鉴权可绕过**。同 L2 不等于已能监听 bearer；未做流量窃取试验。 | D 临时 Docker 拓扑；[isolated.mjs](../deploy/isolated.mjs#L138)、[network.ts](../src/network.ts#L62)、[relay.ts](../src/relay.ts#L74) |
| AT-P2-20 | **A，成立** | Worker 异常分支实际留下 jobs 目录；未找到失败目录／启动残留 partial 的期限回收机制。现有边界测试明确证明残留 partial 占用配额，属于安全计费行为；缺的是回收策略，不能将“计入额度”本身算错。本轮未用长时间灌盘证明磁盘最终耗尽。 | C Worker、U retained interrupted files、S 清理路径；[worker.ts](../src/worker.ts#L675)、[artifacts.ts](../src/artifacts.ts#L30) |

### 原 P3 条目

| 编号 | 裁定 | 核实结果与限定 | 证据／源码 |
| --- | --- | --- | --- |
| AT-P3-01 | **A，成立** | 实际超 2 MiB JSON 返回 HTTP 413，但 error.code=INTERNAL，错误分类与客户端处理不一致。 | C Fastify；[server.ts](../src/server.ts#L83) |
| AT-P3-02 | **A，成立** | 实际 wall 到期设置 cancelRequested、发取消消息，但没有 cancel_requested 事件。属于状态变更的事件可见性缺口，不是“取消没有执行”。 | C Broker tick；[broker.ts](../src/broker.ts#L234) |
| AT-P3-03 | **B，已约定安全行为** | 已删除文件 GET 确实 403；不存在／其他所有者／已删除资源共用拒绝，避免枚举。任务视图有 deleted 信息。未找到必须对直接 GET 返回 410 的契约，不能把个人偏好的状态码当缺陷。 | C HTTP、U 所有权测试；[artifacts.ts](../src/artifacts.ts#L187)、[DESIGN.md](DESIGN.md#L240) |
| AT-P3-04 | **D，需明确能力状态契约** | tools.status 确实静态，但 capabilities 同时返回按权限过滤的 profiles，其中有 ready、quarantined、workerId；并不是受限调用方完全看不到就绪状态。尚缺工具与目标环境支持的精细对应。是否新增动态工具状态、环境版本信息应先明确；没有证据证明该常量将不可用工具误报为可用。 | C capabilities＋S 过滤；[server.ts](../src/server.ts#L240) |
| AT-P3-05 | **B，假设性日志风险非漏洞证据** | 授权方 JSON 获得票据属正常协议；实际具备 no-store、短 TTL、单次使用，服务日志不记 body。反向代理／客户端“可能记录”不能证明本项目凭据泄漏。仍需按部署配置保护 TLS 和日志，但不能凭票据出现在响应体就判漏洞。 | C handoff headers、U ticket 复用；[server.ts](../src/server.ts#L979) |
| AT-P3-06 | **A，成立，影响有限** | Broker 接收等待任务的终态 result 后，viewers map 与 socket 没立即关闭，探针复现。Worker 已关闭显示；客户端下一次输入会被服务端状态检查关闭，静默连接才可能留到超时。不是终态后仍能持续输入。 | C Broker、S WebSocket 状态门禁；[broker.ts](../src/broker.ts#L157)、[server.ts](../src/server.ts#L1051) |
| AT-P3-07 | **B，显式 until 属合法续接** | 真实 ask 在调用方提供的 selectorExists 命中后自动 completed，无人工点击。上游工具 schema 与 API.md 明确允许“确认或满足原 ask 条件”继续，不是未经授权的隐式恢复。flow 的恢复问题已单独记 AT-P2-07。 | B until、S API／schema；[API.md](API.md#L45) |
| AT-P3-08 | **A，混合真假** | 合法 humanWaitSeconds=5 的真实 flow ask 等待约 6.7 秒后仍 succeeded，预算确实未应用。离线部分报告不准确：socket close 将 waiting_user 转 suspended，且 tick 会跳过 suspended，并非停在 waiting_user 等到墙钟。未知任务保留驻留额度属于保守恢复策略，不宜自动清掉。 | B budget、C disconnect；[worker.ts](../src/worker.ts#L297)、[broker.ts](../src/broker.ts#L62) |
| AT-P3-09 | **A，成立** | 真实页面子资源 fetch 得到 429，但 rateLimit 没记录；注入 command RATE_LIMITED result 也不创建冷却。导航／article.capture 之外的限流证据覆盖不足。 | B resource429、C command result；[browser.ts](../src/browser.ts#L159)、[broker.ts](../src/broker.ts#L158) |
| AT-P3-10 | **A，容量治理缺口** | tasks、includeCommands、artifacts 均返回全量 items，无分页／总输出上限。当前小样本可正常返回；没有负载证据声称已经 OOM 或超时。 | C HTTP、S 列表实现；[server.ts](../src/server.ts#L712)、[artifacts list](../src/server.ts#L789) |
| AT-P3-11 | **A，部分成立，报告夸大丢失** | 1,800 字符工具错误的摘要实际切到 1,000，未单独标记，但完整原始 content 仍保留在 result，并非不可恢复丢失。通用截断检测先读 data.truncated，正则是补偿，不是唯一来源。分页早退缺口另见 AT-P2-04。 | C Worker error、S 生成前端；[worker.ts](../src/worker.ts#L599) |
| AT-P3-12 | **B，受信主体边界** | environment 来自受信 Worker，isolation attestation 必须经 owner 路由，且检查 bootId 等字段；受限产品实际调用 attest 返回 403。不是普通 Worker 自注册便能伪造隔离。本系统没有硬件远程证明承诺；如要抵御已受控 owner／Worker，应另定威胁模型。 | C owner gate、S attestation；[server.ts](../src/server.ts#L374) |
| AT-P3-13 | **B，未调用函数不构成控制失效** | holds 在生产路径未调用属实，但 acquire、fence、引擎 guard 才是当前强制链。已有旧代次、取消和未知写回归；不能据一个备用方法未调用判定没有租约保护。可以清理死代码，不应因此加不必要的逐动作远程调用。 | S 调用链、U lease 与 journal；[store.ts](../src/store.ts#L372)、[broker.ts](../src/broker.ts#L288) |
| AT-P3-14 | **C，并发前提错误** | recordCooldown 是同步 SQLite 读写、中间无 await；正式服务入口用进程锁独占目录。当前支持的单进程模型中不存在报告假设的并发插入窗口。实测较短 Retry-After 不覆盖较长 until，第二进程锁被拒。若将来支持多服务进程共享数据库，再增加事务／CAS。 | C Store 与锁、S 调用点；[store.ts](../src/store.ts#L130)、[cli.ts](../src/cli.ts#L115) |
| AT-P3-15 | **A，成立** | 在实际 MCP handler 中模拟提交已受理但响应丢失，最终只返回 INTERNAL，缺 commandId／稳定关联键以及“结果未知、先查记录”指引。已有 laofu_jobs 入口，但本次失败回执没有告诉调用方使用。没有实际切断 MCP 管道；此处是 handler 级故障注入。 | C MCP handler；[mcp.ts](../src/mcp.ts#L145)、[DESIGN.md](DESIGN.md#L238) |
| AT-P3-16 | **B，已披露的调用方责任** | CLI capture 不带 --key 每次创建新采集确实如此；API.md 已明确需要去重时保存并传入 --key，且采集不是外部发布动作。可改善恢复体验，不能说同键幂等失效或服务端自动重放。 | S CLI／契约、U 同键去重；[cli.ts](../src/cli.ts#L314)、[API.md](API.md#L39) |
| AT-P3-17 | **A，补测发现具体缺陷** | Chromium file:// 下实际显示包内 PNG，CSP 存在；普通段落的 #、- 和代码块样本保留正确。另测表格单元格 `a \| b` 的原始 HTML 文本，输出未转义的管道符，导致 Markdown 列错位：这是真实格式转换缺陷。原报告只是说未覆盖，不能把所有列举场景都算失败，也不能把本轮 Chromium 结果推广到所有离线阅读器。 | B offline／ordinary Markdown、C table；[article.ts](../src/article.ts#L119)、[GFM 表格规范](https://github.github.com/gfm/#tables-extension-) |
| AT-P3-18 | **D，必需项定义需补齐** | 图片要求有 downloadImages 参数；是否必须包含作者、发布时间及嵌入媒体，没有同等明确的请求／成功契约。真实含媒体且作者为空的样本 succeeded，同时有未下载媒体 warning。需要明确“哪些字段缺失必须 partial”，不能自行断言所有没有作者的网页都是采集失败。与 AT-P2-10 的媒体逐项说明缺失区分处理。 | B media、S CaptureRequest／L01；[article.ts](../src/article.ts#L597)、[DESIGN.md](DESIGN.md#L109) |

## 原报告还需要改正的总体表述

1. **“现有测试只覆盖主路径”错误。** 当前测试和历史脚本包含服务在外部效果后被杀、act 中途取消、桥在效果后失联、身份撤销、上传中断／超限和旧命令禁止重放。30/30 通过不消除本轮新发现，但也不能抹去已有故障覆盖。
2. **静态审计不能证明“没有任何越权路径”“全覆盖”“核心经得起对抗”。** 可以写“在本轮所读代码范围未发现”，不能当作全局安全证明。6 个代理得出相似意见也不是运行证据，原文未附可独立复核的六份报告。
3. **观察、风险推演、复现状态、严重性必须分开。** 原报告虽开头已声明静态审计，正文仍多处使用确定故障和必然后果表述。本轮实测证明其中相当部分有价值，同时否定若干前提和因果链。
4. **协议确认与外部业务成功不可混淆。** confirmed 不承诺第三方业务最终入账；不同新幂等键也不等于服务自动重放。应修复明确的批次中断契约／控制权问题，但不要制造无限隔离或把执行前拒绝都当未知写。

## 建议处理顺序与仍需补证

优先修复已经触及实际输出与可执行流程的项目：错误／加载页误采、懒加载占位图、元信息同版绑定、分页 fetch 截断、ask／reload flow、冷却的命令通道、CLI upload。表格管道符也应进入内容语义回归。取消原子性和 resume 门禁应纳入故障状态回归；act 需先明确批次与步骤的确认语义，保留不重放原则。

开放受限产品前处理 Docker 匿名代理暴露；长跑前补失败目录、产物和 journal 的期限与容量策略。其余事件、错误码、列表分页、截图大输出属于明确的协议或运维改进，不宜统一按重大安全故障排序。

仍未完成的验证／决策是：AT-P2-09 在正式任务状态链中复现人工接手与旧写动作并发；AT-P3-04 明确工具状态与 profile 就绪／环境支持的关系；AT-P3-18 定义采集必需项。对于已确认条目，写 RPC 真正在途断线导致重复外部提交、真实长时间磁盘耗尽、超大截图内存压力、bearer 窃取等报告后果，本轮也没有提供证明，不应写成已经发生。

## 复现入口

从仓库根目录执行；使用项目 Node 22。诊断脚本只操作它们创建的独立状态。浏览器和 Docker 脚本需要本机进程／网络权限。

```sh
.runtime/node-v22.23.2-darwin-arm64/bin/node --import tsx workspace/adversarial-review/verify-core.mjs
.runtime/node-v22.23.2-darwin-arm64/bin/node --import tsx workspace/adversarial-review/verify-browser.mjs
CHECK_FILTER=AT-P1-01 .runtime/node-v22.23.2-darwin-arm64/bin/node --import tsx workspace/adversarial-review/verify-browser.mjs
.runtime/node-v22.23.2-darwin-arm64/bin/node --import tsx workspace/adversarial-review/verify-table.mjs
.runtime/node-v22.23.2-darwin-arm64/bin/node workspace/adversarial-review/verify-docker.mjs
```

脚本、机器可读观察结果和版本哈希索引位于 workspace/adversarial-review（本地留档，不随仓库发布）。该目录属于本地证据，默认不进入发布包；若后续需要提交审阅结论，应同时选择性归档这些证据。
