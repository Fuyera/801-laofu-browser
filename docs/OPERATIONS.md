# 安装、隔离部署和故障处理

当前内部开发版先交付macOS arm64。Ubuntu24.04 x86_64、Windows11 x86_64尚未实际验收，不能把Mac Docker内的Linux arm64结果算成这些目标系统通过。

## 固定Mac制品

`releases/laofu-browser-0.1.0-dev.1-macos-arm64.tar.gz` 包含源码、锁文件、生成扩展、服务、控制台、Node22.23.2、Chromium及依赖。旁边的sha256校验包完整性；它不等于第三方签名。RELEASE.json保存逐文件哈希及平台/数据库范围。包不包含本机账号、浏览器profile或测试运行凭据。

解压后可直接运行`bin/laofu-browser`；不需要全局安装npm包。版本管理器用固定Node运行：

```sh
/解压目录/node/bin/node /解压目录/deploy/manage.mjs install --source /解压目录 --prefix /本人选择的/laofu-browser
/解压目录/node/bin/node /解压目录/deploy/manage.mjs start --prefix /本人选择的/laofu-browser
/解压目录/node/bin/node /解压目录/deploy/manage.mjs status --prefix /本人选择的/laofu-browser
```

安装目录包含`releases/`和独立`state/`。启动默认仅loopback、需要鉴权。用当前发行目录的`bin/laofu-browser console-login --home /安装目录/state`获取控制台一次性地址。停止用manage.mjs stop；不会关闭用户其他Chrome或删除成果。

升级仍执行install，源指向新的固定包。先校验全部文件和平台，再停止本安装进程、备份数据库和配置、检查schema兼容、切换版本；新版本启动失败时恢复旧程序。`rollback --release <releaseId>`切换到已有兼容版本。**回退程序不回滚命令/效果/幂等记录**，以免把已经提交过的操作重新当作未执行。schema更高的状态不可由旧程序打开；需要单独制定数据迁移，当前版本不会自动迁移或恢复旧生产数据。

备份命令要求原进程已停止。数据库备份不含大体积浏览器profile和产物，它们保留原路径。需要灾难恢复备份时，应在全部执行停止后，由本人同时备份state与每个执行端目录。

## 可选自启动与宿主

`deploy/service-files.mjs --root /发行目录 --home /状态目录 --output /配置输出目录 [--config /执行端配置.json]` 只生成配置，不注册自启动。Mac输出launchd plist，Linux输出user systemd unit，Windows输出登录会话计划任务脚本。生成后由本人选择是否启用；不要同时用local.mjs和服务管理器启动同一状态目录。Mac启用示例为`launchctl bootstrap gui/$(id -u) /具体plist`；停止用相同路径的`launchctl bootout`。需要桌面接手的执行端应在本人的图形登录会话启动。

`bin/laofu-browser install`仅列20个基线宿主的候选配置与存在性。`--discover`才检查上游限定的点目录配置候选；不输出已有配置内容。`install --host codex --profile prf_...`显示目标和改动范围；增加`--apply`才写入，自动备份并保持其他MCP项。`uninstall --host codex --profile prf_... --apply`只删除laofu-browser条目，保留用户成果。JSON与Codex TOML均有临时目录行为测试；没有声称20个宿主应用都实际启动过。

## 本人日常Chrome

`pair --attach --name 本人Chrome`生成独立执行端凭据和桥端口，启动worker后等待加载扩展，服务仍能查询离线状态。在本人Chrome加载worker显示的`engine/extension`目录，完成后自动就绪。不要从其他profile复制laofu-config.js，也不要把本人Chrome扩展目录发送给受限产品。managed模式自动启动独立的Playwright配套Chromium，业务动作仍走扩展适配器。

`extension --config ...`显示对应目录；`doctor`分别列包、桥/扩展就绪和执行端环境，目标站点访问标记not_checked。扩展reload不等于浏览器重启。Chrome开发者模式关闭时会禁用重新载入的未打包扩展，需在同一专用浏览器启用。

