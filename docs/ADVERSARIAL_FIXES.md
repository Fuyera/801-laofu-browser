# 已确认缺陷修复记录

**简体中文** | [English](ADVERSARIAL_FIXES.en.md)

日期：2026-09-15。依据用户确认，仅修复 [逐项复核](ADVERSARIAL_REVIEW.md) 的 **28 条 A 类问题中成立的部分**。B 类 8 条、C 类 2 条和 D 类 3 条保持原裁定，不增加相应功能或改变契约。原始测试报告与复核记录保留为历史证据。

源码基线 `592b5c97530c3c716909fb3cda66bf6f5dceece7` 加本轮未提交改动；vendor 不可变，通过 build-engine 生成运行引擎。本次只在隔离环境验证，不等于日常 Chrome／日本服务器已经升级，也不是最终发布冻结。

## 逐项处理

|编号|修复结果|验证入口|
|---|---|---|
|AT-P1-01|act 已完成部分步骤再中断，partial/unknown，隔离控制器，不自动重放|浏览器 act 真实点击后 wait 超时，效果计数仅 1；Worker/Broker 回归|
|AT-P1-02|长登录墙进入人工等待，加载正文有界等待，未就绪拒绝交付|真实密码框登录墙；6 秒后才出现正文的页面|
|AT-P1-03|按实际加载继续滚动，1×1／2×2 残留图明确缺失|18,000px 远处图片取得 120px 原图；残留占位返回 partial|
|AT-P2-01|取消标志、事件与排队终态原子写入；历史裂开的取消记录不派发|事务故障注入、遗留 queued/cancelRequested 回归|
|AT-P2-02|resume 校验隔离与连接；发送不确定则挂起而非假 running|Broker 隔离／断线拒绝，状态不变|
|AT-P2-04|fetch.pages 提前返回分支补结构化截断及原长|真实分页 maxBody=300 返回 partial/truncated|
|AT-P2-05|CLI 本地文件上传转 artifact 输入，同键复用准备记录|真实 CLI 子进程→HTTP 文件上传两次调用，同命令同文件|
|AT-P2-06|普通 flow 预先拒绝 reload，独立维护命令保留|HTTP 400；Worker 防御拒绝且 not_started|
|AT-P2-07|ask 继续后回收自动控制；取消不继续|真实扩展面板继续后 click 成功；取消后下一步未发生|
|AT-P2-08|冷却解析命令 URL 和 flow 全部步骤 URL|同出口另一 profile 的命令／后续步骤 URL 被拒绝|
|AT-P2-10|嵌入媒体逐项记录类型、位置、未下载状态，正文保留占位说明|video/audio/iframe 三项真实页面；不强制含媒体任务失败|
|AT-P2-12|按 srcset 分辨率选候选，兼容显式原图地址|large 在前、small 在后并同时有 src 的测试|
|AT-P2-14|元信息与 DOM 同时冻结；精确分片长度；公开可复算产物哈希|冻结前变更标题正文返回同版内容但 partial；短 chunk 拒绝；HTML 哈希复算|
|AT-P2-15|图文包 staging 隐藏，全部引用与终态原子发布|真实采集第 2 次上传失败，无可见产物；提交失败事务回滚|
|AT-P2-16|URL 脱敏、受控原地址元信息；journal 去二进制并限期|合成路径/query 凭据脱敏、二进制不入 journal、过期保留去重墓碑|
|AT-P2-17|waiting_user 附 AUTH_REQUIRED，与失败时错误码映射|长登录墙真实人工门禁；不把正常等待改成失败|
|AT-P2-18|小截图内联，大截图 artifact；扩展输出硬上限|真实小 JPEG 和 full:true 大 PNG，响应受限、文件可读|
|AT-P2-19|网关仅监听私有接口，默认 bridge 不开放代理／relay|真实临时 Docker：邻居对两个地址×两个端口均拒绝，私有执行端正常出网|
|AT-P2-20|失败 jobs、终态 staged、陈旧 partial 回收；已交付文件保留|Worker 失败清理、24 小时回收、活动／较新文件保护|
|AT-P3-01|超大 JSON 分类为 LIMIT_EXCEEDED|真实 Fastify 413 注入|
|AT-P3-02|墙钟取消同步记录 cancel_requested|到期 tick 后持久标志与事件各可查|
|AT-P3-06|终态立即关闭接手 viewer|静默 viewer 终态关闭与 map 清空|
|AT-P3-08|flow ask 应用累计 humanWaitSeconds|5 秒预算结束即失败，后续 click 未执行|
|AT-P3-09|子资源及命令限流证据进入冷却并停止后续动作|真实资源 429/Retry-After；命令结果→持久 cooldown|
|AT-P3-10|任务／产物有界游标分页，控制台和 MCP 支持续页|55 条任务、20 条一页，游标续页无重复|
|AT-P3-11|长错误摘要标明截断，完整原文仍保留|1,800 字符→摘要 1,000，原文与原长可查|
|AT-P3-15|MCP 连接异常提供原关联键和先查后处置指引|真实 handler 注入“已受理但响应丢失”；确定 403 保留拒绝|
|AT-P3-17|GFM 表格单元格管道符转义|转换测试；Chromium file:// 离线图片正常显示|

## 验证与边界

第一批 15 组回归在旧实现上 0/15 通过，修复后 15/15 通过；随后增加边界覆盖，最终单元／接口合计 **50/50**，隔离浏览器 **19/19**，双身份 Docker **8/8**，真实接手 **2/2**，原版代表性同输入对照 **43/43**。

完整矩阵首轮 **22/24**，SDK 与双隔离组因工具链 PATH 选到 Python 3.9 而在安装阶段失败。使用现有 Python 3.11.15 后 SDK 通过；双隔离组又发现默认 DNS 把 example.com 解析到保留地址 198.18.1.151，按项目原有公共 DNS 配置补跑后通过。最终 **24 个矩阵项目均有通过证据**，不是把原始报告改成一次 24/24。

收尾补严恢复就绪门禁、产物引用唯一性，并加入来源字段脱敏标记；随后重新构建，运行上述最终 50 组测试、19 组浏览器场景、接手和最终镜像双隔离检查。安装组的候选包来自修复初版检查点，尚未冻结最终发布包。

全部归档与 SHA-256 见 [证据索引](evidence/adversarial-fixes/index.json)，阶段与最终源码哈希见 [验证汇总](evidence/adversarial-fixes/summary.json)。原始矩阵、失败原因和补跑证据分开保留。

复现命令（项目 Node 22，浏览器／Docker 需本机执行权限）：

```sh
node --import tsx --test test/*.test.ts
node --import tsx scripts/adversarial-browser-regression.mjs
LAOFU_TEST_IMAGE=laofu-browser:adversarial-fixes-20260915 node scripts/adversarial-docker-regression.mjs
```

浏览器脚本使用本机临时服务和全新 Chromium profile，人工继续／取消由合成触发器完成。Docker 使用可销毁网络与容器，公网验证仅测试 TCP CONNECT。未模拟所有真实站点、所有离线阅读器、32 MiB 截图内存耗尽、远端 bearer 窃取或生产部署。本次新增限期清理只涉及受控临时／内部回执数据；成功交付产物仍由用户主动删除。
