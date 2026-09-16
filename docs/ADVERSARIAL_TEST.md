# laofu-browser 对抗性测试记录与结论

**简体中文** | [English](ADVERSARIAL_TEST.en.md)

- 日期：2026-09-15。
- 审计对象：本仓库 `fuyera/p4-macos` 分支提交 `592b5c9` 加当时未提交的工作区改动（扩展图标、住宅出口方案文档等），版本 0.1.0-dev.2；`runtime/engine` 为 2026-09-15T08:48Z 由当前 `scripts/build-engine.mjs` 生成。
- 对照标准：[DESIGN.md](DESIGN.md) 的 B01–B23 工具矩阵、L01–L07 特色能力、第 4 节运行能力、第 7 节接口与状态、第 8 节安全边界、R01–R08 复核结论；[LAOFU_BROWSER_BASELINE.json](LAOFU_BROWSER_BASELINE.json) 冻结 schema（23 工具 / 107 顶层参数 / 58 文件）。
- 方法：6 个并行对抗审计代理，按功能域分工攻击（可靠写入与控制权、工具参数覆盖、人工接手与限流、采集完整性、API 契约、安全边界），各自沿代码路径构造攻击场景并核对实现。

**性质声明：本报告是只读静态代码审计记录，不是运行时回归。** 审计期间未执行测试套件、未启动服务/浏览器；全部发现为代码级结论，标注了触发条件，**每项在修复前必须先以运行时回归复现确认**，不得直接计入验收通过或失败。这与本工程"行为测试和真实执行证据验收"的纪律方向一致：代码存在不等于现场通过，代码级疑点同样不等于现场故障。

## 总结论

1. **核心可靠性骨架经得起对抗。** 未发现任何越权访问路径、任何服务端自发的同命令双执行路径、任何把错误吞成 200 成功的主路径。防双执行链（受理先落盘 + 同键摘要冲突 + worker 双层 journal + suspended 永不重投 + 不确认停止不重分配）、控制权 fence 闭环、所有权校验全覆盖、出站边界双层执行（代理层 IP 固定 + 容器网络隔离）、只读角色白名单、HTML/SVG 预览隔离、日志脱敏、SSE 与状态同事务——均核对了实现位置，见"守住项清单"。
2. **发现 3 项 P1、20 项 P2、约 18 项 P3。** 集中模式非常一致：现有测试与回归只覆盖了主路径，缺陷几乎全部位于边缘分支（非微信站点、慢 SPA、CLI 入口、flow 内嵌 ask/reload、崩溃窗口、取消与并发的窄窗口）。
3. 3 项 P1 的共同主题是**把"不确定/不完整"报告成"已确认/完整"**：act 中断批次谎报 confirmed、错误页/骨架页产出"成功文章"、占位图计为成功图。这是对验收信任链最直接的威胁。

## 发现统计

| 级别 | 定义（沿用 DESIGN §13 口径） | 数量 |
|---|---|---|
| P1 | 可能导致重复外部提交、主要结果失真 | 3 |
| P2 | 兼容/验收遗漏、防御缺口，完整发布前必须处理 | 20 |
| P3 | 轻微不一致/运维债，登记备修 | 约 18 |

---

## P1 详细记录

### AT-P1-01 act 中断批次谎报 `effectState=confirmed`，可能诱导下游整批重发

- **违反条款**：L06"整批中断标记 unknown，禁止重放整批"；第 7 节 effectState 语义。
- **位置**：`runtime/engine/extension/background.js:1921`（仅 `code==='EFFECT_UNKNOWN'` 才置 `effectUnknown`）、`:1831-1838`（expect 未满足/零可归因变化的停机不带 code）、`:1853`（步骤异常只记 stopped）；`src/worker.ts:605-607`（`completed===false` → state=partial）、`:656-667`（仅 failed/effectUnknown 才 unknown，否则 confirmed）、`:258-268`（uncertain 只看外层 isError + TIMEOUT/INTERNAL/NO_EXTENSION，看不到 act 内部停机）；`src/broker.ts:204`（stopped=true → 不隔离 profile）。
- **机理**：act 批次某步引擎内超时/通道断开/零证据停机时，引擎回执 `completed:false` 但不带 `effectUnknown` 标志；worker 判 state=partial、effectState=confirmed，租约正常释放、profile 不隔离。
- **触发条件**：`act` 第 5/10 步引擎内 TIMEOUT——动作已发出、结果不可知。
- **危害链**：任务报告 `partial + confirmed` → 调用方依据 confirmed 认为已执行步骤安全 → 整批重发 → 第二次外部提交。服务端自身不重放，但该缺口主动诱导下游重发，并跳过 unknown 应触发的核验/隔离流程。
- **修复建议**：worker 对 `kind=command` 的写类工具、`completed===false` 的结果一律 `effectState=unknown` 并置 uncertain；或引擎对一切带 code 的非只读停机统一置 effectUnknown。
- **建议回归**：act 中途注入引擎 TIMEOUT，断言 effectState=unknown、profile 隔离、重投被拒。

