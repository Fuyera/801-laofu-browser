import React, { createContext, useContext, useEffect, useState } from "react";
import { english } from "./messages";

export type Locale = "zh-CN" | "en";
const storageKey = "laofu-browser.locale";
export function initialLocale(): Locale {
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved === "zh-CN" || saved === "en") return saved;
  } catch {
    /* Storage may be disabled; switching still works for this visit. */
  }
  const preferred = navigator.languages?.[0] || navigator.language || "zh-CN";
  return /^zh(?:-|$)/i.test(preferred) ? "zh-CN" : "en";
}
export function translate(locale: Locale, key: string, values: unknown[] = []) {
  const text =
    locale === "en" ? ((english as Record<string, string>)[key] ?? key) : key;
  return text.replace(/\{(\d+)\}/g, (_, index) =>
    String(values[Number(index)] ?? ""),
  );
}
const LanguageContext = createContext<{
  locale: Locale;
  setLocale: (value: Locale) => void;
} | null>(null);
export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocale] = useState<Locale>(initialLocale);
  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = `laofu-browser · ${translate(locale, "浏览器能力控制台")}`;
    try {
      localStorage.setItem(storageKey, locale);
    } catch {
      /* Optional persistence. */
    }
  }, [locale]);
  return (
    <LanguageContext.Provider value={{ locale, setLocale }}>
      {children}
    </LanguageContext.Provider>
  );
}
export function useLanguage() {
  const value = useContext(LanguageContext);
  if (!value) throw new Error("LanguageProvider is required");
  return {
    ...value,
    t: (key: string, values?: unknown[]) =>
      translate(value.locale, key, values),
  };
}
export function LanguageSwitch() {
  const { locale, setLocale } = useLanguage();
  return (
    <div className="language-switch" role="group" aria-label="Language / 语言">
      <button
        type="button"
        lang="zh-CN"
        aria-pressed={locale === "zh-CN"}
        onClick={() => setLocale("zh-CN")}
      >
        简体中文
      </button>
      <button
        type="button"
        lang="en"
        aria-pressed={locale === "en"}
        onClick={() => setLocale("en")}
      >
        English
      </button>
    </div>
  );
}

