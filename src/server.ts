import { VERSION, BUILD, API_VERSION } from "./version.js";
import Fastify from "fastify";
import { operationalLog } from "./logs.js";
import { applyContracts } from "./contracts.js";
import cookie from "@fastify/cookie";
import websocket from "@fastify/websocket";
import staticFiles from "@fastify/static";
import swagger from "@fastify/swagger";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { Store } from "./store.js";
import { Artifacts } from "./artifacts.js";
import { Broker } from "./broker.js";
import { Fault, problem } from "./errors.js";
import { tools, ROOT, validateTool, readingTools } from "./catalog.js";
import { bounded, filename, id, safeUrl, secret, canonical } from "./util.js";
import {
  TERMINAL,
  PRODUCT_LIMITS,
  type Product,
  type Profile,
  type Job,
} from "./types.js";
export interface ServerOptions {
  home: string;
  host?: string;
  port?: number;
  concurrency?: number;
  quota?: number;
}
export async function createServer(options: ServerOptions) {
  const logs = operationalLog(options.home);
  const store = new Store(options.home),
    artifacts = new Artifacts(store, options.quota),
    broker = new Broker(store, options.concurrency || 2);
  const app = Fastify({
    ajv: {
      customOptions: {
        removeAdditional: false,
        coerceTypes: false,
        useDefaults: false,
        allowUnionTypes: true,
      },
    },
    logger: false,
    bodyLimit: 2 * 1024 ** 2,
    requestTimeout: 0,
    connectionTimeout: 0,
  });
  await app.register(cookie);
  await app.register(websocket, { options: { maxPayload: 32 * 1024 ** 2 } });
  await app.register(swagger, {
    openapi: {
      openapi: "3.1.0",
      info: { title: "laofu-browser API", version: VERSION },
      components: {
        securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } },
      },
      security: [{ bearerAuth: [] }],
    },
  });
  app.addHook("onRoute", applyContracts);
  app.addHook("onResponse", async (req, reply) => {
    logs.write("http", {
      method: req.method,
      route: req.routeOptions.url,
      status: reply.statusCode,
      elapsedMs: reply.elapsedTime,
    });
  });
  app.setErrorHandler((error, req, reply) => {
    if (error instanceof Fault)
      return reply.code(error.statusCode).send({ error: problem(error) });
    if ((error as any).validation)
      return reply.code(400).send({
        error: {
          code: "INVALID_ARGUMENT",
          message: "请求格式无效",
          retryable: false,
        },
      });
    return reply.code((error as any).statusCode || 500).send({
      error: {
        code: "INTERNAL",
        message: "请求失败；请检查本机诊断",
        retryable: false,
      },
    });
  });
  app.addHook("onRequest", async (req, reply) => {
    const origin = req.headers.origin;
    if (origin) {
      let u: URL;
      try {
        u = new URL(origin);
      } catch {
        throw new Fault("FORBIDDEN", "来源未授权", 403);
      }
      if (
        u.host !== req.headers.host ||
        ![
          "127.0.0.1",
          "localhost",
          "[::1]",
          ...(process.env.LAOFU_CONSOLE_HOSTS || "").split(","),
        ].includes(u.hostname) ||
        !["http:", "https:"].includes(u.protocol)
      )
        throw new Fault("FORBIDDEN", "来源未授权", 403);
    }
    reply
      .header("X-Content-Type-Options", "nosniff")
      .header("Referrer-Policy", "no-referrer");
  });
  const token = (req: any) =>
    typeof req.headers.authorization === "string" &&
    req.headers.authorization.startsWith("Bearer ")
      ? req.headers.authorization.slice(7)
      : "";
  const product = (req: any): Product => {
    const bearer = token(req);
    if (bearer) return store.product(bearer);
    const subject = store.authenticate(
      req.cookies?.lb_session || "",
      "console",
    );
    const p = subject && store.get<Product>("product", subject);
    if (!p || p.revoked)
      throw new Fault("UNAUTHORIZED", "请先建立管理会话或提供调用凭据", 401);
    return p;
  };
  const owner = (req: any) => {
    const p = product(req);
    if (p.role !== "owner")
      throw new Fault("FORBIDDEN", "此操作需要所有者权限", 403);
    return p;
  };
  const worker = (req: any) => {
    const workerId = store.authenticate(token(req), "worker");
    const w = workerId && store.get<any>("worker", workerId);
    if (!w || w.revoked) throw new Fault("UNAUTHORIZED", "执行端凭据无效", 401);
    return w;
  };
  const idem = (req: any) => String(req.headers["idempotency-key"] || "");
  const session = (p: Product, key: string) => {
    const s = store.get<any>("session", key);
    if (!s || s.closed || (p.role !== "owner" && s.productId !== p.id))
      throw new Fault("FORBIDDEN", "无权访问此资源", 403);
    store.profile(p, s.profileId);
    return s;
  };
  function viewJob(job: Job) {
    const p = store.get<Profile>("profile", job.profileId);
    const files = store.artifacts().filter((a) => a.jobId === job.id);
    return {
      ...job,
      result: job.result && {
        ...job.result,
        ...(job.result.artifacts
          ? {
              artifacts: job.result.artifacts.map((a: any) => {
                const current = store.artifact(a.id);
                return {
                  ...a,
                  deleted: current?.deleted ?? true,
                  unavailableReason:
                    !current || current.deleted ? "deleted" : null,
                };
              }),
            }
          : {}),
      },
      attemptId: job.id + ":" + job.attempt,
      requestId: job.input.requestId || job.id,
      checkpoint: {
        step:
          store
            .events(job.id)
            .filter((e) => e.kind === "progress")
            .at(-1)?.data?.step || 0,
      },
      nextAction:
        job.state === "waiting_user"
          ? "complete_handoff"
          : job.state === "suspended"
            ? "verify_old_execution"
            : null,
      capabilityVersion: VERSION,
      resumeAllowed:
        job.state === "waiting_user" && !job.cancelRequested && !p?.quarantined,
      artifacts: files,
    };
  }
  const schema = {
    body: { type: "object", additionalProperties: true },
  } as any;
  app.get("/healthz", async () => ({
    status: "alive",
    version: VERSION,
    apiVersion: API_VERSION,
    build: BUILD,
  }));
  app.get("/readyz", async () => ({
    status: broker.workers.size ? "ready" : "waiting_worker",
    profiles: store
      .list<Profile>("profile")
      .filter((p) => p.ready && !p.quarantined).length,
  }));
  app.get("/v1/openapi.json", async (req) => {
    product(req);
    return app.swagger();
  });
  app.post("/v1/admin/bootstrap", { schema }, async (req: any, reply) => {
    const bootstrap = req.body?.token;
    const subject =
      typeof bootstrap === "string" &&
      store.authenticate(bootstrap, "bootstrap");
    const p = subject && store.get<Product>("product", subject);
    if (!p || p.revoked)
      throw new Fault("UNAUTHORIZED", "初始化票据无效或已过期", 401);
    store.revokeCredentials("bootstrap", subject);
    const key = store.credential("console", subject, 8 * 3600_000);
    reply.setCookie("lb_session", key, {
      httpOnly: true,
      sameSite: "strict",
      path: "/",
      maxAge: 8 * 3600,
      secure: req.protocol === "https",
    });
    return { product: p };
  });
  app.get("/v1/me", async (req) => ({ product: product(req) }));
  app.post("/v1/logout", async (req, reply) => {
    const p = product(req);
    store.revokeCredentials("console", p.id);
    reply.clearCookie("lb_session", { path: "/" });
    return { ok: true };
  });
  app.get("/v1/capabilities", async (req) => {
    const p = product(req);
    return {
      version: VERSION,
      apiVersion: API_VERSION,
      build: BUILD,
      upstream: "huashu-chrome@1.2.0",
      tools: tools.map((t) => ({
        ...t,
        authorized:
          p.role === "owner" ||
          (p.scopes.includes("browser.read") && readingTools.has(t.name)),
        status: "implemented_pending_environment_verification",
      })),
      tasks: [
        {
          name: "article.capture@v1",
          authorized:
            p.role === "owner" || p.scopes.includes("article.capture"),
        },
      ],
      profiles: store
        .list<Profile>("profile")
        .filter((x) => p.role === "owner" || x.productIds.includes(p.id)),
      limits: {
        activeSeconds: 180,
        humanSeconds: 600,
        wallSeconds: 900,
        articleBytes: 50 * 1024 ** 2,
        concurrency: broker.concurrency,
      },
      limitations: [
        "站点登录/验证与运行时就绪分别验收",
        "受限产品不提供任意代码执行",
      ],
    };
  });
  app.get("/v1/admin/products", async (req) => {
    owner(req);
    return { items: store.list("product") };
  });
  app.post("/v1/admin/products", { schema }, async (req: any) => {
    owner(req);
    const name = String(req.body.name || "").trim();
    if (!name || name.length > 100)
      throw new Fault("INVALID_ARGUMENT", "请提供产品名称");
    const allowed = [
      "article.capture",
      "browser.read",
      "artifacts.write",
      "learnings.write",
    ];
    const scopes = Array.isArray(req.body.scopes)
      ? req.body.scopes
      : ["article.capture", "artifacts.write"];
    if (scopes.some((s: any) => !allowed.includes(s)))
      throw new Fault("INVALID_ARGUMENT", "权限范围无效");
    const created = store.createProduct(name, "product", scopes);
    if (req.body.limits)
      created.product = store.put("product", created.product.id, {
        ...created.product,
        limits: req.body.limits,
      });
    return created;
  });
  app.patch("/v1/admin/products/:id", async (req: any) => {
    owner(req);
    const p = store.get<Product>("product", req.params.id);
    if (!p || p.revoked) throw new Fault("FORBIDDEN", "身份不可用", 403);
    return store.put("product", p.id, {
      ...p,
      limits: { ...p.limits, ...req.body.limits },
    });
  });
  app.delete("/v1/admin/products/:id", async (req: any) => {
    owner(req);
    const p = store.get<Product>("product", req.params.id);
    if (!p || p.role === "owner")
      throw new Fault("FORBIDDEN", "无法撤销该身份", 403);
    store.put("product", p.id, { ...p, revoked: true });
    store.revokeCredentials("product", p.id);
    artifacts.revokeProduct(p.id);
    for (const job of store.jobs(p)) broker.cancel(job);
    return { revoked: true };
  });
  app.post("/v1/admin/products/:id/rotate", async (req: any) => {
    owner(req);
    const p = store.get<Product>("product", req.params.id);
    if (!p || p.revoked) throw new Fault("FORBIDDEN", "身份不可用", 403);
    store.revokeCredentials("product", p.id);
    artifacts.revokeProduct(p.id);
    return { token: store.credential("product", p.id) };
  });
  app.get("/v1/admin/workers", async (req) => {
    owner(req);
    return {
      items: store
        .list<any>("worker")
        .map((w) => ({ ...w, connected: broker.workers.has(w.id) })),
    };
  });
  app.post("/v1/admin/workers", { schema }, async (req: any) => {
    owner(req);
    const body = req.body || {};
    const workerId = id("wrk"),
      profileId = id("prf");
    const isolated = body.mode === "isolated";
    const w = {
      id: workerId,
      name: String(body.name || "新执行端").slice(0, 100),
      profileId,
      revoked: false,
      status: "unpaired",
      isolationVerified: false,
    };
    const p: Profile = {
      id: profileId,
      name: w.name,
      workerId,
      mode: isolated ? "isolated" : "owner",
      productIds: [],
      network: isolated ? "public" : "owner",
      ready: false,
      quarantined: false,
      version: 1,
    };
    store.put("worker", workerId, w);
    store.put("profile", profileId, p);
    return {
      worker: w,
      profile: p,
      token: store.credential("worker", workerId),
    };
  });
  app.post("/v1/admin/workers/:id/attest", { schema }, async (req: any) => {
    owner(req);
    const w = store.get<any>("worker", req.params.id);
    const report = req.body;
    const names = [
      "nonRoot",
      "browserSandbox",
      "internalNetwork",
      "privateNetworkDenied",
      "directEgressDenied",
      "controlRoutesDenied",
      "publicEgressAllowed",
      "noSharedDesktop",
    ];
    if (
      !w ||
      report.workerId !== w.id ||
      report.profileId !== w.profileId ||
      !report.imageDigest ||
      !report.bootId ||
      report.bootId !== w.bootId ||
      names.some((n) => report.checks?.[n] !== true)
    )
      throw new Fault(
        "ISOLATION_NOT_VERIFIED",
        "隔离报告缺少通过的实测项",
        409,
      );
    if (!broker.workers.has(w.id))
      throw new Fault("WORKER_OFFLINE", "执行端未就绪", 409);
    store.put("isolation-report", w.id, { ...report, attestedAt: Date.now() });
    return store.put("worker", w.id, {
      ...w,
      isolationVerified: true,
      isolationImageDigest: report.imageDigest,
    });
  });
  app.delete("/v1/admin/workers/:id", async (req: any) => {
    owner(req);
    const w = store.get<any>("worker", req.params.id);
    if (!w) throw new Fault("FORBIDDEN", "无权访问此资源", 403);
    store.put("worker", w.id, { ...w, revoked: true });
    store.revokeCredentials("worker", w.id);
    broker.workers.get(w.id)?.socket.close(4003, "revoked");
    broker.quarantine(w.profileId);
    return { revoked: true };
  });
  app.get("/v1/profiles", async (req) => {
    const p = product(req);
    return {
      items: store
        .list<Profile>("profile")
        .filter((x) => p.role === "owner" || x.productIds.includes(p.id)),
    };
  });
  app.patch("/v1/admin/profiles/:id", { schema }, async (req: any) => {
    const p = owner(req),
      profile = store.profile(p, req.params.id);
    const ids = req.body.productIds;
    if (
      !Array.isArray(ids) ||
      ids.some((x) => !store.get<Product>("product", x))
    )
      throw new Fault("INVALID_ARGUMENT", "产品授权列表无效");
    if (profile.mode === "owner" && ids.length)
      throw new Fault("FORBIDDEN", "日常浏览器完整权限不能转授给受限产品", 403);
    if (ids.length > 1)
      throw new Fault(
        "INVALID_ARGUMENT",
        "每个受限浏览器只绑定一个产品；为其他产品建立独立浏览器",
      );
    const bound = (profile as any).boundProductId;
    if (bound && ids.length && ids[0] !== bound)
      throw new Fault(
        "FORBIDDEN",
        "不能把已有浏览器数据转授给其他产品；请建立新浏览器",
        403,
      );
    for (const j of store
      .jobs()
      .filter(
        (j) =>
          j.profileId === profile.id &&
          j.productId !== p.id &&
          !ids.includes(j.productId),
      ))
      broker.cancel(j);
    return store.put("profile", profile.id, {
      ...profile,
      productIds: ids,
      boundProductId: bound || ids[0] || null,
      version: profile.version + 1,
    });
  });
  app.put("/v1/admin/profiles/:id/account-policy", async (req: any) => {
    const profile = store.profile(owner(req), req.params.id),
      policy = req.body;
    if (
      policy.origins.some(
        (origin: string) => safeUrl(origin).origin !== origin,
      ) ||
      (policy.mode === "required" && !policy.origins.length)
    )
      throw new Fault(
        "INVALID_ARGUMENT",
        "请填写精确站点 origin；要求账号时至少指定一个站点",
      );
    const previous = store.get("account-policy", profile.id) || {
      mode: "anonymous",
      origins: [],
    };
    if (canonical(previous) !== canonical(policy))
      for (const job of store
        .jobs()
        .filter((j) => j.profileId === profile.id && !TERMINAL.has(j.state)))
        broker.cancel(job);
    store.put("account-policy", profile.id, policy);
    return {
      profileId: profile.id,
      mode: policy.mode,
      origins: policy.origins,
      verifierConfigured: !!(policy.selector && policy.expectedHash),
    };
  });
  app.get("/v1/admin/profiles/:id/account-policy", async (req: any) => {
    const profile = store.profile(owner(req), req.params.id);
    return {
      profileId: profile.id,
      ...(store.get("account-policy", profile.id) || {
        mode: "anonymous",
        origins: [],
      }),
    };
  });
  app.post("/v1/admin/profiles/:id/recover", { schema }, async (req: any) => {
    const p = owner(req),
      profile = store.profile(p, req.params.id);
    if (
      req.body.confirmStopped !== true ||
      req.body.acknowledgeUnknownEffects !== true
    )
      throw new Fault(
        "CONFIRMATION_REQUIRED",
        "必须确认旧执行已停止并核对未知效果",
        409,
      );
    if (broker.workers.has(profile.workerId))
      throw new Fault(
        "PROFILE_BUSY",
        "先停止旧执行端，再解除隔离并重新启动",
        409,
      );
    for (const j of store.jobs().filter((j) => j.profileId === profile.id)) {
      store.release(profile.id, j.id);
      if (j.state === "suspended" && j.cancelRequested)
        store.transition(j.id, "cancelled", { effectState: j.effectState });
    }
    return store.put("profile", profile.id, {
      ...profile,
      quarantined: false,
      ready: false,
    });
  });
  app.post("/v1/sessions", { schema }, async (req: any) => {
    const p = product(req),
      profile = store.profile(p, String(req.body.profileId));
    const s = {
      id: id("ses"),
      productId: p.id,
      profileId: profile.id,
      createdAt: Date.now(),
      closed: false,
    };
    return store.put("session", s.id, s);
  });
  app.get("/v1/sessions/:id", async (req: any) =>
    session(product(req), req.params.id),
  );
  app.delete("/v1/sessions/:id", async (req: any) => {
    const p = product(req),
      s = session(p, req.params.id);
    store.put("session", s.id, { ...s, closed: true });
    for (const j of store.jobs(p).filter((j) => j.sessionId === s.id))
      broker.cancel(j);
    return { closed: true };
  });
  app.get("/v1/sessions/:id/commands", async (req: any) => {
    const p = product(req),
      s = session(p, req.params.id);
    return {
      items: store
        .jobs(p)
        .filter((j) => j.sessionId === s.id)
        .map(viewJob),
    };
  });
  app.post("/v1/sessions/:id/commands", { schema }, async (req: any, reply) => {
    const p = product(req),
      s = session(p, req.params.id),
      profile = store.profile(p, s.profileId);
    const { tool, args = {}, inputArtifacts = {} } = req.body;
    validateTool(tool, args);
    if (
      p.role !== "owner" &&
      (!p.scopes.includes("browser.read") ||
        !readingTools.has(tool) ||
        profile.mode !== "isolated")
    )
      throw new Fault("FORBIDDEN", "调用方没有此工具的执行权限", 403);
    if (
      p.role !== "owner" &&
      profile.mode === "isolated" &&
      !store.get<any>("worker", profile.workerId)?.isolationVerified
    )
      throw new Fault("CAPABILITY_UNAVAILABLE", "执行端隔离尚未通过实测", 503);
    if (args.path && !inputArtifacts.path)
      throw new Fault(
        "INVALID_ARGUMENT",
        "远程文件输入须通过 inputArtifacts.path 引用 artifactId",
      );
    if (args.savePath) filename(args.savePath);
    for (const key of Object.values(inputArtifacts))
      artifacts.owned(p, String(key));
    if ("__lb" in args)
      throw new Fault("INVALID_ARGUMENT", "调用参数包含保留字段");
    if (
      p.role !== "owner" &&
      store.get<any>("account-policy", profile.id)?.mode === "required"
    )
      throw new Fault(
        "ACCOUNT_VERIFICATION_REQUIRED",
        "此浏览器要求账号核验，请使用受控采集任务",
        403,
      );
    const record = store.createJob(p, "command", idem(req), {
      sessionId: s.id,
      profileId: profile.id,
      workerId: profile.workerId,
      type: tool,
      input: {
        args,
        inputArtifacts,
        ...(req.body.requestId ? { requestId: req.body.requestId } : {}),
      },
      wallTimeoutSeconds: bounded(req.body.wallTimeoutSeconds, 900, 1, 3600),
    });
    reply.code(202);
    return { ...viewJob(record.job), created: record.created };
  });
  app.post("/v1/tasks", { schema }, async (req: any, reply) => {
    const p = product(req),
      body = req.body || {};
    if (!["article.capture@v1", "browser.flow@v1"].includes(body.type))
      throw new Fault("CAPABILITY_UNAVAILABLE", "任务能力不存在", 404);
    if (body.type === "browser.flow@v1" && p.role !== "owner")
      throw new Fault("FORBIDDEN", "自定义流程仅向所有者开放", 403);
    if (
      body.type === "article.capture@v1" &&
      p.role !== "owner" &&
      !p.scopes.includes("article.capture")
    )
      throw new Fault("FORBIDDEN", "未授权采集能力", 403);
    const profile = store.profile(
      p,
      String(body.execution?.profileId || body.profileId),
    );
    if (
      p.role !== "owner" &&
      (profile.mode !== "isolated" ||
        !store.get<any>("worker", profile.workerId)?.isolationVerified)
    )
      throw new Fault(
        "CAPABILITY_UNAVAILABLE",
        "受限任务需要已通过隔离实测的浏览器",
        503,
      );
    if (
      ["server", "desktop"].includes(body.execution?.mode) &&
      store.get<any>("worker", profile.workerId)?.environment?.location !==
        body.execution.mode
    )
      throw new Fault(
        "EXECUTION_MISMATCH",
        "指定执行端不符合执行位置要求",
        409,
      );
    if (body.type === "article.capture@v1") safeUrl(body.input?.url);
    else {
      const steps = body.input?.steps;
      if (!Array.isArray(steps) || !steps.length || steps.length > 30)
        throw new Fault("INVALID_ARGUMENT", "流程需包含1到30步");
      for (const step of steps) {
        validateTool(step.tool, step.args || {});
        if (step.args?.path || step.args?.savePath || step.args?.__lb)
          throw new Fault(
            "INVALID_ARGUMENT",
            "流程文件操作请使用独立命令与 artifactId；不接受主机路径或保留参数",
          );
      }
    }
    const limits = {
      queueTimeoutSeconds: bounded(
        body.limits?.queueTimeoutSeconds,
        60,
        1,
        900,
      ),
      activeTimeoutSeconds: bounded(
        body.limits?.activeTimeoutSeconds,
        180,
        1,
        1800,
      ),
      humanWaitSeconds: bounded(body.limits?.humanWaitSeconds, 600, 5, 600),
      wallTimeoutSeconds: bounded(
        body.limits?.wallTimeoutSeconds,
        900,
        5,
        3600,
      ),
      maxSteps: bounded(body.limits?.maxSteps, 500, 1, 2000),
      maxBytes: bounded(body.limits?.maxBytes, 50 * 1024 ** 2, 1024, 1024 ** 3),
      maxTabs: bounded(body.limits?.maxTabs, 8, 1, 50),
    };
    const record = store.createJob(p, "task", idem(req), {
      profileId: profile.id,
      workerId: profile.workerId,
      type: body.type,
      input: {
        ...body.input,
        limits,
        ...(body.requestId ? { requestId: body.requestId } : {}),
      },
      wallTimeoutSeconds: limits.wallTimeoutSeconds,
    });
    reply.code(202);
    return { ...viewJob(record.job), created: record.created };
  });
  app.get("/v1/tasks", async (req: any) => ({
    items: store
      .jobs(product(req))
      .filter((j) => j.kind === "task" || req.query.includeCommands === "1")
      .map(viewJob),
  }));
  for (const kind of ["tasks", "commands"]) {
    app.get(`/v1/${kind}/:id`, async (req: any) =>
      viewJob(store.ownedJob(product(req), req.params.id)),
    );
    app.post(`/v1/${kind}/:id/cancel`, async (req: any) =>
      viewJob(broker.cancel(store.ownedJob(product(req), req.params.id))),
    );
  }
  app.post("/v1/tasks/:id/resume", async (req: any) => {
    const p = product(req),
      job = store.ownedJob(p, req.params.id);
    store.profile(p, job.profileId);
    return viewJob(broker.resume(job));
  });
  app.get("/v1/tasks/:id/events", async (req: any, reply) => {
    const p = product(req);
    store.ownedJob(p, req.params.id);
    let after = bounded(
      req.headers["last-event-id"] || req.query.after,
      0,
      0,
      Number.MAX_SAFE_INTEGER,
    );
    reply.hijack();
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-store",
      connection: "keep-alive",
    });
    const tick = () => {
      try {
        product(req);
      } catch {
        reply.raw.end();
        return;
      }
      const rows = store.events(req.params.id, after);
      for (const e of rows) {
        after = e.id;
        reply.raw.write(
          `id: ${e.id}\nevent: ${e.kind}\ndata: ${JSON.stringify(e)}\n\n`,
        );
      }
      if (!rows.length) reply.raw.write(": heartbeat\n\n");
    };
    tick();
    const timer = setInterval(tick, 1000);
    reply.raw.on("close", () => clearInterval(timer));
  });
  app.addContentTypeParser("application/octet-stream", (req, payload, done) =>
    done(null, payload),
  );
  app.post("/v1/artifacts", async (req: any, reply) => {
    const p = product(req);
    if (p.role !== "owner" && !p.scopes.includes("artifacts.write"))
      throw new Fault("FORBIDDEN", "未授权上传", 403);
    const a = await artifacts.write(
      p.id,
      decodeURIComponent(String(req.headers["x-filename"] || "upload.bin")),
      String(req.headers["x-mime-type"] || "application/octet-stream"),
      req.body,
      {
        expectedHash: req.headers["x-sha256"],
        authorize: () => {
          product(req);
        },
      },
    );
    reply.code(201);
    return a;
  });
  app.get("/v1/artifacts", async (req) => ({
    items: store.artifacts(product(req)).filter((a) => !a.deleted),
  }));
  app.get("/v1/artifacts/:id", async (req: any) =>
    artifacts.owned(product(req), req.params.id),
  );
  app.get("/v1/artifacts/:id/content", async (req: any, reply) => {
    const p = product(req),
      a = artifacts.owned(p, req.params.id);
    reply
      .type(a.mime)
      .header(
        "Content-Disposition",
        `attachment; filename*=UTF-8''${encodeURIComponent(a.filename)}`,
      )
      .header("Content-Length", a.bytes)
      .header("Cache-Control", "no-store")
      .header("Content-Security-Policy", "default-src 'none'; sandbox");
    return reply.send(artifacts.download(p, a.id));
  });
  app.get("/v1/artifacts/:id/preview", async (req: any, reply) => {
    const p = product(req),
      a = artifacts.owned(p, req.params.id);
    const job = a.jobId && store.ownedJob(p, a.jobId);
    if (
      a.filename !== "article.html" ||
      a.mime !== "text/html" ||
      !job ||
      job.type !== "article.capture@v1" ||
      a.metadata?.source !== "worker"
    )
      throw new Fault("PREVIEW_UNAVAILABLE", "仅预览本服务生成的安全图文", 403);
    let html = fs.readFileSync(artifacts.path(a.id), "utf8");
    for (const file of job.result?.artifacts || []) {
      if (!/^image-\d+\.(png|jpeg|webp|gif|avif|tiff)$/.test(file.filename))
        continue;
      artifacts.owned(p, file.id);
      html = html.replaceAll(
        "images/" + file.filename,
        `/v1/artifacts/${file.id}/content`,
      );
    }
    reply
      .header("Content-Type", "text/html; charset=utf-8")
      .header(
        "Content-Security-Policy",
        "sandbox allow-same-origin; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'",
      );
    return html;
  });
  app.delete("/v1/artifacts/:id", async (req: any) =>
    artifacts.remove(product(req), req.params.id),
  );
  app.get("/v1/learnings", async (req: any) => {
    const p = product(req);
    const domain = String(req.query.domain || "");
    if (!domain)
      return {
        sites: JSON.parse(
          fs.readFileSync(
            path.join(ROOT, "docs/LAOFU_BROWSER_BASELINE.json"),
            "utf8",
          ),
        ).siteNotes,
      };
    if (!/^[a-z0-9.-]+$/.test(domain))
      throw new Fault("INVALID_ARGUMENT", "域名无效");
    const local = store.note(p.id, domain);
    const seed = path.join(
      ROOT,
      "vendor/huashu-chrome-1.2.0/docs/经验",
      domain + ".md",
    );
    return {
      domain,
      ...local,
      history: store
        .noteHistory(p.id, domain)
        .map(({ body, ...meta }: any) => meta),
      seed: fs.existsSync(seed) ? fs.readFileSync(seed, "utf8") : "",
    };
  });
  app.put("/v1/learnings/:domain", { schema }, async (req: any) => {
    const p = product(req);
    if (p.role !== "owner" && !p.scopes.includes("learnings.write"))
      throw new Fault("FORBIDDEN", "没有经验写权限", 403);
    if (
      !/^[a-z0-9.-]+$/.test(req.params.domain) ||
      typeof req.body.body !== "string" ||
      req.body.body.length > 100000
    )
      throw new Fault("INVALID_ARGUMENT", "经验格式无效");
    return store.saveNote(
      p.id,
      req.params.domain,
      req.body.body,
      bounded(req.body.version, 0, 0, 1e9),
    );
  });
  app.post("/v1/learnings/:domain/restore", async (req: any) => {
    const p = product(req);
    if (p.role !== "owner" && !p.scopes.includes("learnings.write"))
      throw new Fault("FORBIDDEN", "没有经验写权限", 403);
    const previous = store
      .noteHistory(p.id, req.params.domain)
      .find((row) => row.version === req.body.targetVersion);
    if (!previous) throw new Fault("FORBIDDEN", "无权访问此版本", 403);
    return store.saveNote(
      p.id,
      req.params.domain,
      previous.body,
      bounded(req.body.version, 0, 0, 1e9),
    );
  });
  app.get("/v1/diagnostics", async (req) => {
    const p = product(req),
      jobs = store.jobs(p),
      arts = store.artifacts(p);
    return {
      version: VERSION,
      upstream: "1.2.0",
      runtime: process.version,
      workers:
        p.role === "owner"
          ? store
              .list<any>("worker")
              .map((w) => ({ ...w, connected: broker.workers.has(w.id) }))
          : [],
      counts: {
        tasks: jobs.length,
        succeeded: jobs.filter((j) => j.state === "succeeded").length,
        partial: jobs.filter((j) => j.state === "partial").length,
        waiting: jobs.filter((j) => j.state === "waiting_user").length,
        unknown: jobs.filter((j) => j.effectState === "unknown").length,
        artifactBytes: arts
          .filter((a) => !a.deleted)
          .reduce((n, a) => n + a.bytes, 0),
      },
      policy: {
        logRetentionDays: 30,
        artifactRetention: "manual",
        quotaBytes: artifacts.quota,
        productLimits: { ...PRODUCT_LIMITS, ...p.limits },
      },
      cooldowns: store
        .list<any>("cooldown")
        .filter(
          (c) =>
            p.role === "owner" ||
            store
              .get<Profile>("profile", c.profileId)
              ?.productIds.includes(p.id),
        )
        .map(({ accountScope, ...c }) => c),
      modelCalls: 0,
    };
  });
  app.get("/v1/admin/cooldowns", async (req: any) => {
    owner(req);
    return { items: store.list("cooldown") };
  });
  app.post("/v1/admin/cooldowns/:id/release", async (req: any) => {
    owner(req);
    return store.releaseCooldown(req.params.id);
  });
  app.post("/v1/tasks/:id/handoffs", async (req: any, reply) => {
    const p = product(req),
      job = store.ownedJob(p, req.params.id);
    if (job.state !== "waiting_user" || job.cancelRequested)
      throw new Fault("HANDOFF_NOT_AVAILABLE", "任务当前不需要人工接手", 409);
    const prior = store
      .list<any>("handoff")
      .find(
        (h) =>
          h.jobId === job.id &&
          h.productId === p.id &&
          !h.revoked &&
          h.expiresAt > Date.now(),
      );
    const h = prior || {
      id: id("hnd"),
      jobId: job.id,
      profileId: job.profileId,
      productId: p.id,
      workerId: job.workerId,
      expiresAt: Math.min(job.expiresAt, Date.now() + 600000),
      revoked: false,
    };
    store.put("handoff", h.id, h);
    store.revokeCredentials("handoff", h.id);
    const ttl = Math.min(60000, h.expiresAt - Date.now());
    const ticket = store.credential("handoff", h.id, ttl);
    reply
      .header("Cache-Control", "no-store")
      .setCookie(`lb_handoff_${h.id}`, ticket, {
        httpOnly: true,
        sameSite: "strict",
        secure: req.protocol === "https",
        path: `/v1/handoffs/${h.id}/socket`,
        maxAge: Math.floor(ttl / 1000),
      });
    return {
      ...h,
      ticket,
      ticketExpiresAt: Date.now() + ttl,
      connectionPolicy: "single_use",
    };
  });
  app.delete("/v1/tasks/:id/handoffs/:handoff", async (req: any) => {
    store.ownedJob(product(req), req.params.id);
    const h = store.get<any>("handoff", req.params.handoff);
    if (!h || h.jobId !== req.params.id)
      throw new Fault("FORBIDDEN", "无权访问此资源", 403);
    store.put("handoff", h.id, { ...h, revoked: true });
    store.revokeCredentials("handoff", h.id);
    broker.closeViewers(h.jobId);
    return { revoked: true };
  });
  app.get(
    "/v1/handoffs/:id/socket",
    { websocket: true },
    (socket, req: any) => {
      try {
        const p = product(req),
          h = store.get<any>("handoff", req.params.id);
        if (!h || h.revoked || h.expiresAt < Date.now() || h.productId !== p.id)
          throw new Error("forbidden");
        const job = store.ownedJob(p, h.jobId);
        if (job.state !== "waiting_user" || job.cancelRequested)
          throw new Error("unavailable");
        if ([...broker.viewers.values()].some((v) => v.jobId === job.id))
          throw new Error("already controlled");
        const ticket = String(
          req.headers["x-handoff-ticket"] ||
            req.cookies[`lb_handoff_${h.id}`] ||
            "",
        );
        if (!ticket || !store.consumeCredential(ticket, "handoff", h.id))
          throw new Error("ticket invalid or used");
        const viewerId = id("view");
        broker.viewers.set(viewerId, {
          socket,
          workerId: h.workerId,
          jobId: job.id,
        });
        broker.send(h.workerId, { type: "view_open", viewerId, jobId: job.id });
        const authTimer = setInterval(() => {
          try {
            product(req);
            store.profile(p, job.profileId);
          } catch {
            socket.close(4003, "authorization expired");
          }
        }, 1000);
        const timer = setTimeout(
          () => socket.close(),
          Math.max(1, h.expiresAt - Date.now()),
        );
        socket.on("message", (raw) => {
          try {
            product(req);
            store.profile(p, job.profileId);
          } catch {
            socket.close(4003, "authorization expired");
            return;
          }
          const latest = store.get<any>("handoff", h.id),
            actor = store.get<Product>("product", p.id);
          if (
            !latest ||
            latest.revoked ||
            latest.expiresAt < Date.now() ||
            !actor ||
            actor.revoked ||
            store.job(job.id)?.state !== "waiting_user"
          ) {
            socket.close();
            return;
          }
          broker.send(h.workerId, {
            type: "view_input",
            viewerId,
            data: Buffer.from(raw as any).toString("base64"),
          });
        });
        socket.on("close", () => {
          clearTimeout(timer);
          clearInterval(authTimer);
          broker.viewers.delete(viewerId);
          try {
            broker.send(h.workerId, { type: "view_close", viewerId });
          } catch {}
        });
      } catch {
        socket.close(4003, "handoff not authorized");
      }
    },
  );
  app.get("/v1/worker/connect", { websocket: true }, (socket, req: any) => {
    try {
      const w = worker(req);
      broker.attach(w.id, socket);
    } catch {
      socket.close(4003, "worker authentication failed");
    }
  });
  app.post("/v1/worker/artifacts", async (req: any) => {
    const w = worker(req),
      job = store.job(String(req.query.jobId));
    if (
      !job ||
      job.workerId !== w.id ||
      !["running", "waiting_user"].includes(job.state) ||
      job.cancelRequested
    )
      throw new Fault("FORBIDDEN", "此执行端不能提交该任务产物", 403);
    return artifacts.write(
      job.productId,
      decodeURIComponent(String(req.headers["x-filename"] || "artifact.bin")),
      String(req.headers["x-mime-type"] || "application/octet-stream"),
      req.body,
      {
        jobId: job.id,
        expectedHash: req.headers["x-sha256"],
        maxBytes:
          job.kind === "task" ? job.input.limits?.maxBytes : 512 * 1024 ** 2,
        metadata: { source: "worker" },
        authorize: () => {
          worker(req);
          const current = store.job(job.id);
          if (
            !current ||
            current.state !== "running" ||
            current.cancelRequested
          )
            throw new Fault("FORBIDDEN", "文件传输授权已停止", 403);
        },
      },
    );
  });
  app.post("/v1/worker/learnings", { schema }, async (req: any) => {
    const w = worker(req),
      job = store.job(req.body.jobId);
    if (
      !job ||
      job.workerId !== w.id ||
      job.state !== "running" ||
      job.type !== "learnings"
    )
      throw new Fault("FORBIDDEN", "经验命令未授权", 403);
    const args = job.input.args || {};
    if (!args.domain) return { text: JSON.stringify(baselineSiteNotes()) };
    let domain = String(args.domain);
    try {
      domain = new URL(domain.includes("://") ? domain : "https://" + domain)
        .hostname;
    } catch {
      throw new Fault("INVALID_ARGUMENT", "域名无效");
    }
    if (!/^[a-z0-9.-]+$/.test(domain))
      throw new Fault("INVALID_ARGUMENT", "域名无效");
    let note = store.note(job.productId, domain);
    if (args.save != null) {
      return store.db.transaction(() => {
        const marker = store.get<any>("learning-command", job.id);
        if (marker) return marker;
        note = store.saveNote(
          job.productId,
          domain,
          String(args.save),
          note.version,
        );
        const result = {
          text: "经验已保存 · 版本 " + note.version,
          version: note.version,
        };
        store.put("learning-command", job.id, result);
        return result;
      })();
    }
    const seed = path.join(
      ROOT,
      "vendor/huashu-chrome-1.2.0/docs/经验",
      domain + ".md",
    );
    return {
      text:
        note.body ||
        (fs.existsSync(seed) ? fs.readFileSync(seed, "utf8") : "暂无站点经验"),
      version: note.version,
    };
  });
  function baselineSiteNotes() {
    return JSON.parse(
      fs.readFileSync(
        path.join(ROOT, "docs/LAOFU_BROWSER_BASELINE.json"),
        "utf8",
      ),
    ).siteNotes;
  }
  app.get("/v1/worker/artifacts/:id", async (req: any, reply) => {
    const w = worker(req),
      job = store.job(String(req.query.jobId));
    if (
      !job ||
      job.workerId !== w.id ||
      job.state !== "running" ||
      job.cancelRequested
    )
      throw new Fault("FORBIDDEN", "文件输入未授权", 403);
    const inputs = job.input.inputArtifacts || {};
    if (!Object.values(inputs).includes(req.params.id))
      throw new Fault("FORBIDDEN", "文件不属于此命令输入", 403);
    const a = store.artifact(req.params.id);
    if (!a || a.deleted || a.productId !== job.productId)
      throw new Fault("FORBIDDEN", "文件输入未授权", 403);
    reply.type(a.mime).header("x-sha256", a.sha256);
    return reply.send(
      artifacts.download(store.get<Product>("product", job.productId)!, a.id),
    );
  });
  const webRoot = path.join(ROOT, "dist/web");
  if (fs.existsSync(webRoot)) {
    await app.register(staticFiles, {
      root: webRoot,
      prefix: "/",
      wildcard: false,
    });
  }
  app.addHook("onClose", async () => {
    broker.close();
    logs.close();
    store.close();
  });
  return {
    app,
    store,
    broker,
    artifacts,
    listen: () =>
      app.listen({
        host: options.host || "127.0.0.1",
        port: options.port || 17889,
      }),
  };
}