### AT-P1-02 `accessState` 兜底 accessible + `complete_for_scope` 判据不足，错误页/骨架页可产出"成功文章"

- **违反条款**：L01"空正文、验证页不能生成成功文章"；R07；第 8 节完整性判定。
- **位置**：`src/article.ts:54-59`（命中 `article`/`main` 容器 + 文字>100 + 标题不含中文关键词黑名单即短路判 accessible）、`:80`（兜底 `return "accessible"`）、`:61-79`（关键词全部是中文/固定英文短语）、`:380`（`meta.length` 非零即过）；`src/article.ts:360-362`（loading 探测：readyState=complete 后骨架静止 ≥750ms 即 stable）、`:511-512`（`textCoverage = versionConsistent && stable ? "complete_for_scope" : "unknown"`）、`:560-568`。
- **触发条件**：①非微信站点 HTTP 200 的登录墙/未知文案错误页，文字>100 字符且不命中已枚举关键词；②慢 SPA：真实正文在 3 秒稳定窗口之后异步到达（慢接口、hydration），滚动探测仅 4 屏/12000px 与异步渲染无关。
- **危害链**：通过 EMPTY_ARTICLE 检查后照常冻结、渲染、上传 → `succeeded + complete_for_scope` + 空 warnings。与 AT-P1-03 叠加可产出"骨架 + 占位图"级别的完整报告，正是 R07 要求防住的结果。现有测试只覆盖已枚举关键词（`test/article.test.ts:39-46` 把短路顺序固化为预期）和"传输期间持续变化"（回归 `/changing`），未测晚到内容与未知文案。
- **修复建议**：分类改"正文存在 **且** 无墙特征"合取；去掉兜底 accessible（未知即 unknown）；textCoverage 增加"加载完成证据"维度（如网络空闲 + 正文高度稳定重检）。
- **建议回归**：英文长文案错误页 fixture（article 容器）断言不产出 succeeded；慢 SPA fixture（3-6 秒后注入正文）断言 not complete。

### AT-P1-03 懒加载占位图被计为成功图（条件触发）

- **违反条款**：L01"下载识别懒加载占位符"；mediaCoverage 分母真实性。
- **位置**：`src/article.ts:90-96`（src 取值优先级：无 data-* 惯例时占位 src 直接采用）、`:361`（滚动仅 4 屏/12000px）、`:472-483`（sharp 校验只验证"是合法图"）。
- **触发条件**：无 data-src 惯例的站点 + 页面长于 4 视口 + IntersectionObserver 懒加载 + 占位是合法光栅图（1x1 GIF/透明 PNG；SVG 占位会被格式白名单挡下）。
- **危害链**：占位符通过解码校验 → 写盘、记 sha256/宽高、计入 downloadedImages → 全部图"成功" + succeeded + complete_for_scope，真图从未获取。微信（data-src 惯例）不受影响、历史实测 11 图有效，但 L01 声称面向任意 URL。
- **修复建议**：对尺寸极小/同哈希大量重复/与 data-src 语义冲突的图片标记 suspected_placeholder 并降级为 partial；滚动探测按页面实际高度自适应。
- **建议回归**："前 4 屏占位 1x1 GIF、4 屏后懒加载真图"的 fixture，断言占位不被计为成功。

---

## P2 记录（按域分组）

### 域 A：可靠写入与控制权（L06 / 4.2 / 第 7 节）

**AT-P2-01 取消标记与终态转移非原子，且派发不查 cancelRequested。** `src/broker.ts:322-325`（`updateJob(cancelRequested)` 与 `transition(cancelled)` 两条独立提交）；`src/broker.ts:248-303`（tick 对 queued 任务派发前不检查 cancelRequested）。崩溃窗口内已取消任务会被执行，完成后才经 `:194-195` 自报 cancelled+unknown。修法：并入同一事务 + 派发分支补检查。

