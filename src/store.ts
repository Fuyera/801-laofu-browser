import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { Fault } from "./errors.js";
import { canonical, hash, id, mkdir, secret } from "./util.js";
import {
  TERMINAL,
  PRODUCT_LIMITS,
  type Product,
  type Profile,
  type Job,
  type State,
  type Effect,
  type Artifact,
} from "./types.js";
const parse = (row: any) => (row ? JSON.parse(row.payload) : undefined);
export class Store {
  readonly db: Database.Database;
  constructor(public home: string) {
    mkdir(home);
    this.db = new Database(path.join(home, "state.sqlite"));
    fs.chmodSync(path.join(home, "state.sqlite"), 0o600);
    const version = this.db.pragma("user_version", { simple: true }) as number;
    if (version > 1) {
      this.db.close();
      throw new Fault(
        "SCHEMA_NEWER",
        "数据库版本高于当前程序支持范围，请使用匹配的发行包",
      );
    }
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("synchronous = FULL");
    this.db.pragma("busy_timeout = 5000");
    this.db.exec(`
 CREATE TABLE IF NOT EXISTS resources(kind TEXT NOT NULL,id TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(kind,id));
 CREATE TABLE IF NOT EXISTS credentials(digest TEXT PRIMARY KEY,kind TEXT NOT NULL,subject TEXT NOT NULL,expires INTEGER);
 CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,kind TEXT NOT NULL,product_id TEXT NOT NULL,idem TEXT NOT NULL,request_hash TEXT NOT NULL,profile_id TEXT NOT NULL,state TEXT NOT NULL,payload TEXT NOT NULL,UNIQUE(kind,product_id,idem));
 CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY AUTOINCREMENT,job_id TEXT NOT NULL,kind TEXT NOT NULL,payload TEXT NOT NULL,created INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS leases(profile_id TEXT PRIMARY KEY,holder TEXT,fence INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS artifacts(id TEXT PRIMARY KEY,product_id TEXT NOT NULL,payload TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS journal(id TEXT PRIMARY KEY,request_hash TEXT NOT NULL,state TEXT NOT NULL,payload TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS notes(scope TEXT NOT NULL,domain TEXT NOT NULL,version INTEGER NOT NULL,body TEXT NOT NULL,PRIMARY KEY(scope,domain,version));
 `);
    this.db.pragma("user_version = 1");
  }
  get<T = any>(kind: string, key: string): T | undefined {
    return parse(
      this.db
        .prepare("SELECT payload FROM resources WHERE kind=? AND id=?")
        .get(kind, key),
    );
  }
  list<T = any>(kind: string): T[] {
    return this.db
      .prepare("SELECT payload FROM resources WHERE kind=?")
      .all(kind)
      .map(parse);
  }
  put(kind: string, key: string, value: any) {
    this.db
      .prepare(
        "INSERT INTO resources VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET payload=excluded.payload",
      )
      .run(kind, key, JSON.stringify(value));
    return value;
  }
  credential(kind: string, subject: string, ttlMs?: number) {
    const token = (kind === "worker" ? "lbw_" : "lbk_") + secret();
    this.db
      .prepare("INSERT INTO credentials VALUES(?,?,?,?)")
      .run(hash(token), kind, subject, ttlMs ? Date.now() + ttlMs : null);
    return token;
  }
  authenticate(token: string, kind = "product"): string | undefined {
    const row = this.db
      .prepare(
        "SELECT subject,expires FROM credentials WHERE digest=? AND kind=?",
      )
      .get(hash(token), kind) as any;
    return row && (!row.expires || row.expires > Date.now())
      ? row.subject
      : undefined;
  }
  revokeCredentials(kind: string, subject: string) {
    this.db
      .prepare("DELETE FROM credentials WHERE kind=? AND subject=?")
      .run(kind, subject);
  }
  consumeCredential(token: string, kind: string, subject: string) {
    return this.db.transaction(() => {
      if (this.authenticate(token, kind) !== subject) return false;
      return (
        this.db
          .prepare(
            "DELETE FROM credentials WHERE digest=? AND kind=? AND subject=?",
          )
          .run(hash(token), kind, subject).changes === 1
      );
    })();
  }
  createProduct(
    name: string,
    role: "owner" | "product" = "product",
    scopes: string[] = ["article.capture"],
  ) {
    const product: Product = {
      id: id("prd"),
      name,
      role,
      scopes,
      revoked: false,
    };
    this.put("product", product.id, product);
    return { product, token: this.credential("product", product.id) };
  }
  product(token: string) {
    const key = this.authenticate(token);
    const p = key && this.get<Product>("product", key);
    if (!p || p.revoked)
      throw new Fault("UNAUTHORIZED", "需要有效调用凭据", 401);
    return p;
  }
  profile(p: Product, key: string) {
    const profile = this.get<Profile>("profile", key);
    if (!profile || (p.role !== "owner" && !profile.productIds.includes(p.id)))
      throw new Fault("FORBIDDEN", "无权访问此资源", 403);
    return profile;
  }
  recordCooldown(
    job: Job,
    evidence: { origin: string; retryAfter?: string | null },
  ) {
    const origin = new URL(evidence.origin).origin;
    const retryAfter = evidence.retryAfter?.slice(0, 200) ?? null;
    const now = Date.now();
    const seconds =
      retryAfter !== null && /^\d+$/.test(retryAfter)
        ? Number(retryAfter)
        : NaN;
    const date =
      retryAfter && /^[A-Za-z]{3},/.test(retryAfter)
        ? Date.parse(retryAfter)
        : NaN;
    const until =
      Number.isSafeInteger(seconds) && seconds >= 0
        ? now + seconds * 1000
        : Number.isFinite(date)
          ? Math.max(now, date)
          : null;
    // Local profiles share the same host egress. Be conservative across products at this exit.
    const egressId =
      this.get<any>("worker", job.workerId)?.egressId || "mac-local-exit";
    const key = "cool_" + hash(origin + "|" + egressId).slice(0, 32);
    const prior = this.get<any>("cooldown", key);
    const priorActive =
      prior && !prior.releasedAt && (prior.until === null || prior.until > now);
    const record = {
      id: key,
      origin,
      egressId,
      profileId: job.profileId,
      workerId: job.workerId,
      accountScope: job.profileId,
      jobId: job.id,
      retryAfter,
      until: priorActive
        ? prior.until === null || until === null
          ? null
          : Math.max(prior.until, until)
        : until,
      observedAt: now,
      releasedAt: null,
    };
    this.put("cooldown", key, record);
    this.event(job.id, "cooldown", {
      id: key,
      origin,
      until: record.until,
      retryAfter,
    });
    return record;
  }
  cooldown(request: { profileId: string; workerId: string; input?: any }) {
    let origin: string | undefined;
    try {
      if (request.input?.url) origin = new URL(request.input.url).origin;
    } catch {}
    const egressId =
      this.get<any>("worker", request.workerId)?.egressId || "mac-local-exit";
    return this.list<any>("cooldown").find(
      (c) =>
        !c.releasedAt &&
        (c.until === null || c.until > Date.now()) &&
        (origin
          ? c.origin === origin &&
            (c.egressId === egressId || c.profileId === request.profileId)
          : c.profileId === request.profileId),
    );
  }
  assertNotCooling(request: {
    profileId: string;
    workerId: string;
    input?: any;
  }) {
    const c = this.cooldown(request);
    if (c)
      throw new Fault(
        "SITE_COOLDOWN",
        c.until === null
          ? "站点恢复时间未知，需在诊断中明确解除冷却"
          : "站点仍在冷却，尚未到允许重试时间",
        429,
        false,
        { cooldownId: c.id, until: c.until, retryAfter: c.retryAfter },
      );
  }
  releaseCooldown(key: string) {
    const c = this.get<any>("cooldown", key);
    if (!c) throw new Fault("NOT_FOUND", "冷却记录不存在", 404);
    return this.put("cooldown", key, { ...c, releasedAt: Date.now() });
  }
  createJob(p: Product, kind: "command" | "task", idem: string, request: any) {
    if (!idem || idem.length > 200)
      throw new Fault("INVALID_ARGUMENT", "必须提供稳定的 Idempotency-Key");
    const requestHash = hash(canonical(request));
    return this.db.transaction(() => {
      const prior = this.db
        .prepare("SELECT * FROM jobs WHERE kind=? AND product_id=? AND idem=?")
        .get(kind, p.id, idem) as any;
      if (prior) {
        if (prior.request_hash !== requestHash)
          throw new Fault(
            "IDEMPOTENCY_CONFLICT",
            "同一幂等键对应不同请求",
            409,
          );
        return { job: parse(prior) as Job, created: false };
      }
      const policy = {
        ...PRODUCT_LIMITS,
        ...this.get<Product>("product", p.id)?.limits,
      };
      this.assertNotCooling(request);
      const resident = this.jobs().filter(
        (j) => j.productId === p.id && !TERMINAL.has(j.state),
      );
      if (
        resident.length >= policy.maxResident ||
        resident.filter((j) => j.state === "queued").length >= policy.maxQueued
      )
        throw new Fault(
          "PRODUCT_QUEUE_FULL",
          "产品排队或驻留任务已达到额度，请等待现有任务结束或取消",
          429,
          true,
        );
      const now = Date.now();
      const job: Job = {
        id: id(kind === "task" ? "tsk" : "cmd"),
        kind,
        productId: p.id,
        sessionId: request.sessionId || "",
        profileId: request.profileId,
        workerId: request.workerId,
        type: request.type,
        input: request.input || {},
        state: "queued",
        effectState: "not_started",
        attempt: 1,
        createdAt: now,
        updatedAt: now,
        expiresAt: now + (request.wallTimeoutSeconds || 900) * 1000,
        cancelRequested: false,
        result: null,
        error: null,
        fence: 0,
      };
      this.db
        .prepare("INSERT INTO jobs VALUES(?,?,?,?,?,?,?,?)")
        .run(
          job.id,
          kind,
          p.id,
          idem,
          requestHash,
          job.profileId,
          job.state,
          JSON.stringify(job),
        );
      this.event(job.id, "accepted", { state: "queued" });
      return { job, created: true };
    })();
  }
  job(key: string): Job | undefined {
    return parse(
      this.db.prepare("SELECT payload FROM jobs WHERE id=?").get(key),
    );
  }
  ownedJob(p: Product, key: string) {
    const j = this.job(key);
    if (!j || (p.role !== "owner" && j.productId !== p.id))
      throw new Fault("FORBIDDEN", "无权访问此资源", 403);
    return j;
  }
  jobs(p?: Product) {
    return this.db
      .prepare("SELECT payload FROM jobs ORDER BY rowid DESC")
      .all()
      .map(parse)
      .filter(
        (j: Job) => !p || p.role === "owner" || j.productId === p.id,
      ) as Job[];
  }
  updateJob(key: string, patch: Partial<Job>) {
    const j = this.job(key);
    if (!j) throw new Fault("NOT_FOUND", "任务不存在", 404);
    const next = { ...j, ...patch, updatedAt: Date.now() };
    this.db
      .prepare("UPDATE jobs SET state=?,payload=? WHERE id=?")
      .run(next.state, JSON.stringify(next), key);
    return next;
  }
  transition(key: string, state: State, patch: Partial<Job> = {}) {
    return this.db.transaction(() => {
      const j = this.job(key)!;
      if (TERMINAL.has(j.state)) {
        this.event(key, "late_evidence", {
          reportedState: state,
          effectState: patch.effectState || j.effectState,
        });
        return j;
      }
      const next = this.updateJob(key, { ...patch, state });
      this.event(key, "state", {
        state,
        effectState: next.effectState,
        error: next.error,
      });
      return next;
    })();
  }
  event(jobId: string, kind: string, payload: any) {
    const created = Date.now();
    const r = this.db
      .prepare(
        "INSERT INTO events(job_id,kind,payload,created) VALUES(?,?,?,?)",
      )
      .run(jobId, kind, JSON.stringify(payload), created);
    return {
      id: Number(r.lastInsertRowid),
      jobId,
      kind,
      data: payload,
      createdAt: created,
    };
  }
  events(jobId: string, after = 0) {
    return this.db
      .prepare(
        "SELECT * FROM events WHERE job_id=? AND id>? ORDER BY id LIMIT 500",
      )
      .all(jobId, after)
      .map((r: any) => ({
        id: r.id,
        jobId: r.job_id,
        kind: r.kind,
        data: JSON.parse(r.payload),
        createdAt: r.created,
      }));
  }
  acquire(profileId: string, holder: string) {
    return this.db.transaction(() => {
      const row = this.db
        .prepare("SELECT * FROM leases WHERE profile_id=?")
        .get(profileId) as any;
      if (row?.holder && row.holder !== holder)
        throw new Fault("PROFILE_BUSY", "浏览器正在被其他任务或用户控制", 409);
      if (row?.holder === holder) return row.fence as number;
      const fence = (row?.fence || 0) + 1;
      this.db
        .prepare(
          "INSERT INTO leases VALUES(?,?,?) ON CONFLICT(profile_id) DO UPDATE SET holder=excluded.holder,fence=excluded.fence",
        )
        .run(profileId, holder, fence);
      return fence;
    })();
  }
  release(profileId: string, holder: string) {
    this.db
      .prepare("UPDATE leases SET holder=NULL WHERE profile_id=? AND holder=?")
      .run(profileId, holder);
  }
  holds(profileId: string, holder: string, fence: number) {
    const row = this.db
      .prepare("SELECT * FROM leases WHERE profile_id=?")
      .get(profileId) as any;
    return row?.holder === holder && row.fence === fence;
  }
  journalStart(key: string, input: any) {
    return this.db.transaction(() => {
      const digest = hash(canonical(input));
      const row = this.db
        .prepare("SELECT * FROM journal WHERE id=?")
        .get(key) as any;
      if (row) {
        if (row.request_hash !== digest)
          throw new Fault("IDEMPOTENCY_CONFLICT", "执行命令摘要冲突", 409);
        return {
          fresh: false,
          state: row.state,
          result: JSON.parse(row.payload),
        };
      }
      this.db
        .prepare("INSERT INTO journal VALUES(?,?,?,?)")
        .run(key, digest, "started", "null");
      return { fresh: true, state: "started", result: null };
    })();
  }
  journalFinish(key: string, result: any) {
    this.db
      .prepare("UPDATE journal SET state=?,payload=? WHERE id=?")
      .run("confirmed", JSON.stringify(result), key);
  }
  journalUnknown(key: string, error: any) {
    this.db
      .prepare("UPDATE journal SET state=?,payload=? WHERE id=?")
      .run("unknown", JSON.stringify(error), key);
  }
  saveArtifact(a: Artifact) {
    this.db
      .prepare("INSERT INTO artifacts VALUES(?,?,?)")
      .run(a.id, a.productId, JSON.stringify(a));
    return a;
  }
  artifact(key: string): Artifact | undefined {
    return parse(
      this.db.prepare("SELECT payload FROM artifacts WHERE id=?").get(key),
    );
  }
  artifacts(p?: Product) {
    return this.db
      .prepare("SELECT payload FROM artifacts ORDER BY rowid DESC")
      .all()
      .map(parse)
      .filter(
        (a: Artifact) => !p || p.role === "owner" || a.productId === p.id,
      ) as Artifact[];
  }
  deleteArtifact(key: string) {
    const a = this.artifact(key);
    if (a)
      this.db
        .prepare("UPDATE artifacts SET payload=? WHERE id=?")
        .run(JSON.stringify({ ...a, deleted: true }), key);
  }
  note(scope: string, domain: string) {
    const r = this.db
      .prepare(
        "SELECT version,body FROM notes WHERE scope=? AND domain=? ORDER BY version DESC LIMIT 1",
      )
      .get(scope, domain) as any;
    return r || { version: 0, body: "" };
  }
  saveNote(scope: string, domain: string, body: string, version: number) {
    return this.db.transaction(() => {
      const prev = this.note(scope, domain);
      if (prev.version !== version)
        throw new Fault(
          "VERSION_CONFLICT",
          "经验已被其他操作更新，请先读取新版本",
          409,
        );
      this.db
        .prepare("INSERT INTO notes VALUES(?,?,?,?)")
        .run(scope, domain, version + 1, body);
      this.put("note-metadata", `${scope}:${domain}:${version + 1}`, {
        savedAt: Date.now(),
        validation: "unverified_reference",
        source: "local",
      });
      return { version: version + 1, body };
    })();
  }
  noteHistory(scope: string, domain: string) {
    return (
      this.db
        .prepare(
          "SELECT version,body FROM notes WHERE scope=? AND domain=? ORDER BY version DESC",
        )
        .all(scope, domain) as any[]
    ).map((row) => ({
      ...row,
      ...this.get("note-metadata", `${scope}:${domain}:${row.version}`),
    }));
  }
  close() {
    this.db.close();
  }
}
