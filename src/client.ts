import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import crypto from "node:crypto";
import { Fault } from "./errors.js";
import type {
  CaptureRequest,
  FlowRequest,
  CommandRequest,
  JobView,
} from "./types.js";
export type {
  CaptureRequest,
  FlowRequest,
  CommandRequest,
  JobView,
  Artifact,
  State,
  Effect,
} from "./types.js";
import { hash } from "./util.js";
export class BrowserClient {
  constructor(
    public baseUrl: string,
    public token: string,
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }
  async request(
    method: string,
    route: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ) {
    const response = await fetch(this.baseUrl + route, {
      method,
      headers: {
        authorization: `Bearer ${this.token}`,
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...headers,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const data = (await response.json()) as any;
    if (!response.ok)
      throw new Fault(
        data.error?.code || "HTTP_ERROR",
        data.error?.message || "服务请求失败",
        response.status,
      );
    return data;
  }
  capabilities() {
    return this.request("GET", "/v1/capabilities");
  }
  session(profileId: string) {
    return this.request("POST", "/v1/sessions", { profileId });
  }
  submitTask(
    input: CaptureRequest | FlowRequest,
    key: string,
  ): Promise<JobView> {
    return this.request("POST", "/v1/tasks", input, { "idempotency-key": key });
  }
  command(
    sessionId: string,
    input: CommandRequest,
    key: string,
  ): Promise<JobView> {
    return this.request("POST", `/v1/sessions/${sessionId}/commands`, input, {
      "idempotency-key": key,
    });
  }
  job(id: string): Promise<JobView> {
    return this.request(
      "GET",
      `/v1/${id.startsWith("tsk_") ? "tasks" : "commands"}/${id}`,
    );
  }
  cancel(id: string) {
    return this.request(
      "POST",
      `/v1/${id.startsWith("tsk_") ? "tasks" : "commands"}/${id}/cancel`,
      {},
    );
  }
  resume(id: string) {
    return this.request("POST", `/v1/tasks/${id}/resume`, {});
  }
  async wait(id: string, { timeoutMs = 900000, intervalMs = 500 } = {}) {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      const job = await this.job(id);
      if (
        [
          "succeeded",
          "partial",
          "failed",
          "cancelled",
          "waiting_user",
          "suspended",
        ].includes(job.state)
      )
        return job;
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    throw new Fault(
      "CLIENT_WAIT_TIMEOUT",
      "等待结束；任务仍可通过原 ID 查询",
      408,
    );
  }

  async upload(file: string) {
    const digest = crypto.createHash("sha256");
    for await (const chunk of fs.createReadStream(file)) digest.update(chunk);
    const response = await fetch(this.baseUrl + "/v1/artifacts", {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.token}`,
        "content-type": "application/octet-stream",
        "x-filename": encodeURIComponent(path.basename(file)),
        "x-sha256": digest.digest("hex"),
      },
      body: Readable.toWeb(fs.createReadStream(file)) as any,
      duplex: "half",
    } as any);
    const data = (await response.json()) as any;
    if (!response.ok)
      throw new Fault(
        data.error?.code || "UPLOAD_FAILED",
        data.error?.message || "上传失败",
        response.status,
      );
    return data;
  }
  async download(artifactId: string, destination: string) {
    const meta = await this.request("GET", `/v1/artifacts/${artifactId}`);
    const response = await fetch(
      this.baseUrl + `/v1/artifacts/${artifactId}/content`,
      { headers: { authorization: `Bearer ${this.token}` } },
    );
    if (!response.ok || !response.body)
      throw new Fault("DOWNLOAD_FAILED", "下载失败", response.status);
    fs.mkdirSync(path.dirname(path.resolve(destination)), { recursive: true });
    const tmp = destination + "." + crypto.randomUUID() + ".partial";
    const output = await fs.promises.open(tmp, "wx", 0o600);
    const digest = crypto.createHash("sha256");
    let bytes = 0;
    try {
      for await (const chunk of response.body as any) {
        bytes += chunk.length;
        if (bytes > meta.bytes)
          throw new Fault("ARTIFACT_INCOMPLETE", "下载长度超过声明");
        digest.update(chunk);
        await output.writeFile(chunk);
      }
      await output.sync();
      await output.close();
      if (digest.digest("hex") !== meta.sha256 || bytes !== meta.bytes)
        throw new Fault("ARTIFACT_INCOMPLETE", "下载内容校验失败");
      fs.renameSync(tmp, destination);
      return meta;
    } catch (e) {
      await output.close().catch(() => {});
      fs.rmSync(tmp, { force: true });
      throw e;
    }
  }
}