**AT-P2-02 resume 门禁弱于对外发布的状态，且先转态后发送。** `src/server.ts:191`（`resumeAllowed` 宣传含 `!profile.quarantined`），但 `src/broker.ts:342-358` 不检查隔离、不检查 worker 在线，且 `transition(running)` 发生在 `send` 之前——半开连接窗口内 resume 会产生"假 running"，直到墙钟超时才取消。不构成双执行，但与 API 宣传语义不一致。〔交叉验证项：两个代理独立发现〕

**AT-P2-03 幂等键按 kind 分成两个命名空间。** `src/store.ts:38`（`UNIQUE(kind,product_id,idem)`）+ `:228-231`。同一产品用同一 Idempotency-Key 先后创建 task 和 command，两条都受理并执行；DESIGN §7 的字面契约是"同键不同请求摘要返回冲突"（未按 kind 分离）。修法：产品内单一命名空间，或在 API.md 明示该语义。

### 域 B：工具覆盖与适配（B01–B23 / R04）

**AT-P2-04 分页 fetch 内联输出的截断元数据丢失。** `runtime/engine/src/mcp-server.js:570-572`：fetch 带 `pages` 且无 `binary` 时提前 return，不带 `_meta.laofu.output`；分页内联输出超 maxBody（默认 200000）时只在文本里写"…（超过 maxBody=…，后面 N 页没放进来）"（`:740`）→ worker 读不到结构化标志 → `truncated:false`、state=succeeded（`src/worker.ts:584,605-607`）。违反 §7"任何响应上限必须返回 truncated、原始总长度或续取信息"。同条件通用路径（`:667`）有正则补偿，唯独早退分支漏掉；带 savePath 时 artifactId 有返回，缺口仅限内联分支。

**AT-P2-05 upload 经 CLI 完全不可达。** `src/server.ts:589-593` 要求 `args.path` 必须伴随 `inputArtifacts.path`（artifactId），但 `src/cli.ts:348-352` 的 `call` 只发送 `{tool,args}`，无 inputArtifacts 通道——`cli call upload` 必被 INVALID_ARGUMENT 拒绝。B16 在 CLI 入口断供，违反 §4.3 CLI `call` 覆盖与 L02 四入口一致。MCP（`src/mcp.ts:103-107` 自动上传）与 SDK 均可达。〔交叉验证项：两个代理独立发现〕

**AT-P2-06 flow 内嵌 reload 后续步骤必败。** `chrome.runtime.reload()` 清空 `storage.session` 的 lbControl，worker 不在步骤间重新 `__lb_control` → reload 之后的 flow 步骤 lbGuard 抛 CONTROL_REVOKED，任务 failed/unknown。失败是显式的（不静默），但该组合语义相对上游变形，需在 COMPATIBILITY.md 登记或实现步骤间控制权重建。

### 域 C：人工接手与限流停止（L04 / L05）

**AT-P2-07 ask 交接后控制权永不回收。** `src/worker.ts:297-342`：ask() 面板就绪时 `browser.control(job, true)` 把扩展侧 `lbControl.cancelled` 置 true，但 resume/`ask_finish("continued")` 之后没有任何 `control(job, false)` 回收（仅 human() `:375` 与 execute() 起点 `:475` 有重置）。触发：owner 提交 `browser.flow@v1` 步骤为 `[..., ask, click, ...]`——人工点"继续"后，后续每步在扩展侧被拒，流程必然 partial/failed。`scripts/handoff-regression.mjs:177-197` 只测了独立 ask 命令，掩盖了此缺陷。

**AT-P2-08 冷却只读 `input.url`，命令/flow 通道绕过同站冷却。** `src/store.ts:184-199`：session 命令的 input 是 `{args,...}`、flow 是 `{steps,...}`，都无顶层 url，只剩 profileId 分支。站点 X 限流进入冷却后，经另一 profile 对 X 发 navigate/fetch 命令或 flow 步骤指向 X，完全不受约束。L05"停止该范围内自动尝试"在命令通道失效。修法：cooldown() 解析 `args.url` / `steps[].args.url`。

