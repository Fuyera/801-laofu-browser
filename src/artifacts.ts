import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { Readable } from "node:stream";
import { Store } from "./store.js";
import { Fault } from "./errors.js";
import { filename, id, mkdir } from "./util.js";
import type { Artifact, Product } from "./types.js";
export class Artifacts {
  readonly directory: string;
  constructor(
    readonly store: Store,
    readonly quota = 10 * 1024 ** 3,
  ) {
    this.directory = mkdir(path.join(store.home, "artifacts"));
  }
  path(key: string) {
    if (!/^art_[a-f0-9]{32}$/.test(key))
      throw new Fault("FORBIDDEN", "无权访问此资源", 403);
    return path.join(this.directory, key);
  }
  private reserved = 0;
  private inflight = new Set<string>();
  private diskBytes() {
    return fs
      .readdirSync(this.directory)
      .filter((n) => !this.inflight.has(n))
      .reduce((n, f) => {
        const s = fs.lstatSync(path.join(this.directory, f));
        return n + (s.isFile() ? s.size : 0);
      }, 0);
  }
  async write(
    productId: string,
    name: string,
    mime: string,
    source: AsyncIterable<any>,
    opts: {
      jobId?: string;
      maxBytes?: number;
      metadata?: any;
      expectedHash?: string;
    } = {},
  ) {
    filename(name);
    const artifactId = id("art"),
      target = this.path(artifactId),
      temp = target + ".partial";
    this.inflight.add(path.basename(temp));
    const output = await fs.promises.open(temp, "wx", 0o600).catch((e) => {
        this.inflight.delete(path.basename(temp));
        throw e;
      }),
      digest = crypto.createHash("sha256");
    let bytes = 0,
      held = 0;
    try {
      for await (const raw of source) {
        const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
        if (bytes + chunk.length > (opts.maxBytes || 512 * 1024 ** 2))
          throw new Fault("LIMIT_EXCEEDED", "文件超过本次大小预算", 413);
        // Reserve synchronously before awaiting I/O. A single service process owns this store.
        if (this.diskBytes() + this.reserved + chunk.length > this.quota)
          throw new Fault(
            "QUOTA_EXCEEDED",
            "产物配额已满，请先清理或调整配额",
            507,
          );
        this.reserved += chunk.length;
        held += chunk.length;
        bytes += chunk.length;
        digest.update(chunk);
        await output.writeFile(chunk);
      }
      await output.sync();
      await output.close();
      const sha256 = digest.digest("hex");
      if (opts.expectedHash && opts.expectedHash !== sha256)
        throw new Fault("ARTIFACT_INCOMPLETE", "文件校验失败", 422);
      fs.renameSync(temp, target);
      this.reserved -= held;
      held = 0;
      const a: Artifact = {
        id: artifactId,
        productId,
        jobId: opts.jobId || null,
        filename: name,
        mime: /^[\w.+-]+\/[\w.+-]+$/.test(mime)
          ? mime
          : "application/octet-stream",
        bytes,
        sha256,
        createdAt: Date.now(),
        deleted: false,
        metadata: opts.metadata || {},
      };
      try {
        return this.store.saveArtifact(a);
      } catch (e) {
        fs.unlinkSync(target);
        throw e;
      }
    } catch (e) {
      await output.close().catch(() => {});
      fs.rmSync(temp, { force: true });
      throw e;
    } finally {
      this.inflight.delete(path.basename(temp));
      this.reserved -= held;
    }
  }
  owned(p: Product, key: string) {
    const a = this.store.artifact(key);
    if (!a || a.deleted || (p.role !== "owner" && a.productId !== p.id))
      throw new Fault("FORBIDDEN", "无权访问此资源", 403);
    return a;
  }
  remove(p: Product, key: string) {
    const a = this.owned(p, key);
    this.store.deleteArtifact(key);
    fs.rmSync(this.path(key), { force: true });
    return { id: a.id, deleted: true };
  }
}
