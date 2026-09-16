import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import sharp from "sharp";
import { Store } from "./store.js";
import { Fault } from "./errors.js";
import { filename, id, mkdir } from "./util.js";
import type { Artifact, Product } from "./types.js";
import { TERMINAL } from "./types.js";
import { PRODUCT_LIMITS } from "./types.js";
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
  private productReserved = new Map<string, number>();
  private downloads = new Map<
    string,
    Set<{ stream: fs.ReadStream; productId: string }>
  >();
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
      authorize?: () => void;
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
        opts.authorize?.();
        const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
        const product = this.store.get<Product>("product", productId);
        if (!product || product.revoked)
          throw new Fault("UNAUTHORIZED", "调用身份已撤销", 401);
        if (bytes + chunk.length > (opts.maxBytes || 512 * 1024 ** 2))
          throw new Fault("LIMIT_EXCEEDED", "文件超过本次大小预算", 413);
        // Reserve synchronously before awaiting I/O. A single service process owns this store.
        if (this.diskBytes() + this.reserved + chunk.length > this.quota)
          throw new Fault(
            "QUOTA_EXCEEDED",
            "产物配额已满，请先清理或调整配额",
            507,
          );
        const used = this.store
          .artifacts()
          .filter((a) => a.productId === productId && !a.deleted)
          .reduce((sum, a) => sum + a.bytes, 0);
        if (
          used + (this.productReserved.get(productId) || 0) + chunk.length >
          (product.limits?.artifactBytes ?? PRODUCT_LIMITS.artifactBytes)
        )
          throw new Fault(
            "PRODUCT_QUOTA_EXCEEDED",
            "产品产物额度已满，请清理产物或调整额度",
            507,
          );
        this.reserved += chunk.length;
        this.productReserved.set(
          productId,
          (this.productReserved.get(productId) || 0) + chunk.length,
        );
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
      const detectedMime = await this.detectMime(
        temp,
        mime,
        opts.metadata?.source === "worker",
      );
      opts.authorize?.();
      if (this.store.get<Product>("product", productId)?.revoked)
        throw new Fault("UNAUTHORIZED", "调用身份已撤销", 401);
      fs.renameSync(temp, target);
      this.reserved -= held;
      this.productReserved.set(
        productId,
        (this.productReserved.get(productId) || 0) - held,
      );
      held = 0;
      const a: Artifact = {
        id: artifactId,
        productId,
        jobId: opts.jobId || null,
        filename: name,
        mime: detectedMime,
        bytes,
        sha256,
        createdAt: Date.now(),
        deleted: false,
        metadata: { ...opts.metadata, declaredMime: mime },
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
      this.productReserved.set(
        productId,
        (this.productReserved.get(productId) || 0) - held,
      );
    }
  }
  private async detectMime(file: string, declared: string, generated: boolean) {
    const input = await fs.promises.open(file, "r");
    const head = Buffer.alloc(512);
    const { bytesRead } = await input.read(head, 0, head.length, 0);
    await input.close();
    const bytes = head.subarray(0, bytesRead);
    const format = await sharp(file, { limitInputPixels: 40_000_000 })
      .metadata()
      .then((m) => m.format)
      .catch(() => undefined);
    const imageTypes: Record<string, string> = {
      png: "image/png",
      jpeg: "image/jpeg",
      webp: "image/webp",
      gif: "image/gif",
      avif: "image/avif",
      tiff: "image/tiff",
    };
    if (format && imageTypes[format]) return imageTypes[format];
    if (bytes.subarray(0, 5).toString() === "%PDF-") return "application/pdf";
    if (bytes.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 3, 4])))
      return "application/zip";
    // Only the trusted worker can label service-generated textual artifacts. Preview also verifies job provenance.
    if (
      generated &&
      ["text/html", "text/markdown", "text/plain", "application/json"].includes(
        declared,
      ) &&
      !bytes.includes(0)
    )
      return declared;
    return "application/octet-stream";
  }
  owned(p: Product, key: string) {
    const a = this.store.artifact(key);
    if (!a || a.deleted || (p.role !== "owner" && a.productId !== p.id))
      throw new Fault("FORBIDDEN", "无权访问此资源", 403);
    if (a.metadata?.publication === "staged")
      throw new Fault("ARTIFACT_INCOMPLETE", "图文包尚未原子发布", 409);
    return a;
  }
  sweep(now = Date.now()) {
    for (const a of this.store.artifacts()) {
      const abandoned =
        a.metadata?.publication === "staged" &&
        a.jobId &&
        TERMINAL.has(this.store.job(a.jobId)?.state!);
      if (!a.deleted && abandoned) this.purge(a.id);
    }
    for (const name of fs.readdirSync(this.directory)) {
      if (!/^art_[a-f0-9]{32}\.partial$/.test(name) || this.inflight.has(name))
        continue;
      const file = path.join(this.directory, name),
        stat = fs.lstatSync(file);
      if (stat.isFile() && stat.mtimeMs < now - 86400_000) fs.rmSync(file);
    }
  }
  download(p: Product, key: string) {
    this.owned(p, key);
    const stream = fs.createReadStream(this.path(key));
    const transfer = { stream, productId: p.id };
    const transfers = this.downloads.get(key) || new Set();
    transfers.add(transfer);
    this.downloads.set(key, transfers);
    stream.once("close", () => {
      transfers.delete(transfer);
      if (!transfers.size) this.downloads.delete(key);
    });
    return stream;
  }
  revokeProduct(productId: string) {
    for (const [key, transfers] of this.downloads)
      for (const transfer of transfers)
        if (
          transfer.productId === productId ||
          this.store.artifact(key)?.productId === productId
        )
          transfer.stream.destroy(
            new Fault("FORBIDDEN", "文件访问已撤销", 403),
          );
  }
  remove(p: Product, key: string) {
    const a = this.owned(p, key);
    this.purge(key);
    return { id: a.id, deleted: true };
  }
  private purge(key: string) {
    this.store.deleteArtifact(key);
    for (const transfer of this.downloads.get(key) || [])
      transfer.stream.destroy(
        new Fault("ARTIFACT_DELETED", "产物已删除，下载已停止", 410),
      );
    fs.rmSync(this.path(key), { force: true });
  }
}