**AT-P2-09 交接"停止确认"只是写入回执，非在途动作停止回执（设计自认 R05 的残余）。** `src/worker.ts:311-334` + `runtime/engine/extension/background.js:300/1534/1543/1559`：lbGuard 在命令分发、act 每步、L1/L2 执行前后检查，但已越过 guard 的单个在途 DOM 动作/JS 可继续执行，与经 VNC 进入的人工输入并发。缓解存在（原生下载轮询复查 `:1965`），通用在途步骤无 quiescence fence。属已知设计边界的实现现状，登记为待改进。

### 域 D：采集完整性（L01 / R07）

**AT-P2-10 mediaCoverage 嵌入媒体只有总数。** `src/article.ts:115`（`$("video,audio,iframe,mpvoice,qqmusic").length`）、`:547`、`:597-599`（state 条件不含 media）。无类型区分、无逐项位置，含视频/音频卡片的页面照报 succeeded，违反 L01"未支持的数量及逐项位置""视频、音频、嵌入卡片必须标出"。

**AT-P2-11 noscript 先行删除使 discoveredImages 分母偏小。** `src/article.ts:85`（清理列表含 noscript）。把懒加载真实 `<img>` 放 noscript 的站点，这些图从清单静默消失——不算发现、不算失败、无占位。

**AT-P2-12 srcset 取书写顺序最后一档。** `src/article.ts:95-96`（`.split(",").at(-1)`）。srcset 规范不要求按宽度升序书写，可能下载低分辨率档当"原件"且无标记。

**AT-P2-13 textCoverage 三值枚举缺 partial，missingFragments 永远 null。** `src/article.ts:511-512`（二值）、`:536`（硬编码 null）。设计明确三值枚举与缺失片段；折叠/"阅读全文"状态只有固定字符串 `current_DOM_only`（`:534`），无展开动作记录（`:359` 注释明示不点击展开）。

**AT-P2-14 版本绑定证据弱。** `src/article.ts:390-395`（分块拼接无长度断言，marker 被页面脚本篡改后 slice 越界仅 `final.same` 一层兜底）、`:526/:529`（contentHash 与 documentRevision 是同一个 hash，纯冗余）、有序块 textHash 与整体哈希无组合/重建关系（核验方无法独立验证 manifest 版本=产物版本）、`:363` 与 `:385`（元信息 describe 与正文冻结之间无一致性检查，标题/作者跨版本窗口）。

**AT-P2-15 失败任务的半成品 artifact 对消费方可见。** `src/worker.ts:503-508`（逐文件上传，中途失败→job failed 但已传文件入库）、`src/server.ts:155,192`（viewJob 无条件列出该 job 全部 artifacts，可下载）。无 manifest、无 incomplete 标记的半成品图文包可被产品列出下载，违背"失败文件不可成为完整产物"的可见性要求，且占用配额直至手工删除。

**AT-P2-16 凭据与数据残留三项偏离。** ①"凭据原 URL 保存在受限元信息"未实现——任务结束原始 URL 无处可查，失败图"保留原地址"实为脱敏地址，带签名 query 的图 URL 无法重试（`src/article.ts:554-559`）；②`redactUrl` 只覆盖 query 与 userinfo，路径段凭据（`/s/{sig}`）与黑名单外键名不脱敏（`src/util.ts:66-82`）；③`src/worker.ts:256` journalFinish 把浏览器工具完整 result 写入 journal：fetch binary 的 result 含整图 base64（`runtime/engine/extension/background.js:2098-2102`）→ 产物原件完整拷贝进入无保留期限的 SQLite journal（任务目录会 rmSync，journal 不会）。

### 域 E：API 契约（L02 / 第 7 节）

**AT-P2-17 AUTH_REQUIRED 是死码。** `src/contracts.ts:280` 声明了 `AUTH_REQUIRED: "页面需要人工登录"`，全仓库零发射点。实际路径被 waiting_user + handoff reason、`ACCOUNT_VERIFICATION_REQUIRED`（`src/server.ts:603-607`）、`ACCESS_BLOCKED` 三个未冻结码分走且无映射说明。按冻结码表编程的消费者永远捕不到这个码。

**AT-P2-18 screenshot 无 savePath 时 base64 整体内联 JSON，无上限无产物化。** `runtime/engine/src/mcp-server.js:646-651`（`{type:'image', data:<base64>}`）、`src/server.ts:153-194`（viewJob 原样返回），唯一上限是 worker WebSocket maxPayload 32MB。违反"长输出保存产物，通过分页/流式读取"；download/fetch 带 savePath 的路径会产物化（`src/worker.ts:556-579`），唯独截图内联路径漏掉。

