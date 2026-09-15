# HTTP、SDK、MCP 与 CLI 契约

API路径统一使用 `/v1`。可执行请求验证来自 `src/contracts.ts`，OpenAPI由真实Fastify路由导出为 `openapi.json`，请求/响应和错误定义见 `schemas.json`。冻结原始23工具 schema 没有增加幂等参数，107项参数定义与上游一致。

## 认证与权限

每个HTTP接口（健康探针除外）需要 `Authorization: Bearer <product-token>` 或本机管理Cookie。管理Cookie由10分钟一次性初始化票据换取，HttpOnly、SameSite=Strict，有效8小时。默认仅监听loopback。产品凭据独立吊销；所有者的日常Chrome不能授予产品身份。

|用途|接口|
|---|---|
|能力与环境|`GET /v1/capabilities`、`GET /v1/profiles`、`GET /v1/diagnostics`|
|产品凭据|`GET/POST /v1/admin/products`；`POST /v1/admin/products/:id/rotate`；`DELETE /v1/admin/products/:id`|
|执行端|`GET/POST /v1/admin/workers`；`DELETE /v1/admin/workers/:id`；`POST /v1/admin/workers/:id/attest`|
|浏览器授权|`PATCH /v1/admin/profiles/:id`；恢复已隔离配置用 `POST /v1/admin/profiles/:id/recover`|
|会话|`POST /v1/sessions`；`GET/DELETE /v1/sessions/:id`；`GET /v1/sessions/:id/commands`|
|原始工具|`POST /v1/sessions/:id/commands`；`GET /v1/commands/:id`；`POST /v1/commands/:id/cancel`|
|任务|`POST/GET /v1/tasks`；`GET /v1/tasks/:id`；`POST /v1/tasks/:id/cancel`、`/resume`；`GET /v1/tasks/:id/events`|
|文件|`POST/GET /v1/artifacts`；`GET/DELETE /v1/artifacts/:id`；`GET /v1/artifacts/:id/content`、`/preview`|
|接手|`POST /v1/tasks/:id/handoffs`；`DELETE /v1/tasks/:id/handoffs/:handoff`；`WS /v1/handoffs/:id/socket`|
|经验|`GET /v1/learnings?domain=...`；`PUT /v1/learnings/:domain`；`POST /v1/learnings/:domain/restore`|

`GET /v1/tasks?includeCommands=1` 供控制台/MCP找回同一身份的全部任务与命令。`/tasks/:id/resume`和接手入口也接受等待人工的命令ID。读取任务列表默认只列高层任务。SSE支持事件ID续读，凭据失效后关闭流。

受限产品初始权限为 `article.capture`、`artifacts.write`；可另外授权 `browser.read`、`learnings.write`。`browser.read`只包含 snapshot、read_text、query、screenshot、status。任意脚本、写动作、跨标签页管理仅向所有者开放。受限产品必须独占一个已经通过隔离实测的profile，浏览器数据不能改授另一产品；重启执行端后隔离报告需重新绑定启动实例。

## 请求、状态与幂等

```http
POST /v1/tasks
Authorization: Bearer <product-token>
Idempotency-Key: caller-saved-stable-key
Content-Type: application/json

{"type":"article.capture@v1","execution":{"profileId":"prf_...","mode":"desktop"},"input":{"url":"https://example.com/article","downloadImages":true},"requestId":"consumer-request-001"}
```

HTTP任务和原始命令立即返回202及持久ID。MCP原始命令最多等待30秒，随后返回可查询的任务状态；SDK的wait可等待更久，遇到人工等待、挂起或终态立即交还调用程序。关闭连接不代表取消。

原始命令形状：`{"tool":"click","args":{"tabId":123,"selector":"#button"},"inputArtifacts":{},"requestId":"caller-id"}`。幂等键放在请求头，预算与requestId在工具参数之外。相同身份/类型/键/请求返回同一ID；同键不同请求返回409。TS SDK 仅对 GET 读取遇到 ECONNRESET / UND_ERR_SOCKET 时重连一次；POST、写请求与其他错误不自动重试。SDK不会替调用方生成新键重试未知写操作。CLI `call` 的键先写入本机 `cli-requests`，多次 `call` 复用产品/profile对应的会话，也可指定 `--session`。CLI `capture` 未传 `--key` 时每次生成新键，且不写入上述恢复文件；需要避免重复采集时必须显式保存并传入 `--key`。

|state|含义|
|---|---|
|queued / running|排队或执行中|
|waiting_user|自动操作已停，等待本人操作；必须确认或满足原ask条件才能继续|
|suspended|执行端/服务失联，旧效果待核验；不自动重放|
|succeeded|本次声明范围及必需项满足，不代表第三方业务最终入账|
|partial|有可用结果，但缺图、截断、页面变化或批处理未全部完成|
|failed|没有可接受完成结果，查看error与原始工具返回|
|cancelled|取消已收口；可能已有外部效果，仍须查看effectState|

`effectState = not_started | started | confirmed | unknown` 与任务状态分别判断。`confirmed`确认执行回执；写工具的 `externalEffects.outcome=not_independently_verified` 明确未核验第三方最终业务结果。批处理内部效果未知会向上报告unknown。取消先停止派发、撤销控制，再等在途停止确认；无法确认时profile保持隔离。