## 受限产品浏览器

先在Mac Docker Desktop构建`deploy/docker/Dockerfile`指定的自建镜像。运行用户node、capabilities全部删除、no-new-privileges、独立持久卷、profile、Xvfb与loopback VNC；seccomp开放浏览器用户namespace所需系统调用，不添加主机capability、不使用--no-sandbox。网关是该实例唯一出站通道，目标DNS解析后固定连接公共IP，阻止私网、localhost、metadata及保留地址；网关到核心仅放行带独立执行端凭据的worker接口。

```sh
node deploy/isolated.mjs create --home /服务状态目录 --name 产品A浏览器
node deploy/isolated.mjs verify --home /服务状态目录 --id wrk_...
```

create默认不授予产品调用。verify必须检查非root、实际Chrome sandbox、内部网络、直接出站阻断、私网阻断、控制接口拒绝、公网可用及独立桌面；全部通过才提交与实际bootId/image绑定的报告。随后在控制台授权一个产品。一个profile只绑定一个产品，不能改授已有Cookie给另一个产品。执行端重启后重新verify。

当前环境的系统DNS会把公网域名映射为198.18/15保留地址，公共IP校验正确拒绝，因此公网正向探针未通过。请求使用Cloudflare DoH的动作被自动审批拒绝，因为尚未授权把域名元数据发送给该外部服务。没有启用DoH，也没有更换解析器或放松私网校验。等待用户答复后再解决实际DNS环境；受限入口继续关闭。

停止隔离部署用`stop --id`，再启动用`start --id`；数据卷和命令记录不删除。Linux服务器的Docker控制面网络接入需P5单独验收，本Mac部署器不会假装已支持该路径。

## 人工接手与故障

- 验证码/登录：waiting_user时自动控制已撤销。可直接操作Mac专用浏览器，或在有独立显示的容器使用控制台接手。断开查看不取消任务；重新连接原任务。完成后继续会回读同一页面。
- 操作频繁：返回RATE_LIMITED停止，不承诺固定等待多久有效，不切IP/profile绕过限制。
- 原始ask：浮条和until仍可完成，控制台也可明确继续；取消映射为cancelled，等待到期为failed。
- 服务、桥、执行端失联：任务suspended或failed且effectState=unknown。先核验外部效果并确认旧执行端停止。相同幂等键只返回原命令，不重新点击。
- 解除profile隔离：停止旧worker；调用recover并明确`confirmStopped`与`acknowledgeUnknownEffects`。不会复活旧命令。清理完后再启动worker；需重新做的业务以核验结果为依据发起新请求。
- 缺图/坏图/正文变化：partial提供可用成果和缺项；不以成功状态掩盖缺失。大图片改走原生下载只针对已明确拒绝的图像GET，未知写入不重试。
- 配额/磁盘：10GiB产物配额满后停止新增，旧成果不自动清理。通过控制台/API删除个人选择的成果。未完成文件也占用容量；先停服务核对孤立文件，再清理，不删除命令记录。
- 日志：核心和桥的按日运行日志保留30天；命令、外部效果、幂等、经验版本另存在SQLite中。profile、命令journal和原图由本人主动管理。诊断输出不自动发送到外部平台。

## 日本与Windows后续验收

日本部署必须使用独立目录/用户/端口，不覆盖`/opt/huashu-pilot`及既有服务。P4通过后再核对Ubuntu24.04 x86_64资源、网络、沙箱和远程接手，配置执行端`location=server`；Cookie留在执行端，不共享SQLite文件。

Windows提供源码准备和登录会话自启动配置生成器，需在Windows11 x86_64本机安装固定Node、构建原生依赖并运行同组真实浏览器测试。当前缺少该测试环境，不能用交叉构建或Mac上的结果代替。`deploy/windows/prepare.ps1`与`deploy/linux/prepare.sh`只是准备入口，不是通过证明。