### 域 F：安全与部署（第 8 节 / R01 / R06）

**AT-P2-19 gateway 双宿到共享默认 bridge，18880/18881 以 0.0.0.0 无鉴权监听。** `deploy/isolated.mjs:138`（gateway 接共享 bridge 以便到 core）、`src/network.ts:62,121` 与 `src/relay.ts:74-75`（无鉴权监听）。同宿主机上任何加入默认 bridge 的容器可：把 18880 当匿名开放代理打公网；与 gateway→core 的明文 bearer 流量同处一个 L2。不是私网绕过（出站校验本身有效），但削弱隔离叙事。修法：gateway→core 独立网络，或监听绑定内网接口/加 token。**开放受限产品入口前必须处理。**

**AT-P2-20 临时区与失败目录无回收。** ①`src/worker.ts:675-695`：失败路径不清 job 目录，失败任务的正文/图片/zip 永久留在 worker 卷；②`src/artifacts.ts:30-38`：服务端崩溃残留 `.partial` 计入配额但无 janitor/启动清理（`test/boundaries.test.ts:116-133` 明示"retained interrupted files consume quota"）。违反 §8"临时区+保留期"意图，长跑磁盘耗尽。

---

## P3 简表

| 编号 | 发现 | 位置 |
|---|---|---|
| AT-P3-01 | Fastify 框架错误（如 body 超 2MB 的 413）统一返回 code=INTERNAL，4xx 携带 INTERNAL 码 | src/server.ts:83-89 |
| AT-P3-02 | tick 墙钟到期设 cancelRequested 不写事件（API 取消路径有 `cancel_requested` 事件） | src/broker.ts:234 vs :336-338 |
| AT-P3-03 | 已删除 artifact 直接 GET 返回 403 FORBIDDEN 而非明确删除标志（410）；deleted 标志只在任务视图可见 | src/artifacts.ts:189 |
| AT-P3-04 | capabilities 工具 status 为静态常量 `implemented_pending_environment_verification`，不随 worker 在线/profile 就绪组合变化；受限产品看不到自己 profile 的 worker 状态 | src/server.ts:252,248-251 |
| AT-P3-05 | handoff 票据明文出现在 POST 响应 JSON body；服务端不记 body，但反向代理/产品端日志可能落盘 | src/server.ts:992 |
| AT-P3-06 | worker result 使 waiting_user 直接进终态时不调 closeViewers，viewer 连接最长挂到 10 分钟到期（数据通路已断、输入被丢弃，仅连接语义残留） | src/broker.ts:157-206；src/server.ts:1043-1046 |
| AT-P3-07 | ask 的 until 自动判定可在无人操作时 resolve，worker 单方面继续而服务端状态仍 waiting_user 至 result 到达；与"人工输入不得隐式恢复自动化"的测试断言存在语义缝隙 | runtime background.js:2386-2390 |
| AT-P3-08 | ask() 路径不执行 humanWaitSeconds 预算，仅靠上游 ask timeout 与墙钟兜底；worker 离线时 cancelRequested 的 waiting_user 任务滞留驻留配额至墙钟 | src/worker.ts:297-342 |
| AT-P3-09 | 429 证据只采集导航请求（子资源/图片 429 不形成冷却证据）；recordCooldown 仅挂接 article.capture 的 result，命令/流程限流不建冷却 | src/browser.ts:159-171；src/broker.ts:158-166 |
| AT-P3-10 | GET /v1/tasks、/v1/tasks?includeCommands、GET /v1/artifacts 全量返回无分页 | src/server.ts:712-717,789-791 |
| AT-P3-11 | 截断探测依赖上游文案正则 `/已截断\|超过 maxBody/`；worker 错误消息被静默 slice(0,1000) 无标志 | runtime mcp-server.js:667；src/worker.ts:599-603 |
| AT-P3-12 | EXECUTION_MISMATCH 与 isolationVerified 依赖 worker 自报 environment/attest 字段，宜标注信任来源 | src/server.ts:374-410,650-659 |
| AT-P3-13 | store.holds() 定义后从未被调用（服务端无逐动作租约复查，实际强制点在引擎 fence，二者靠 job.fence 关联成立） | src/store.ts:394-399 |
| AT-P3-14 | recordCooldown 读-合-写无事务，并发下可能丢失 until 取 max | src/store.ts:153-175 |
| AT-P3-15 | MCP 提交阶段连接失败时外层 catch 只返回 problem(e)，不带 commandId 也不带"结果未知、先查记录"指引（指引只在 laofu_jobs 工具描述里） | src/mcp.ts:145-152 |
| AT-P3-16 | CLI capture 无 --key 时每次生成新键且不写恢复文件，脚本层重试会重复采集（已在 docs/API.md:39 如实声明为调用方责任） | src/cli.ts:314 |
| AT-P3-17 | 离线 ZIP 的 article.html 在 file:// 下打开的 CSP 行为未验证（回归只测了服务端 preview）；Markdown 正文 `\|`、行首 `#`/`-` 伪装等未覆盖 | src/article.ts:581-593,230 |
| AT-P3-18 | "必需项"未显式定义：succeeded 判定硬编码"图片全成功+版本一致+无下一页+稳定"，嵌入媒体/作者/发布时间缺失不降级 | src/article.ts:597-599 |

