# 安装、隔离部署和故障处理

当前预览版面向 macOS arm64，固定包与版本对应的验收记录见 [GitHub Releases](https://github.com/Fuyera/801-laofu-browser/releases)。Ubuntu24.04 x86_64、Windows11 x86_64尚未实际验收，不能把Mac Docker内的Linux arm64结果算成这些目标系统通过。

日常登录、采集和人工接手见 [用户指南](USER_GUIDE.md)，源码与测试环境见 [研发指南](DEVELOPMENT.md)。dev.3 的最终安装包、两套 SDK 与日常 Chrome 停止／重连均已验收，详见[测试报告](TEST_REPORT.md)。Docker 隔离保留源码和既有验证记录，本次预览 Release 不附 Docker 镜像包。

## 固定Mac制品

`laofu-browser-0.1.0-dev.3-macos-arm64.tar.gz` 包含源码、锁文件、生成扩展、服务、控制台、Node22.23.2、Chromium及依赖。旁边的sha256校验包完整性；它不等于第三方签名。RELEASE.json保存来源提交、工作区是否有未提交改动、逐文件哈希及平台/数据库范围。包外DELIVERY.json记录各交付文件的构建提交、哈希及验证结果；固定包不允许同发行标识替换内容；重建测试只写入候选目录。包不包含本机账号、浏览器profile或测试运行凭据。

先在下载目录校验与解压：

```sh
shasum -a 256 -c laofu-browser-0.1.0-dev.3-macos-arm64.tar.gz.sha256
tar -xzf laofu-browser-0.1.0-dev.3-macos-arm64.tar.gz
```

解压后可直接运行`bin/laofu-browser`；不需要全局安装npm包。版本管理器用固定Node运行：

```sh
/解压目录/node/bin/node /解压目录/deploy/manage.mjs install --source /解压目录 --prefix /本人选择的/laofu-browser
/解压目录/node/bin/node /解压目录/deploy/manage.mjs start --prefix /本人选择的/laofu-browser
/解压目录/node/bin/node /解压目录/deploy/manage.mjs status --prefix /本人选择的/laofu-browser
```

安装目录包含`releases/`和独立`state/`。启动默认仅loopback、需要鉴权。用当前发行目录的`bin/laofu-browser console-login --home /安装目录/state`获取控制台一次性地址。停止用manage.mjs stop；不会关闭用户其他Chrome或删除成果。

升级仍执行install，源指向新的固定包。先校验全部文件和平台，再停止本安装进程、备份数据库和配置、检查schema兼容、切换版本；新版本启动失败时恢复旧程序。`rollback --release <releaseId>`切换到已有兼容版本。**回退程序不回滚命令/效果/幂等记录**，以免把已经提交过的操作重新当作未执行。旧 dev.1 仅作档案，不用于打开 dev.2 的状态；历史降级兼容未验收。schema更高的状态不可由旧程序打开；需要单独制定数据迁移，当前版本不会自动迁移或恢复旧生产数据。

备份命令要求原进程已停止。数据库备份不含大体积浏览器profile和产物，它们保留原路径。需要灾难恢复备份时，应在全部执行停止后，由本人同时备份state与每个执行端目录。

## 可选自启动与宿主

`deploy/service-files.mjs --root /发行目录 --home /状态目录 --output /配置输出目录 [--config /执行端配置.json]` 只生成配置，不注册自启动。Mac输出launchd plist，Linux输出user systemd unit，Windows输出登录会话计划任务脚本。生成后由本人选择是否启用；不要同时用local.mjs和服务管理器启动同一状态目录。Mac启用示例为`launchctl bootstrap gui/$(id -u) /具体plist`；停止用相同路径的`launchctl bootout`。需要桌面接手的执行端应在本人的图形登录会话启动。

`bin/laofu-browser install`仅列20个基线宿主的候选配置与存在性。`--discover`才检查上游限定的点目录配置候选；不输出已有配置内容。`install --host codex --profile prf_...`显示目标和改动范围；增加`--apply`才写入，自动备份并保持其他MCP项。`uninstall --host codex --profile prf_... --apply`只删除laofu-browser条目，保留用户成果。JSON与Codex TOML均有临时目录行为测试；实际已安装 Codex app-server 已在专用配置和临时协议上下文中完成识别、工具调用、卸载；没有模型轮次，也没有声称20个宿主应用都实际启动过。

## 本人日常Chrome

`pair --attach --name 本人Chrome`生成独立执行端凭据和桥端口，启动worker后等待加载扩展，服务仍能查询离线状态。在本人Chrome加载worker显示的`engine/extension`目录，完成后自动就绪。不要从其他profile复制laofu-config.js，也不要把本人Chrome扩展目录发送给受限产品。managed模式自动启动独立的Playwright配套Chromium，业务动作仍走扩展适配器。

`extension --config ...`显示对应目录；`doctor`分别列包、桥/扩展就绪和执行端环境，默认目标站点访问标记not_checked；按需使用 `doctor --site URL --profile prf_...` 进行有界采集诊断。扩展reload不等于浏览器重启。Chrome开发者模式关闭时会禁用重新载入的未打包扩展，需在同一专用浏览器启用。

## 受限产品浏览器

先在Mac Docker Desktop构建`deploy/docker/Dockerfile`指定的自建镜像。运行用户node、capabilities全部删除、no-new-privileges、独立持久卷、profile、Xvfb与loopback VNC；seccomp开放浏览器用户namespace所需系统调用，不添加主机capability、不使用--no-sandbox。网关是该实例唯一出站通道，目标DNS解析后固定连接公共IP，阻止私网、localhost、metadata及保留地址；网关到核心仅放行带独立执行端凭据的worker接口。

2026-09-15 修复后，deployer 为网关指定私有 `eth0`，18880/18881 仅绑定该接口地址；默认 bridge 邻居无法访问，控制接口仍由核心校验执行端凭据。接口缺失时拒绝启动，独立启动未指定接口时只绑定 loopback。更新代码本身不会改变已运行网关，采用新版本部署时须通过原部署器重建网关；不能只更新 worker 镜像就声称此修复已生效。本轮仅测试临时容器，未重建日常环境。

执行端 journal 正文与 source-metadata 保留 7 天；清理保留幂等摘要和执行状态，不重放过期／未知写动作。Worker 每次完成（含失败）清理自己的 jobs 临时目录；启动和每分钟回收 24 小时以上的陈旧目录。服务端每分钟回收终态未发布包及陈旧 `.partial`，不删除仍在上传的文件，不自动删除已交付产物。磁盘／产品配额仍是硬限制，清理机制不能替代额度设置或备份。

```sh
node deploy/isolated.mjs create --home /服务状态目录 --name 产品A浏览器
node deploy/isolated.mjs verify --home /服务状态目录 --id wrk_...
```

create默认不授予产品调用。verify必须检查非root、实际Chrome sandbox、内部网络、直接出站阻断、私网阻断、控制接口拒绝、公网可用及独立桌面；全部通过才提交与实际bootId/image绑定的报告。随后在控制台授权一个产品。一个profile只绑定一个产品，不能改授已有Cookie给另一个产品。执行端重启后重新verify。

当前宿主的系统 DNS 仍可能返回 198.18/15 保留地址。P4 实测显式使用宿主原有的 `8.8.8.8/8.8.4.4`，仅供公网代理解析，Docker 内部控制解析不变；双身份八项全部通过。可在 create 时加 `--dns 8.8.8.8,8.8.4.4`（仅适用于已授权此路径的当前环境）。未使用先前被拒绝的 Cloudflare DoH，未放宽公共 IP/私网检查。

停止隔离部署用`stop --id`，再启动用`start --id`；数据卷和命令记录不删除。Linux服务器的Docker控制面网络接入需P5单独验收，本Mac部署器不会假装已支持该路径。

## 人工接手与故障

- 验证码/登录：waiting_user时自动控制已撤销。可直接操作Mac专用浏览器，或在有独立显示的容器使用控制台接手。断开查看不取消任务；重新连接原任务。完成后继续会回读同一页面。
- 操作频繁：RATE_LIMITED 后持久冷却阻止新任务；可信 Retry-After 到期或维护者明确解除后才受理。解除不重放旧任务，不切 IP/profile 规避。
- 原始ask：浮条和until仍可完成，控制台也可明确继续；取消映射为cancelled，等待到期为failed。
- 服务、桥、执行端失联：任务suspended或failed且effectState=unknown。先核验外部效果并确认旧执行端停止。相同幂等键只返回原命令，不重新点击。
- 解除profile隔离：停止旧worker；调用recover并明确`confirmStopped`与`acknowledgeUnknownEffects`。不会复活旧命令。清理完后再启动worker；需重新做的业务以核验结果为依据发起新请求。
- 缺图/坏图/正文变化：partial提供可用成果和缺项；不以成功状态掩盖缺失。大图片改走原生下载只针对已明确拒绝的图像GET，未知写入不重试。
- 配额/磁盘：10GiB产物配额满后停止新增，旧成果不自动清理。通过控制台/API删除个人选择的成果。未完成文件也占用容量；先停服务核对孤立文件，再清理，不删除命令记录。
- 日志：核心和桥的按日运行日志保留30天；命令、外部效果、幂等、经验版本另存在SQLite中。profile、命令journal和原图由本人主动管理。诊断输出不自动发送到外部平台。

## 日本与Windows（已暂停）

日本部署必须使用独立目录/用户/端口，不覆盖既有试验目录及服务。用户恢复 P5 后再核对Ubuntu24.04 x86_64资源、网络、沙箱和远程接手，配置执行端`location=server`；Cookie留在执行端，不共享SQLite文件。

Windows提供源码准备和登录会话自启动配置生成器，需在Windows11 x86_64本机安装固定Node、构建原生依赖并运行同组真实浏览器测试。当前缺少该测试环境，不能用交叉构建或Mac上的结果代替。`deploy/windows/prepare.ps1`与`deploy/linux/prepare.sh`只是准备入口，不是通过证明。