## 文件与完整性

上传使用application/octet-stream，`X-Filename`为编码后的纯文件名，`X-Mime-Type`可选，`X-SHA256`可选。成功后返回artifactId、字节数与哈希。原工具文件输入通过 `inputArtifacts.path=artifactId` 传入；HTTP不接受调用方的主机绝对路径。MCP在自身受信任宿主处理本地路径，再通过产物API传输。

下载提供Content-Length、X-SHA256及附件头；SDK流式接收、完整性校验后原子发布目标文件。删除立即使资源不可访问。上传中断、坏哈希、预算、配额或磁盘错误不会创建标记完整的文件。原生下载默认独立512MiB上限；拖放保留原版48MiB上限。

article.capture默认内容预算50MiB。正文从同一冻结DOM分块读取，记录版本哈希、有序块、图片顺序和原图SHA-256；中途变化返回partial。manifest中的complete_for_scope仅表示当前已授权DOM范围；折叠内容、跨页内容和未知分母不声称100%。下一页被检测但未采集时返回partial。所有文章均生成Markdown、安全HTML、manifest和相对图片路径ZIP。安全预览仅开放服务生成的HTML，禁用脚本、表单及外部资源。

## SDK

```typescript
import { BrowserClient } from '@laofu/browser';
const browser = new BrowserClient(process.env.LAOFU_URL!, process.env.LAOFU_TOKEN!);
const task = await browser.submitTask({type:'article.capture@v1', execution:{profileId:process.env.LAOFU_PROFILE!}, input:{url:'https://example.com/article'}}, 'stored-key-001');
const result = await browser.wait(task.id);
if (result.state === 'succeeded' || result.state === 'partial') {
  const zip = result.artifacts.find(a => a.filename.endsWith('.zip'));
  if (zip) await browser.download(zip.id, './article.zip');
}
```

Python同一契约使用 `BrowserClient.submit_task`、`wait`、`upload`、`download`、`cancel`、`resume`。`examples/consumer.*` 是独立安装验收程序，依赖自建验收站；不要把验收站的unlock步骤当作真实登录功能。

MCP保留23原工具，另提供 laofu_task、laofu_job、laofu_jobs、laofu_cancel、laofu_resume。分页与本地文件行为由同一适配器实现，不另写第二套浏览器动作。

## dev.2 容量、账号与生命周期

- `POST /v1/admin/products` 可带 `limits`；`PATCH /v1/admin/products/:id` 更新同一对象。字段为 `artifactBytes`（默认 2 GiB，范围 1 KiB–10 GiB）、`maxQueued`（默认 20）和 `maxResident`（默认 24，含排队、执行、等待及挂起；后二者范围 1–1000）。全局 10 GiB 同时生效。原幂等键的相同请求始终返回原 ID；新增超额工作返回 `PRODUCT_QUEUE_FULL` / `PRODUCT_QUOTA_EXCEEDED`。
- task `limits.maxTabs` 默认 8，范围 1–50；新建采集页前计数，成功交付后回收本任务新建页。原有页面不自动清理。
- 所有者 `GET/PUT /v1/admin/profiles/:id/account-policy` 管理 `{mode:"anonymous"|"required", origins:["https://example.com"], selector?, attribute?, expectedHash?}`。`origins` 为精确 origin，required 至少一个；指纹为配置元素的指定属性或 textContent 去首尾空白后的 SHA-256。原文账号值不放进任务结果。默认 anonymous 表示任务不要求账号，不保证浏览器没有 Cookie。修改规则会停止该 profile 的未结束任务；重复保存相同规则不停止任务。
- required 任务在打开目标、加载和提取前验证站点；账号错配/未知进入人工等待，核验通过才交付。仅接受受控配置，不接受调用者注入核验脚本。受限身份不能在 required profile 上用原始读取命令绕过核验。
- `GET /v1/admin/cooldowns` 列出冷却；所有者 `POST /v1/admin/cooldowns/:id/release` 明确解除。服务在受理、执行及继续时检查；新的幂等键、同出口的其他产品和服务重启都不能绕过。HTTP 429 的实际响应头经浏览器记录；`error.details` 带 `until`、`retryAfter` 或冷却 ID。没有可信恢复时间则 until 为 null，必须明确解除；旧任务不自动重放。
- `POST /v1/tasks/:id/handoffs` 返回 `ticket`、`ticketExpiresAt`，并为浏览器设置 HttpOnly、SameSite=Strict 的专用 Cookie。票据最多 60 秒、单次兑换，绑定当前身份/任务/profile；非浏览器 WebSocket 使用原鉴权加 `x-handoff-ticket` 请求头。票据不放 URL，断线后重新 POST 领取。handoff ID 本身不能代替票据。
- 产物保留 `metadata.declaredMime`，实际识别不明时为 `application/octet-stream`。删除/吊销中止未完成的服务端下载；上传每块及发布前重新核验授权。任务 `artifacts` 和 `result.artifacts` 保留 deleted 状态；已下载的客户端字节不能撤回。
- `/healthz` 和 `/v1/capabilities` 提供软件 `version`、`apiVersion:v1` 与 `build`；worker 报告同一构建字段。版本输出不能代替对应执行环境的通过报告。