---

## 交叉验证项（≥2 个独立代理发现，置信度更高）

| 发现 | 发现方 |
|---|---|
| accessState 短路 + 兜底 accessible（AT-P1-02 的一部分） | 接手/限流域代理 + 采集完整性代理 |
| CLI 无法传 inputArtifacts → upload 断供（AT-P2-05） | 工具覆盖代理 + API 契约代理 |
| resume 先转态后发送、不查隔离/在线（AT-P2-02） | 可靠写入代理 + 接手/限流域代理 |

## 守住项清单（对抗确认的强项及机制位置）

- **防双执行**：受理先落盘（`src/store.ts:223-294` 事务内查重+插入）；同键不同摘要 IDEMPOTENCY_CONFLICT（`:232-238`）；发出后失联→suspended 不重发（`src/broker.ts:305-316`）；worker 双层 journal（job 级 `src/worker.ts:446-472`、步级 `:232-242`），非 fresh 非 confirmed 一律 EFFECT_UNKNOWN 拒绝重放；TS SDK 仅 GET 的 ECONNRESET/UND_ERR_SOCKET 单次重连、POST 永不重放（`src/client.ts:45-57`），Python/MCP/CLI 均为查询循环。
- **控制权 fence**：acquire 递增（`src/store.ts:372-388`）→ 派发携带（`src/broker.ts:288-292`）→ broker 验消息 fence（`:144`）→ 引擎 lbGuard 每命令/act 每步/L1/L2 前后/下载轮询核对（runtime background.js:300,1534,1543,1559,1765-1766,1965）；`__lb_control` 拒绝旧代次（`:1704-1709`）；租约无 TTL、不确认停止不重分配；server/worker 各自进程锁（`src/lock.ts` wx 创建）。
- **迟到证据**：终态只追加 late_evidence 不覆盖（`src/store.ts:327-333`；`src/broker.ts:167-187,145-148`）。
- **所有权**：task/command/session/artifact/SSE/worker 上报端点/handoff/learnings 全部过归属校验（`src/store.ts:300-305`；`src/artifacts.ts:187-192`；`src/server.ts:146-152,734,1007-1086,1095-1138,1199-1204`）；404/403 合并防枚举（`test/http.test.ts:56-60`）；SSE 每秒复验。
- **SSRF/出站**：解析一次→全部 A/AAAA 校验→固定字面 IP 连接，无二次解析（`src/network.ts:58-59,75-82,103-112`）；`<-loopback>` 强制代理（`src/browser.ts:147`）；禁 QUIC/WebRTC UDP（`:148-149`）；桥只接受 chrome-extension Origin + 配对 token timingSafeEqual（vendor bridge.js:104-108,233-236）；容器 internal 网络 + probe 实测（`deploy/isolated.mjs:78,160-161`）。
- **只读角色**：白名单 5 工具（snapshot/read_text/query/screenshot/status，`src/catalog.ts:30-36`）+ isolated profile + worker isolationVerified 三重（`src/server.ts:576-588`）；`__lb` 信封拒收（`:597-598,667-671`）；`args.path` 只认 artifactId（`:589-596`）。
- **HTML/SVG/预览**：cheerio 预剥离 + sanitize-html 白名单 + img src 强制相对（`src/article.ts:84-206`）；原件永远 attachment + `default-src 'none'; sandbox`（`src/server.ts:795-807`）；预览仅 worker 生成 article.html + 双层 CSP + iframe 无 allow-scripts（`:809-838`；`web/main.tsx:1003-1008`）；控制台无 dangerouslySetInnerHTML。
- **票据与接手主体**：handoff 票据 TTL≤60s 单次原子消费（`src/store.ts:90-101`；`src/server.ts:979-980`）；撤销断底层连接（`:997-1006` → `src/broker.ts:359-368` → `src/worker.ts:211-214`）；单控制者全段同步无竞态（`src/server.ts:1019-1033`）；每条输入消息复验。
- **限流主体**：Retry-After 双格式解析 + 与既有冷却取 max + SQLite 持久（`src/store.ts:130-182`）；冷却键 hash(origin|egressId) 本机全 profile 保守覆盖（`:184-199`，测试验证换产品/profile/worker 仍被拒）；停止后全库无换账号/伪造指纹/换出口代码。
- **产物发布**：`.partial`+fsync+rename 原子落盘、哈希不符 ARTIFACT_INCOMPLETE、MIME 魔数重检（`src/artifacts.ts:53-186`）；上传每 chunk 复查授权/撤销/配额（`:65-101`）；下载流式、删除销毁在途流（`:193-226`）；文件名/键强校验防穿越（`src/util.ts:32-43`；`src/artifacts.ts:18-22`）。
- **SSE**：事件与状态同一事务（`src/store.ts:324-342`）；Last-Event-ID/after 续传（`src/server.ts:732-766`）。
- **工具参数**：fetch/screenshot/upload/act/ask/network/eval/download 七族参数逐段核对无改名/丢弃/默认漂移；上游前端语义（分页循环、上传处理、download 移动、截图 MIME、长命令预算）保留于引擎前端；107 参数与冻结 schema 一致。
- **执行端**：worker 由 owner 创建 + 一次性 bearer + 重复连接拒绝 + 心跳 45s（`src/server.ts:341-373,1087-1094`；`src/broker.ts:48-54,210-213`）。

