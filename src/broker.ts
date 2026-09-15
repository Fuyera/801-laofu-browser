import type WebSocket from "ws";
import { Store } from "./store.js";
import { Fault, problem } from "./errors.js";
import {
  TERMINAL,
  type Job,
  type Profile,
  type WorkerMessage,
} from "./types.js";
export class Broker {
  readonly workers = new Map<
    string,
    { socket: WebSocket; lastSeen: number; ready: boolean }
  >();
  readonly viewers = new Map<
    string,
    { socket: WebSocket; workerId: string; jobId: string }
  >();
  private timer: NodeJS.Timeout;
  constructor(
    readonly store: Store,
    readonly concurrency = 2,
  ) {
    for (const j of store.jobs())
      if (["running", "waiting_user"].includes(j.state)) {
        store.transition(j.id, "suspended", {
          effectState: "unknown",
          error: {
            code: "SERVICE_RESTARTED",
            message: "服务已重启；先确认旧动作停止",
            retryable: false,
          },
        });
        this.quarantine(j.profileId);
      }
    this.timer = setInterval(() => this.tick(), 250);
    this.timer.unref();
  }
  quarantine(profileId: string) {
    const p = this.store.get<Profile>("profile", profileId);
    if (p)
      this.store.put("profile", p.id, {
        ...p,
        quarantined: true,
        ready: false,
      });
  }
  attach(workerId: string, socket: WebSocket) {
    const old = this.workers.get(workerId);
    if (old) {
      socket.close(4009, "worker already connected");
      return;
    }
    this.workers.set(workerId, { socket, lastSeen: Date.now(), ready: false });
    socket.on("message", (raw) => {
      try {
        this.message(workerId, JSON.parse(raw.toString()));
      } catch {
        socket.close(4002, "invalid worker message");
      }
    });
    socket.on("close", () => {
      if (this.workers.get(workerId)?.socket !== socket) return;
      this.workers.delete(workerId);
      const registration = this.store.get<any>("worker", workerId);
      const disconnected =
        registration &&
        this.store.get<Profile>("profile", registration.profileId);
      if (disconnected)
        this.store.put("profile", disconnected.id, {
          ...disconnected,
          ready: false,
        });
      for (const j of this.store.jobs())
        if (
          j.workerId === workerId &&
          ["running", "waiting_user"].includes(j.state)
        ) {
          this.store.transition(j.id, "suspended", {
            effectState: "unknown",
            error: {
              code: "WORKER_DISCONNECTED",
              message: "执行端失联，原动作结果尚未确认",
              retryable: false,
            },
          });
          this.quarantine(j.profileId);
        }
      for (const [id, v] of this.viewers)
        if (v.workerId === workerId) {
          v.socket.close();
          this.viewers.delete(id);
        }
    });
  }
  send(workerId: string, msg: WorkerMessage) {
    const w = this.workers.get(workerId);
    if (!w || w.socket.readyState !== 1)
      throw new Fault("WORKER_OFFLINE", "执行端未连接", 503);
    w.socket.send(JSON.stringify(msg));
  }
  message(workerId: string, msg: WorkerMessage) {
    const w = this.workers.get(workerId);
    if (!w) return;
    w.lastSeen = Date.now();
    if (msg.type === "heartbeat") return;
    if (msg.type === "ready") {
      const registered = this.store.get<any>("worker", workerId);
      if (msg.profileId !== registered.profileId)
        throw new Error("profile mismatch");
      w.ready = msg.browserReady !== false;
      this.store.put("worker", workerId, {
        ...registered,
        status: "online",
        bootId: msg.bootId || null,
        isolationVerified:
          !!msg.bootId &&
          registered.bootId === msg.bootId &&
          registered.isolationVerified,
        version: msg.version,
        build: msg.build,
        browserVersion: msg.browserVersion,
        environment: msg.environment,
        checkedAt: Date.now(),
      });
      const p = this.store.get<Profile>("profile", msg.profileId);
      if (p)
        this.store.put("profile", p.id, {
          ...p,
          ready: w.ready && !p.quarantined,
        });
      return;
    }
    if (msg.type === "display") {
      const v = this.viewers.get(msg.viewerId);
      if (v && v.workerId === workerId && v.socket.readyState === 1) {
        if (v.socket.bufferedAmount > 4 * 1024 ** 2)
          v.socket.close(1013, "viewer too slow");
        else v.socket.send(Buffer.from(msg.data, "base64"));
      }
      return;
    }
    const job = this.store.job(msg.jobId);
    if (!job || job.workerId !== workerId || job.fence !== msg.fence) return;
    if (msg.type === "progress") {
      if (!TERMINAL.has(job.state))
        this.store.event(job.id, "progress", msg.data);
      return;
    }
    if (msg.type === "waiting_user") {
      if (job.state !== "running") return;
      this.store.transition(job.id, "waiting_user", {
        result: { ...(job.result || {}), handoff: msg.data },
      });
      return;
    }
    if (msg.type === "result") {
      if (
        msg.error?.code === "RATE_LIMITED" &&
        job.type === "article.capture@v1"
      ) {
        this.store.recordCooldown(job, {
          origin: msg.error.details?.origin || new URL(job.input.url).origin,
          retryAfter: msg.error.details?.retryAfter,
        });
      }
      const confirmedStop = msg.stopped === true;
      if (TERMINAL.has(job.state)) {
        this.store.event(job.id, "late_evidence", {
          state: msg.state,
          effectState: msg.effectState,
          result: msg.result,
          error: msg.error,
        });
        if (confirmedStop) this.store.release(job.profileId, job.id);
        return;
      }
      if (job.state === "suspended") {
        this.store.event(job.id, "late_evidence", {
          state: msg.state,
          effectState: msg.effectState,
          result: msg.result,
          error: msg.error,
        });
        if (confirmedStop) this.store.release(job.profileId, job.id);
        return;
      }
      const effect: Job["effectState"] =
        msg.effectState === "confirmed"
          ? "confirmed"
          : msg.effectState === "not_started"
            ? "not_started"
            : "unknown";
      const state = job.cancelRequested
        ? "cancelled"
        : ["succeeded", "partial", "failed", "cancelled"].includes(msg.state)
          ? msg.state
          : "failed";
      this.store.transition(job.id, state, {
        result: msg.result || null,
        error: msg.error || null,
        effectState: effect,
      });
      if (confirmedStop) this.store.release(job.profileId, job.id);
      else this.quarantine(job.profileId);
    }
  }
  tick() {
    const now = Date.now();
    for (const [key, w] of this.workers)
      if (now - w.lastSeen > 45000) {
        w.socket.terminate();
      }
    const jobs = this.store.jobs().reverse();
    let running = jobs.filter((j) => j.state === "running").length;
    for (const j of jobs) {
      if (TERMINAL.has(j.state) || j.state === "suspended") continue;
      if (
        j.expiresAt < now ||
        (j.state === "queued" &&
          now - j.createdAt >
            (j.input.limits?.queueTimeoutSeconds || 60) * 1000)
      ) {
        if (j.state === "queued") {
          this.store.transition(j.id, "failed", {
            error: {
              code: "QUEUE_TIMEOUT",
              message: "任务在预算内未获得执行机会",
              retryable: true,
            },
          });
        } else {
          if (!j.cancelRequested) {
            this.store.updateJob(j.id, { cancelRequested: true });
            try {
              this.send(j.workerId, {
                type: "cancel",
                jobId: j.id,
                fence: j.fence,
              });
            } catch {
              this.quarantine(j.profileId);
            }
          }
        }
        continue;
      }
      if (j.state !== "queued" || running >= this.concurrency) continue;
      try {
        this.store.assertNotCooling(j);
      } catch (e) {
        this.store.transition(j.id, "failed", {
          error: problem(e),
          effectState: "not_started",
        });
        continue;
      }
      if (
        jobs.some(
          (other) =>
            other.id !== j.id &&
            other.productId === j.productId &&
            ["running", "waiting_user"].includes(other.state),
        )
      )
        continue;
      const worker = this.workers.get(j.workerId);
      const profile = this.store.get<Profile>("profile", j.profileId);
      const product = this.store.get<any>("product", j.productId);
      if (
        !product ||
        product.revoked ||
        (product.role !== "owner" &&
          (!profile?.productIds.includes(product.id) ||
            !this.store.get<any>("worker", j.workerId)?.isolationVerified))
      ) {
        this.store.transition(j.id, "cancelled", {
          error: {
            code: "AUTH_REVOKED",
            message: "调用权限已撤销",
            retryable: false,
          },
        });
        continue;
      }
      if (!worker?.ready || !profile?.ready || profile.quarantined) continue;
      try {
        const fence = this.store.acquire(j.profileId, j.id);
        const active = this.store.transition(j.id, "running", {
          fence,
          effectState: "started",
        });
        this.send(j.workerId, {
          type: "execute",
          job: {
            ...active,
            executionPolicy: this.store.get("account-policy", j.profileId) || {
              mode: "anonymous",
              origins: [],
            },
          },
        });
        j.state = "running";
        running++;
      } catch (e) {
        if (!(e instanceof Fault && e.code === "PROFILE_BUSY")) {
          this.store.transition(j.id, "suspended", {
            effectState: "unknown",
            error: {
              code: "DISPATCH_UNKNOWN",
              message: "命令发送状态未知",
              retryable: false,
            },
          });
          this.quarantine(j.profileId);
        }
      }
    }
  }
  cancel(job: Job) {
    if (TERMINAL.has(job.state)) return job;
    this.store.updateJob(job.id, { cancelRequested: true });
    if (job.state === "queued")
      return this.store.transition(job.id, "cancelled", {
        effectState: "not_started",
      });
    try {
      this.send(job.workerId, {
        type: "cancel",
        jobId: job.id,
        fence: job.fence,
      });
    } catch {
      this.quarantine(job.profileId);
    }
    this.store.event(job.id, "cancel_requested", {
      message: "已停止排队新动作，正在确认在途操作",
    });
    this.closeViewers(job.id);
    return this.store.job(job.id)!;
  }
  resume(job: Job) {
    if (job.state !== "waiting_user" || job.cancelRequested)
      throw new Fault(
        "RESUME_NOT_ALLOWED",
        "当前任务不能直接续接；未知结果需先核验",
        409,
      );
    this.store.assertNotCooling(job);
    this.closeViewers(job.id);
    this.store.transition(job.id, "running");
    this.send(job.workerId, {
      type: "resume",
      jobId: job.id,
      fence: job.fence,
    });
    return this.store.job(job.id)!;
  }
  closeViewers(jobId: string) {
    for (const [id, v] of this.viewers)
      if (v.jobId === jobId) {
        v.socket.close();
        this.viewers.delete(id);
        try {
          this.send(v.workerId, { type: "view_close", viewerId: id });
        } catch {}
      }
  }
  close() {
    clearInterval(this.timer);
    for (const j of this.store.jobs())
      if (["running", "waiting_user"].includes(j.state)) {
        this.store.transition(j.id, "suspended", {
          effectState: "unknown",
          error: {
            code: "SERVICE_STOPPED",
            message: "服务停止，旧动作须核验",
            retryable: false,
          },
        });
        this.quarantine(j.profileId);
      }
    for (const w of this.workers.values()) {
      w.socket.removeAllListeners("message");
      w.socket.removeAllListeners("close");
      w.socket.close();
    }
    for (const v of this.viewers.values()) v.socket.close();
  }
}
