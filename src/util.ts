import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Fault } from "./errors.js";
export const id = (prefix: string) =>
  `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
export const secret = () => crypto.randomBytes(32).toString("base64url");
export const hash = (data: string | Buffer) =>
  crypto.createHash("sha256").update(data).digest("hex");
export function canonical(v: any): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  return (
    "{" +
    Object.keys(v)
      .sort()
      .map((k) => JSON.stringify(k) + ":" + canonical(v[k]))
      .join(",") +
    "}"
  );
}
export function mkdir(dir: string) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}
export function privateFile(file: string, data: string | Buffer) {
  mkdir(path.dirname(file));
  const tmp = file + "." + secret() + ".tmp";
  fs.writeFileSync(tmp, data, { mode: 0o600, flag: "wx" });
  fs.renameSync(tmp, file);
}
export function filename(name: string) {
  if (
    !name ||
    name.length > 180 ||
    name !== path.basename(name) ||
    /[\\/\x00-\x1f]/.test(name) ||
    name === "." ||
    name === ".."
  )
    throw new Fault("INVALID_ARGUMENT", "文件名必须是不含目录的名称");
  return name;
}
export function bounded(
  n: unknown,
  fallback: number,
  min: number,
  max: number,
) {
  const v = n === undefined ? fallback : Number(n);
  if (!Number.isSafeInteger(v) || v < min || v > max)
    throw new Fault("INVALID_ARGUMENT", `数值必须在 ${min} 到 ${max} 之间`);
  return v;
}
export function safeUrl(input: string) {
  let u: URL;
  try {
    u = new URL(input);
  } catch {
    throw new Fault("INVALID_ARGUMENT", "地址格式无效");
  }
  if (!["http:", "https:"].includes(u.protocol) || u.username || u.password)
    throw new Fault("INVALID_ARGUMENT", "仅接受不包含凭据的 HTTP(S) 地址");
  return u;
}
export function redactUrl(input: string) {
  try {
    const u = new URL(input);
    for (const k of [...u.searchParams.keys()])
      if (
        /token|secret|password|passwd|pass_ticket|auth|cookie|credential|session|api.?key|access.?key|^(key|uin|sig|signature)$/i.test(
          k,
        )
      )
        u.searchParams.set(k, "[redacted]");
    u.username = "";
    u.password = "";
    return u.href;
  } catch {
    return "[invalid URL]";
  }
}
export function sanitizeLog(v: any): any {
  if (typeof v === "string")
    return v
      .replace(/https?:\/\/[^\s<>"\x27]+/g, redactUrl)
      .replace(/\b(?:lbk|lbw)_[A-Za-z0-9_-]+/g, "[credential]")
      .slice(0, 2000);
  if (Array.isArray(v)) return v.map(sanitizeLog);
  if (v && typeof v === "object")
    return Object.fromEntries(
      Object.entries(v)
        .filter(
          ([k]) =>
            !/(token|secret|password|cookie|authorization|body|expr|text|data|params)/i.test(
              k,
            ),
        )
        .map(([k, x]) => [k, sanitizeLog(x)]),
    );
  return v;
}