// Stable codes supply actionable summaries. Original diagnostic text remains available.
const errors: Record<string, [string, string]> = {
  UNAUTHORIZED: [
    "登录票据或凭据无效、已过期或已吊销。请重新登录。",
    "The login ticket or credential is invalid, expired, or revoked. Sign in again.",
  ],
  FORBIDDEN: [
    "当前身份无权执行此操作。",
    "Your identity is not authorized for this action.",
  ],
  INVALID_ARGUMENT: [
    "请求参数无效，请检查输入。",
    "The request is invalid. Check the input.",
  ],
  IDEMPOTENCY_CONFLICT: [
    "此请求标识已用于其他内容。请先核对原任务。",
    "This request key was used for different content. Check the original task first.",
  ],
  PROFILE_BUSY: [
    "浏览器正由其他任务或用户控制。",
    "Another task or person controls this browser.",
  ],
  AUTH_REQUIRED: [
    "页面需要人工登录，请在原浏览器完成。",
    "Sign in manually in the original browser.",
  ],
  AUTH_REVOKED: ["访问授权已吊销。", "Access authorization was revoked."],
  ACCOUNT_NOT_VERIFIED: [
    "尚未核验目标账号。",
    "The target account has not been verified.",
  ],
  ACCOUNT_VERIFICATION_REQUIRED: [
    "请先核验浏览器中的目标账号。",
    "Verify the target account in the browser first.",
  ],
  ACCOUNT_SCOPE_DENIED: [
    "目标账号不在授权范围内。",
    "The target account is outside the authorized scope.",
  ],
  ARTICLE_NOT_READY: [
    "页面正文仍未就绪。请检查原页面。",
    "The article body is not ready. Check the original page.",
  ],
  ACCESS_BLOCKED: [
    "页面访问受阻，请检查站点提示。",
    "Access is blocked. Check the website's instructions.",
  ],
  EMPTY_ARTICLE: ["未取得可用正文。", "No usable article body was found."],
  EFFECT_UNKNOWN: [
    "执行效果尚未确认。请核对原任务，勿重复提交。",
    "The action's outcome is unknown. Check the original task; do not resubmit.",
  ],
  DISPATCH_UNKNOWN: [
    "指令发送结果未知。请核对原任务，勿重复提交。",
    "Dispatch outcome is unknown. Check the original task; do not resubmit.",
  ],
  RESUME_UNKNOWN: [
    "恢复结果未知。任务已挂起，请先核验。",
    "Resume outcome is unknown. The task is suspended for verification.",
  ],
  RESUME_NOT_ALLOWED: [
    "当前任务不满足继续执行条件。",
    "The task cannot resume in its current state.",
  ],
  RESULT_EXPIRED: [
    "回执已过期，请查询原任务，勿重放。",
    "The receipt has expired. Query the original task; do not replay it.",
  ],
  LIMIT_EXCEEDED: [
    "请求或输出超过限制。",
    "The request or output exceeds its limit.",
  ],
  QUOTA_EXCEEDED: [
    "存储或任务额度不足。",
    "The storage or task quota has been reached.",
  ],
  PRODUCT_QUOTA_EXCEEDED: [
    "此产品的使用额度不足。",
    "This product's usage quota has been reached.",
  ],
  RATE_LIMITED: [
    "站点限制访问频率，自动尝试已停止。",
    "The site is rate-limiting access. Automatic attempts have stopped.",
  ],
  SITE_COOLDOWN: [
    "站点仍在冷却，请等待或核验恢复条件。",
    "The site is cooling down. Wait or verify recovery conditions.",
  ],
  TIMEOUT: [
    "执行预算已到期，请查询原任务的停止状态与效果。",
    "The execution budget expired. Check the original task's stop state and outcome.",
  ],
  QUEUE_TIMEOUT: ["任务排队超时。", "The task exceeded its queue time limit."],
  ARTIFACT_INCOMPLETE: [
    "文件未通过完整性校验。",
    "The file failed its integrity check.",
  ],
  ARTIFACT_DELETED: ["此文件已删除。", "This file has been deleted."],
  PREVIEW_UNAVAILABLE: [
    "此文件没有可用的安全预览。",
    "A safe preview is not available for this file.",
  ],
  CAPABILITY_UNAVAILABLE: [
    "当前环境或权限不支持此能力。",
    "This capability is unavailable with the current environment or permissions.",
  ],
  HANDOFF_NOT_AVAILABLE: [
    "此任务没有可用的远程接手入口。",
    "Remote takeover is not available for this task.",
  ],
  WORKER_OFFLINE: [
    "执行端离线，请检查浏览器连接。",
    "The worker is offline. Check the browser connection.",
  ],
  WORKER_DISCONNECTED: [
    "执行端已断开，请核验原任务后再继续。",
    "The worker disconnected. Verify the original task before continuing.",
  ],
  ISOLATION_NOT_VERIFIED: [
    "执行隔离尚未通过核验。",
    "Execution isolation has not been verified.",
  ],
  EXECUTION_MISMATCH: [
    "执行环境与请求不匹配。",
    "The execution environment does not match the request.",
  ],
  CONTROL_REVOKED: [
    "自动执行控制权已撤销。",
    "Automation control has been revoked.",
  ],
  CONFIRMATION_REQUIRED: [
    "此操作需要核验或人工确认。",
    "This action requires verification or human confirmation.",
  ],
  NETWORK_ERROR: [
    "网络连接失败，请检查本机诊断。",
    "The network connection failed. Check local diagnostics.",
  ],
  INTERNAL: [
    "请求失败，请检查本机诊断。",
    "The request failed. Check local diagnostics.",
  ],
};
export function ErrorMessage({ error }: { error: unknown }) {
  const { locale, t } = useLanguage();
  const value = error as { code?: string; message?: string };
  const message =
    typeof error === "string" ? error : value?.message || "服务请求失败";
  const known = value?.code && errors[value.code];
  const translated = t(message);
  const summary = known
    ? known[locale === "en" ? 1 : 0]
    : locale === "en" && /[\u4e00-\u9fff]/.test(translated)
      ? "The request failed. See the original details below and check local diagnostics."
      : translated;
  return (
    <>
      <span>
        {summary} {value?.code && <code>{value.code}</code>}
      </span>
      {summary !== message && translated === message && (
        <details>
          <summary>
            {locale === "en" ? "Original diagnostic message" : "原始诊断信息"}
          </summary>
          <pre>{message}</pre>
        </details>
      )}
    </>
  );
}
