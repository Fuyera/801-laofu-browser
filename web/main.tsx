import React, { useState, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";
const labels: any = {
  queued: "排队中",
  running: "执行中",
  waiting_user: "等待你接手",
  suspended: "已挂起",
  succeeded: "已完成",
  partial: "部分完成",
  failed: "失败",
  cancelled: "已取消",
};
async function api(route: string, method = "GET", body?: any, key?: string) {
  const r = await fetch("/v1" + route, {
    method,
    credentials: "same-origin",
    headers: {
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(key ? { "idempotency-key": key } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error?.message || "服务请求失败");
  return data;
}
function Handoff({ job, onClose }: { job: any; onClose: () => void }) {
  const target = useRef<HTMLDivElement>(null),
    connection = useRef<any>(null);
  const [error, setError] = useState(""),
    [handoff, setHandoff] = useState<any>();
  useEffect(() => {
    let stopped = false;
    void (async () => {
      try {
        const h = await api(`/tasks/${job.id}/handoffs`, "POST", {});
        if (stopped) return;
        setHandoff(h);
        const { default: RFB } = await import("@novnc/novnc");
        if (stopped) return;
        const rfb = new RFB(
          target.current!,
          `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/v1/handoffs/${h.id}/socket`,
        );
        connection.current = rfb;
        rfb.scaleViewport = true;
        rfb.resizeSession = false;
        rfb.addEventListener("disconnect", () => {
          if (!stopped)
            setError("接手连接已断开。任务保留原状态，可关闭后重新连接。");
        });
      } catch (e: any) {
        setError(e.message);
      }
    })();
    return () => {
      stopped = true;
      connection.current?.disconnect();
    };
  }, [job.id]);
  async function close() {
    connection.current?.disconnect();
    if (handoff) await api(`/tasks/${job.id}/handoffs/${handoff.id}`, "DELETE");
    onClose();
  }
  return (
    <div className="veil">
      <div className="handoff">
        <header>
          <div>
            <h2>接手浏览器</h2>
            <p>自动执行已暂停。完成页面操作后，关闭窗口并选择“继续任务”。</p>
          </div>
          <button onClick={() => void close()}>关闭接手</button>
        </header>
        {error && <p role="alert">{error}</p>}
        <div ref={target} className="remote" />
      </div>
    </div>
  );
}
function App() {
  const [me, setMe] = useState<any>(null),
    [loading, setLoading] = useState(true),
    [login, setLogin] = useState(""),
    [error, setError] = useState(""),
    [section, setSection] = useState("任务"),
    [profiles, setProfiles] = useState<any[]>([]),
    [profile, setProfile] = useState(""),
    [tasks, setTasks] = useState<any[]>([]),
    [artifacts, setArtifacts] = useState<any[]>([]),
    [products, setProducts] = useState<any[]>([]),
    [diagnostics, setDiagnostics] = useState<any>(null),
    [selected, setSelected] = useState(""),
    [url, setUrl] = useState(""),
    [busy, setBusy] = useState(false),
    [name, setName] = useState(""),
    [credential, setCredential] = useState(""),
    [domain, setDomain] = useState(""),
    [note, setNote] = useState<any>({
      version: 0,
      body: "",
      seed: "",
      history: [],
    }),
    [handoff, setHandoff] = useState<any>(null),
    [events, setEvents] = useState<any[]>([]),
    [workerInfo, setWorkerInfo] = useState<any>(null),
    [preview, setPreview] = useState<any>(null);
  const sections = [
    "浏览器与设备",
    "任务",
    "图文产物",
    "产品凭据",
    "诊断与经验",
  ];
  const current = tasks.find((x) => x.id === selected);
  async function refresh() {
    const [p, t, a, d] = await Promise.all([
      api("/profiles"),
      api("/tasks?includeCommands=1"),
      api("/artifacts"),
      api("/diagnostics"),
    ]);
    setProfiles(p.items);
    setTasks(t.items);
    setArtifacts(a.items);
    setDiagnostics(d);
    setProfile((old) => old || p.items[0]?.id || "");
    if (me?.product?.role === "owner")
      setProducts((await api("/admin/products")).items);
  }
  async function act(fn: () => Promise<any>) {
    setBusy(true);
    setError("");
    try {
      await fn();
      await refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void (async () => {
      const hash = new URLSearchParams(location.hash.slice(1)),
        token = hash.get("bootstrap");
      if (token) {
        history.replaceState(null, "", location.pathname);
        try {
          await api("/admin/bootstrap", "POST", { token });
        } catch (e: any) {
          setError(e.message);
        }
      }
      try {
        setMe(await api("/me"));
      } catch {
      } finally {
        setLoading(false);
      }
    })();
  }, []);
  useEffect(() => {
    if (!me) return;
    void refresh().catch((e) => setError(e.message));
    const timer = setInterval(
      () => void refresh().catch((e) => setError(e.message)),
      2500,
    );
    return () => clearInterval(timer);
  }, [me]);
  useEffect(() => {
    setEvents([]);
    if (!selected) return;
    const s = new EventSource(`/v1/tasks/${selected}/events`);
    for (const kind of [
      "accepted",
      "progress",
      "state",
      "waiting_user",
      "late_evidence",
    ])
      s.addEventListener(kind, (e) => {
        const row = JSON.parse((e as MessageEvent).data);
        setEvents((old) =>
          [...old.filter((v) => v.id !== row.id), row].slice(-100),
        );
      });
    return () => s.close();
  }, [selected]);
  if (loading)
    return (
      <main className="login">
        <p>连接本机服务…</p>
      </main>
    );
  if (!me)
    return (
      <main className="login">
        <span className="wordmark">
          laofu<span>/</span>browser
        </span>
        <h1>把网页带回你的工作流</h1>
        <p>
          输入本机生成的一次性登录票据，进入管理控制台。票据有效期为 10 分钟。
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void act(async () => {
              await api("/admin/bootstrap", "POST", { token: login });
              setLogin("");
              setMe(await api("/me"));
            });
          }}
        >
          <label>
            一次性票据
            <input
              type="password"
              autoComplete="off"
              value={login}
              onChange={(e) => setLogin(e.target.value)}
              required
            />
          </label>
          <button className="primary" disabled={busy}>
            进入控制台
          </button>
        </form>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <details>
          <summary>如何获取票据</summary>
          <p>
            在已安装目录运行 <code>laofu-browser console-login</code>
            ，打开返回的本机链接。
          </p>
        </details>
      </main>
    );
  return (
    <div className="app">
      <aside>
        <a className="wordmark" href="#">
          laofu<span>/</span>browser
        </a>
        <p className="aside-caption">浏览器能力控制台</p>
        <nav>
          {sections.map((s) => (
            <button
              aria-current={section === s ? "page" : undefined}
              key={s}
              onClick={() => setSection(s)}
            >
              {s}
              {s === "任务" &&
                tasks.some((t) => t.state === "waiting_user") && (
                  <span className="attention">
                    {tasks.filter((t) => t.state === "waiting_user").length}
                  </span>
                )}
            </button>
          ))}
        </nav>
        <div className="connection">
          <span className="dot" />
          本机服务已连接
          <p>
            {profiles.filter((p) => p.ready && !p.quarantined).length}{" "}
            个可用浏览器
          </p>
          <button
            onClick={() =>
              void act(async () => {
                await api("/logout", "POST", {});
                setMe(null);
              })
            }
          >
            退出管理会话
          </button>
        </div>
      </aside>
      <main>
        <header className="page-head">
          <div>
            <p className="eyebrow">LAOFU BROWSER / 内部开发版</p>
            <h1>{section}</h1>
          </div>
          <span className="owner">{me.product.name}</span>
        </header>
        {error && (
          <div className="error" role="alert">
            {error}
            <button onClick={() => setError("")}>收起</button>
          </div>
        )}
        {section === "任务" && (
          <>
            <form
              className="capture"
              onSubmit={(e) => {
                e.preventDefault();
                void act(async () => {
                  const task = await api(
                    "/tasks",
                    "POST",
                    {
                      type: "article.capture@v1",
                      execution: { profileId: profile },
                      input: { url },
                    },
                    crypto.randomUUID(),
                  );
                  setSelected(task.id);
                  setUrl("");
                });
              }}
            >
              <label>
                文章链接
                <input
                  type="url"
                  placeholder="粘贴公众号或网页链接"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  required
                />
              </label>
              <label>
                执行浏览器
                <select
                  value={profile}
                  onChange={(e) => setProfile(e.target.value)}
                >
                  {profiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                      {p.ready ? "" : " · 离线"}
                      {p.quarantined ? " · 已隔离" : ""}
                    </option>
                  ))}
                </select>
              </label>
              <button className="primary" disabled={busy || !profile}>
                采集图文
              </button>
            </form>
            <div className="workbench">
              <section className="task-list">
                <h2>
                  最近任务 <span>{tasks.length}</span>
                </h2>
                {!tasks.length && (
                  <div className="empty">
                    <h3>先保存一篇文章</h3>
                    <p>
                      提交链接后，可以在这里看进度、处理验证，再下载图文包。
                    </p>
                  </div>
                )}
                {tasks.map((t) => (
                  <button
                    key={t.id}
                    className={
                      "task-row " + (selected === t.id ? "selected" : "")
                    }
                    onClick={() => setSelected(t.id)}
                  >
                    <span className={"state " + t.state}>
                      {labels[t.state]}
                    </span>
                    <strong>
                      {t.result?.manifest?.title || t.input.url || t.type}
                    </strong>
                    <small>
                      {new Date(t.createdAt).toLocaleString("zh-CN")} ·{" "}
                      {t.id.slice(-8)}
                    </small>
                  </button>
                ))}
              </section>
              <section className="detail">
                {current ? (
                  <>
                    <div className="detail-title">
                      <span className={"state " + current.state}>
                        {labels[current.state]}
                      </span>
                      <h2>{current.result?.manifest?.title || "图文采集"}</h2>
                    </div>
                    <p className="source">{current.input.url}</p>
                    {current.error && (
                      <p className="error">
                        {current.error.message}{" "}
                        <code>{current.error.code}</code>
                      </p>
                    )}
                    {current.effectState === "unknown" && (
                      <p className="notice">
                        存在尚未确认的执行效果。请核对浏览器；任务不会自动重放。
                      </p>
                    )}
                    {current.state === "waiting_user" && (
                      <div className="notice">
                        <h3>需要你完成页面操作</h3>
                        <p>
                          如果浏览器在当前
                          Mac，直接在该浏览器完成；远程浏览器可打开接手窗口。
                        </p>
                        <button onClick={() => setHandoff(current)}>
                          打开接手窗口
                        </button>{" "}
                        <button
                          className="primary"
                          disabled={busy}
                          onClick={() =>
                            void act(() =>
                              api(`/tasks/${current.id}/resume`, "POST", {}),
                            )
                          }
                        >
                          已完成，继续任务
                        </button>
                      </div>
                    )}
                    {[
                      "queued",
                      "running",
                      "waiting_user",
                      "suspended",
                    ].includes(current.state) && (
                      <button
                        disabled={busy || current.cancelRequested}
                        onClick={() =>
                          void act(() =>
                            api(`/tasks/${current.id}/cancel`, "POST", {}),
                          )
                        }
                      >
                        {current.cancelRequested ? "正在停止…" : "取消任务"}
                      </button>
                    )}
                    {current.result?.manifest && (
                      <div className="metrics">
                        <div>
                          <strong>
                            {
                              current.result.manifest.mediaCoverage
                                .downloadedImages
                            }
                          </strong>
                          <span>已下载图片</span>
                        </div>
                        <div>
                          <strong>
                            {current.result.manifest.mediaCoverage.failedImages}
                          </strong>
                          <span>未取得图片</span>
                        </div>
                        <div>
                          <strong>
                            {current.result.manifest.versionConsistent
                              ? "一致"
                              : "待核对"}
                          </strong>
                          <span>提取期间正文</span>
                        </div>
                      </div>
                    )}
                    {current.artifacts?.length > 0 && (
                      <>
                        <h3>图文成果</h3>
                        <div className="files">
                          {current.artifacts.map((a: any) => (
                            <a
                              key={a.id}
                              href={`/v1/artifacts/${a.id}/content`}
                              download
                            >
                              {a.filename}
                              <small>{(a.bytes / 1024).toFixed(1)} KB ↓</small>
                            </a>
                          ))}
                        </div>
                      </>
                    )}
                    <h3>执行记录</h3>
                    <ol className="timeline">
                      {events.map((e) => (
                        <li key={e.id}>
                          <time>
                            {new Date(e.createdAt).toLocaleTimeString("zh-CN")}
                          </time>
                          <span>
                            {labels[e.data.state] || e.data.tool || e.kind}
                            {e.data.step ? ` · 第 ${e.data.step} 步` : ""}
                          </span>
                        </li>
                      ))}
                    </ol>
                    <details>
                      <summary>任务详情</summary>
                      <pre>{JSON.stringify(current, null, 2)}</pre>
                    </details>
                  </>
                ) : (
                  <div className="empty">
                    <h2>任务会留在这里</h2>
                    <p>关闭页面不会取消任务。选择左侧任务查看进度和成果。</p>
                  </div>
                )}
              </section>
            </div>
          </>
        )}
        {section === "浏览器与设备" && (
          <>
            <p className="intro">
              为每个产品使用独立浏览器。日常 Chrome 的完整权限只属于本人。
            </p>
            <div className="device-grid">
              {profiles.map((p) => (
                <article className="device" key={p.id}>
                  <div className="device-top">
                    <span
                      className={
                        "dot " + (!p.ready || p.quarantined ? "off" : "")
                      }
                    />
                    <span>
                      {p.quarantined ? "等待核验" : p.ready ? "可用" : "离线"}
                    </span>
                    <small>
                      {p.mode === "owner" ? "本人浏览器" : "受限产品浏览器"}
                    </small>
                  </div>
                  <h2>{p.name}</h2>
                  <p>
                    {p.mode === "owner"
                      ? "保留完整工具能力"
                      : "独立配置与文件目录"}
                  </p>
                  <code>{p.id}</code>
                  {p.mode === "isolated" && (
                    <fieldset>
                      <legend>允许访问的产品</legend>
                      {products
                        .filter((x) => x.role === "product" && !x.revoked)
                        .map((x) => (
                          <label key={x.id} className="check">
                            <input
                              type="checkbox"
                              checked={p.productIds.includes(x.id)}
                              onChange={(e) =>
                                void act(() =>
                                  api(`/admin/profiles/${p.id}`, "PATCH", {
                                    productIds: e.target.checked
                                      ? [...p.productIds, x.id]
                                      : p.productIds.filter(
                                          (id: string) => id !== x.id,
                                        ),
                                  }),
                                )
                              }
                            />
                            {x.name}
                          </label>
                        ))}
                    </fieldset>
                  )}
                </article>
              ))}
            </div>
            <details>
              <summary>连接新的浏览器</summary>
              <p>
                在安装目录运行 <code>laofu-browser pair --name 浏览器名称</code>
                ，再用返回的配置启动执行端。连接日常 Chrome 时添加{" "}
                <code>--attach</code>
                ，按安装手册加载配对扩展。受限产品浏览器使用隔离部署命令。
              </p>
            </details>
          </>
        )}
        {section === "图文产物" && (
          <>
            <p className="intro">
              下载 ZIP 可完整离线阅读。成果由你主动清理，系统不会自动删除。
            </p>
            {!artifacts.length ? (
              <div className="empty">
                采集完成或上传文件后，成果会出现在这里。
              </div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>文件</th>
                      <th>大小</th>
                      <th>保存时间</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {artifacts.map((a) => (
                      <tr key={a.id}>
                        <td>
                          <a href={`/v1/artifacts/${a.id}/content`} download>
                            {a.filename}
                          </a>
                        </td>
                        <td>{(a.bytes / 1024).toFixed(1)} KB</td>
                        <td>{new Date(a.createdAt).toLocaleString("zh-CN")}</td>
                        <td>
                          {a.filename === "article.html" &&
                            a.metadata?.source === "worker" && (
                              <button
                                className="text-button"
                                onClick={() => setPreview(a)}
                              >
                                预览
                              </button>
                            )}
                          <button
                            className="text-button"
                            onClick={() => {
                              if (
                                confirm(`删除 ${a.filename}？下载链接将失效。`)
                              )
                                void act(() =>
                                  api(`/artifacts/${a.id}`, "DELETE"),
                                );
                            }}
                          >
                            删除
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
        {section === "产品凭据" && (
          <>
            <p className="intro">
              每个产品使用自己的凭据；浏览器访问范围在“浏览器与设备”中分配。
            </p>
            <form
              className="inline-form"
              onSubmit={(e) => {
                e.preventDefault();
                void act(async () => {
                  const created = await api("/admin/products", "POST", {
                    name,
                  });
                  setCredential(created.token);
                  setName("");
                });
              }}
            >
              <label>
                产品名称
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  maxLength={100}
                />
              </label>
              <button className="primary" disabled={busy}>
                创建凭据
              </button>
            </form>
            {credential && (
              <div className="notice">
                <p>请保存这份凭据，离开后不再显示。</p>
                <code>{credential}</code>
                <button
                  onClick={() => {
                    void navigator.clipboard
                      .writeText(credential)
                      .catch(() => setError("复制未获授权，请手动选择凭据。"));
                  }}
                >
                  复制
                </button>
                <button onClick={() => setCredential("")}>已保存</button>
              </div>
            )}
            <table>
              <thead>
                <tr>
                  <th>产品</th>
                  <th>权限</th>
                  <th>状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {products
                  .filter((p) => p.role !== "owner")
                  .map((p) => (
                    <tr key={p.id}>
                      <td>{p.name}</td>
                      <td>
                        {p.scopes
                          .map(
                            (s: string) =>
                              ({
                                "article.capture": "图文采集",
                                "artifacts.write": "文件上传",
                                "browser.read": "页面读取",
                                "learnings.write": "经验编辑",
                              })[s] || s,
                          )
                          .join("、")}
                      </td>
                      <td>{p.revoked ? "已吊销" : "有效"}</td>
                      <td>
                        {!p.revoked && (
                          <>
                            <button
                              className="text-button"
                              onClick={() =>
                                void act(async () =>
                                  setCredential(
                                    (
                                      await api(
                                        `/admin/products/${p.id}/rotate`,
                                        "POST",
                                        {},
                                      )
                                    ).token,
                                  ),
                                )
                              }
                            >
                              轮换
                            </button>
                            <details>
                              <summary>使用额度</summary>
                              <form
                                onSubmit={(e) => {
                                  e.preventDefault();
                                  const form = new FormData(e.currentTarget);
                                  void act(() =>
                                    api(`/admin/products/${p.id}`, "PATCH", {
                                      limits: {
                                        artifactBytes:
                                          Number(form.get("disk")) * 1024 ** 2,
                                        maxQueued: Number(form.get("queued")),
                                        maxResident: Number(
                                          form.get("resident"),
                                        ),
                                      },
                                    }),
                                  );
                                }}
                              >
                                <label>
                                  产物额度（MiB）
                                  <input
                                    name="disk"
                                    type="number"
                                    min="1"
                                    max="10240"
                                    required
                                    defaultValue={
                                      (p.limits?.artifactBytes ??
                                        2 * 1024 ** 3) /
                                      1024 ** 2
                                    }
                                  />
                                </label>
                                <label>
                                  排队任务上限
                                  <input
                                    name="queued"
                                    type="number"
                                    min="1"
                                    max="1000"
                                    required
                                    defaultValue={p.limits?.maxQueued ?? 20}
                                  />
                                </label>
                                <label>
                                  未结束任务上限
                                  <input
                                    name="resident"
                                    type="number"
                                    min="1"
                                    max="1000"
                                    required
                                    defaultValue={p.limits?.maxResident ?? 24}
                                  />
                                </label>
                                <button disabled={busy}>保存额度</button>
                              </form>
                            </details>
                            <button
                              className="text-button"
                              onClick={() => {
                                if (
                                  confirm(`吊销 ${p.name} 的凭据并停止其任务？`)
                                )
                                  void act(() =>
                                    api(`/admin/products/${p.id}`, "DELETE"),
                                  );
                              }}
                            >
                              吊销
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </>
        )}
        {section === "诊断与经验" && (
          <>
            <div className="metrics">
              <div>
                <strong>{diagnostics?.counts.tasks || 0}</strong>
                <span>任务和命令</span>
              </div>
              <div>
                <strong>
                  {(
                    (diagnostics?.counts.artifactBytes || 0) /
                    1024 ** 2
                  ).toFixed(1)}{" "}
                  MiB
                </strong>
                <span>成果占用 / 10 GiB 默认配额</span>
              </div>
              <div>
                <strong>{diagnostics?.counts.unknown || 0}</strong>
                <span>效果待核验</span>
              </div>
            </div>
            <h2>站点经验</h2>
            {!!diagnostics?.cooldowns?.filter(
              (c: any) =>
                !c.releasedAt && (c.until === null || c.until > Date.now()),
            ).length && (
              <section>
                <h2>站点冷却</h2>
                {diagnostics.cooldowns
                  .filter(
                    (c: any) =>
                      !c.releasedAt &&
                      (c.until === null || c.until > Date.now()),
                  )
                  .map((c: any) => (
                    <p key={c.id}>
                      {c.origin} ·{" "}
                      {c.until === null
                        ? "恢复时间未知"
                        : `等待至 ${new Date(c.until).toLocaleString("zh-CN")}`}{" "}
                      <button
                        disabled={busy}
                        onClick={() => {
                          if (
                            confirm(
                              "确认站点已允许继续访问？解除冷却不会重放旧任务。",
                            )
                          )
                            void act(() =>
                              api(
                                `/admin/cooldowns/${c.id}/release`,
                                "POST",
                                {},
                              ),
                            );
                        }}
                      >
                        已核对，解除冷却
                      </button>
                    </p>
                  ))}
              </section>
            )}
            <form
              className="inline-form"
              onSubmit={(e) => {
                e.preventDefault();
                void act(async () =>
                  setNote(
                    await api(
                      "/learnings?domain=" + encodeURIComponent(domain),
                    ),
                  ),
                );
              }}
            >
              <label>
                网站域名
                <input
                  placeholder="mp.weixin.qq.com"
                  value={domain}
                  onChange={(e) => setDomain(e.target.value)}
                  required
                  pattern="[a-z0-9.-]+"
                />
              </label>
              <button disabled={busy}>读取经验</button>
            </form>
            <label>
              个人经验 · 版本 {note.version}
              <textarea
                rows={8}
                value={note.body}
                onChange={(e) => setNote({ ...note, body: e.target.value })}
              />
            </label>
            <button
              disabled={busy || !domain}
              onClick={() =>
                void act(async () =>
                  setNote({
                    ...note,
                    ...(await api(
                      "/learnings/" + encodeURIComponent(domain),
                      "PUT",
                      { body: note.body, version: note.version },
                    )),
                  }),
                )
              }
            >
              保存新版本
            </button>
            {note.history?.length > 1 && (
              <details>
                <summary>历史版本</summary>
                {note.history.map((item: any) => (
                  <p key={item.version}>
                    版本 {item.version} ·{" "}
                    {item.savedAt
                      ? new Date(item.savedAt).toLocaleString("zh-CN")
                      : "历史日期未知"}{" "}
                    <button
                      disabled={busy || item.version === note.version}
                      onClick={() =>
                        void act(async () => {
                          await api(
                            `/learnings/${encodeURIComponent(domain)}/restore`,
                            "POST",
                            {
                              targetVersion: item.version,
                              version: note.version,
                            },
                          );
                          setNote(
                            await api(
                              "/learnings?domain=" + encodeURIComponent(domain),
                            ),
                          );
                        })
                      }
                    >
                      恢复为新版本
                    </button>
                  </p>
                ))}
              </details>
            )}
            {note.seed && (
              <details>
                <summary>上游参考经验</summary>
                <pre>{note.seed}</pre>
              </details>
            )}
            <details>
              <summary>运行诊断详情</summary>
              <pre>{JSON.stringify(diagnostics, null, 2)}</pre>
            </details>
          </>
        )}
      </main>
      {preview && (
        <div className="veil">
          <section className="handoff">
            <header>
              <h2>图文预览</h2>
              <button onClick={() => setPreview(null)}>关闭预览</button>
            </header>
            <iframe
              title="安全图文预览"
              sandbox="allow-same-origin"
              src={`/v1/artifacts/${preview.id}/preview`}
              style={{ width: "100%", height: "75vh", border: 0 }}
            />
          </section>
        </div>
      )}
      {handoff && <Handoff job={handoff} onClose={() => setHandoff(null)} />}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