## 修复顺序建议与回归补项

1. **AT-P1-01**（act 谎报 confirmed）——唯一会主动诱导外部重复提交的缺口；补回归：act 中途引擎 TIMEOUT → 断言 unknown + 隔离 + 重投被拒。
2. **AT-P1-02 / AT-P1-03** 一起修——补两个 fixture：慢 SPA 样本（≥750ms 静止后 3-6 秒注入正文，可加"前 4 屏 1x1 占位、4 屏后懒加载真图"变体，断言占位哈希不进成功清单）；英文长文案 200 错误页（article 容器）断言不产出 succeeded。
3. **AT-P2-07（ask 控制权回收）+ AT-P2-08（冷却覆盖命令通道）**——各补一条回归即可暴露：flow 含 ask 步骤 + 后续步骤；站点冷却后经另一 profile 发 navigate/fetch/flow 断言 SITE_COOLDOWN。
4. **AT-P2-05（CLI inputArtifacts）**——对齐 `src/mcp.ts:103-107` 的自动上传。
5. 其余 P2 排入 dev.2 冻结后的批次；**AT-P2-19（gateway 网络拓扑）在开放受限产品入口前必须处理**；AT-P2-20（回收/janitor）在长跑部署前处理。
6. 上传中断注入回归：上传第 3 个 artifact 时断开 worker，断言任务非 succeeded 且产品侧不暴露无 manifest 的半成品（对应 AT-P2-15）。

## 方法论与局限

- 静态审计：沿代码路径人工/代理推演，未运行时复现。所有 P1/P2 均给出触发条件，但"触发条件在真实浏览器/网络下成立"需回归确认；不能排除存在未被推演到的路径，也不因未发现而证明无漏洞。
- 未覆盖：真实并发时序（SQLite 同步事务消解了大部分，但多进程边界只做了锁机制核对）、上游引擎 vendor 代码自身的内部缺陷（只审了补丁与适配层）、web/main.tsx 的 UI 逻辑细节。
- 基线时点：发现基于 2026-09-15 的 `592b5c9` + 未提交工作区；其后的代码变更可能已使个别条目失效，修复时以当前代码为准逐条复核。
- 六份原始代理报告的逐项结论（含全部 file:line 与推导）已全文收录/压缩于本文件；本文件不改动任何代码与证据索引。
