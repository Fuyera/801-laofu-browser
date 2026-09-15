import fs from "node:fs";
import path from "node:path";
import * as cheerio from "cheerio";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";
import sanitizeHtml from "sanitize-html";
import sharp from "sharp";
import archiver from "archiver";
import { Fault } from "./errors.js";
import { hash, mkdir, redactUrl, safeUrl } from "./util.js";
import type { AccountPolicy } from "./types.js";
export interface ImageItem {
  index: number;
  source: string;
  alt: string;
  path?: string;
  sha256?: string;
  bytes?: number;
  width?: number;
  height?: number;
  mime?: string;
  error?: string;
}
export interface ArticleMeta {
  url: string;
  title: string;
  author?: string;
  publishedText?: string;
  html: string;
  versionConsistent?: boolean;
}
export function accessState(meta: {
  title?: string;
  text?: string;
  hasArticle?: boolean;
  url?: string;
  httpStatus?: number;
  blockedMarker?: string;
}) {
  const title = meta.title || "",
    text = meta.text || "";
  if (meta.httpStatus === 429) return "rate_limited";
  if ([401, 403].includes(meta.httpStatus || 0)) return "access_denied";
  if ([404, 410].includes(meta.httpStatus || 0)) return "deleted";
  if (
    (meta.httpStatus || 0) >= 500 ||
    meta.url?.startsWith("chrome-error:") ||
    /^(NETWORK_DENIED|ERR_[A-Z_]+)$/.test(text.trim()) ||
    (/无法访问此网站|This site can.t be reached/.test(title) &&
      /ERR_[A-Z_]+/.test(text))
  )
    return "network_error";
  if (meta.blockedMarker === "paywall") return "paywall";
  if (
    meta.hasArticle &&
    text.trim().length > 100 &&
    !/^(环境异常|操作过于频繁|访问过于频繁)$/.test(title.trim())
  )
    return "accessible";
  const short = title + " " + text.slice(0, 1400);
  if (
    /操作[过于频繁太快]+|访问过于频繁|频率限制|too many requests/i.test(short)
  )
    return "rate_limited";
  if (
    /环境异常|完成验证|验证码|verify you are human|captcha|人机验证/i.test(
      short,
    )
  )
    return "verification_required";
  if (
    /该内容已被发布者删除|此内容因违规无法查看|页面已删除|内容已被删除/i.test(
      short,
    )
  )
    return "deleted";
  if (/付费后阅读|购买后阅读|订阅后阅读/i.test(short)) return "paywall";
  if (/请先登录|登录后查看|sign in to continue/i.test(short))
    return "login_required";
  return "accessible";
}
export function prepareArticle(meta: ArticleMeta) {
  const $ = cheerio.load(meta.html);
  $(
    'script,style,noscript,template,button,input,textarea,select,[hidden],[aria-hidden="true"],[style*="display:none"],[style*="display: none"],.code-snippet__line-index',
  ).remove();
  const images: ImageItem[] = [];
  $("img").each((i, el) => {
    const image = $(el);
    let src =
      image.attr("data-src") ||
      image.attr("data-original") ||
      image.attr("src") ||
      "";
    if (!src && image.attr("srcset"))
      src = image.attr("srcset")!.split(",").at(-1)!.trim().split(/\s+/)[0];
    try {
      if (!src) throw new Error("empty image source");
      if (!src.startsWith("data:image/")) {
        src = new URL(src, meta.url).href;
        safeUrl(src);
      }
    } catch {
      src = "";
    }
    images.push({
      index: i + 1,
      source: src,
      alt: image.attr("alt") || "",
      ...(src ? {} : { error: "UNSUPPORTED_IMAGE_SOURCE" }),
    });
    image.attr("data-lb-image", String(i + 1));
    image.removeAttr("srcset");
  });
  const media = $("video,audio,iframe,mpvideo,mpvoice,qqmusic").length;
  const text = $("body").text().trim();
  return { $, images, media, text };
}
export function renderArticle(
  meta: ArticleMeta,
  prepared: ReturnType<typeof prepareArticle>,
) {
  const { $, images } = prepared;
  for (const image of images) {
    const el = $(`img[data-lb-image="${image.index}"]`);
    if (image.path) {
      el.attr("src", image.path);
    } else {
      el.replaceWith(
        $("<p>").text(
          `[图片 ${image.index} 未取得${image.error ? ": " + image.error : ""}]`,
        ),
      );
    }
  }
  $("a").each((_, el) => {
    const a = $(el);
    try {
      const u = new URL(a.attr("href") || "", meta.url);
      safeUrl(u.href);
      a.attr("href", redactUrl(u.href));
    } catch {
      a.removeAttr("href");
    }
  });
  const clean = sanitizeHtml($("body").html() || "", {
    allowedTags: [
      "p",
      "div",
      "section",
      "article",
      "span",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "blockquote",
      "ul",
      "ol",
      "li",
      "pre",
      "code",
      "strong",
      "b",
      "em",
      "i",
      "del",
      "s",
      "br",
      "hr",
      "a",
      "img",
      "table",
      "thead",
      "tbody",
      "tr",
      "th",
      "td",
      "figure",
      "figcaption",
    ],
    allowedAttributes: {
      a: ["href", "title"],
      img: ["src", "alt"],
      ol: ["start"],
      th: ["colspan", "rowspan"],
      td: ["colspan", "rowspan"],
    },
    allowedSchemes: ["http", "https"],
    allowProtocolRelative: false,
    transformTags: {
      img: (_tag, attrs) => ({
        tagName: "img",
        attribs: {
          ...attrs,
          src: /^images\/image-\d+\.(png|jpeg|webp|gif|avif|tiff)$/.test(
            attrs.src || "",
          )
            ? attrs.src
            : "",
        },
      }),
    },
  });
  const td = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
  });
  td.use(gfm);
  const body = td.turndown(clean);
  const title = String(meta.title || "未命名文章")
    .replace(/[\r\n]+/g, " ")
    .trim();
  const markdown = `# ${title.replace(/([\\`*_{}\[\]<>])/g, "\\$1")}\n\n${meta.author ? `作者：${meta.author.replace(/[\r\n]+/g, " ").replace(/([\\`*_{}\[\]<>])/g, "\\$1")}\n\n` : ""}来源：${redactUrl(meta.url)}\n\n${body}\n`;
  const escape = (s: string) =>
    s.replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c]!,
    );
  const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${escape(title)}</title><style>body{max-width:760px;margin:40px auto;padding:0 20px;font:18px/1.9 system-ui;color:#232628}img{max-width:100%;height:auto}pre{overflow:auto;padding:16px;background:#f1f3f4}table{border-collapse:collapse}td,th{border:1px solid #ccd;padding:8px}a{color:#246958}</style><h1>${escape(title)}</h1><p>${escape(meta.author || "")}</p><main>${clean}</main></html>`;
  return { markdown, html, body };
}
const ROOT_EXPRESSION = `document.querySelector('#js_content')||document.querySelector('article')||document.querySelector('main')||document.body`;
export async function captureArticle(
  input: any,
  directory: string,
  run: (name: string, args: any, raw?: boolean) => Promise<any>,
  waitForUser: (info: any) => Promise<void>,
  accountPolicy: AccountPolicy = { mode: "anonymous", origins: [] },
) {
  mkdir(directory);
  mkdir(path.join(directory, "images"));
  const source = safeUrl(input.url).href;
  const checkOrigin = (url: string) => {
    if (
      accountPolicy.origins.length &&
      !accountPolicy.origins.includes(new URL(url).origin)
    )
      throw new Fault(
        "ACCOUNT_SCOPE_DENIED",
        "页面站点不在该浏览器的账号授权范围",
        403,
      );
  };
  checkOrigin(source);
  const tabs = await run("tabs", { action: "list" }, true);
  const tabCount = Number(/^共 (\d+) 个标签页/.exec(tabs.text || "")?.[1]);
  if (!Number.isFinite(tabCount))
    throw new Fault("TAB_BUDGET_UNKNOWN", "无法确认标签页数量，未新建页面");
  if (tabCount >= (input.limits?.maxTabs || 8))
    throw new Fault(
      "TAB_LIMIT",
      "浏览器标签页已达到预算，请处理保留页面或调整预算",
      429,
    );
  const opened = await run("tabs", { action: "new", label: "图文采集" }, true);
  const tabId = opened.tabId;
  if (!tabId) throw new Fault("NO_TAB", "无法建立采集标签页");
  await run("navigate", { url: source, tabId }, true);
  const evaluate = async (expr: string) => {
    const r = await run("eval", { expr, tabId, maxLength: 16000 }, true);
    if (r.text?.includes("…（已截断）"))
      throw new Fault("TRUNCATED", "采集片段被上游截断");
    try {
      return JSON.parse(r.text);
    } catch {
      throw new Fault("INVALID_BROWSER_RESULT", "正文提取结果不可解析");
    }
  };
  const describe = () =>
    evaluate(
      `(()=>{const r=${ROOT_EXPRESSION};return {url:location.href,title:document.querySelector('#activity-name')?.textContent?.trim()||document.title,author:document.querySelector('#js_name')?.textContent?.trim()||document.querySelector('[rel=author]')?.textContent?.trim()||'',publishedText:document.querySelector('#publish_time')?.textContent?.trim()||'',httpStatus:performance.getEntriesByType('navigation')[0]?.responseStatus||0,blockedMarker:document.querySelector('[data-paywall=true],.paywall-overlay,.paywall-gate')?'paywall':'',text:(r?.textContent||'').slice(0,1600),hasArticle:!!document.querySelector('#js_content,article'),hasNextPage:!!document.querySelector('a[rel=next]'),length:r?.innerHTML.length||0};})()`,
    );
  let meta = await describe();
  checkOrigin(meta.url);
  let access = accessState(meta);
  if (access === "rate_limited")
    throw new Fault(
      "RATE_LIMITED",
      "页面提示操作频繁；已停止，本次不自动重试",
      429,
      false,
      { origin: new URL(meta.url).origin },
    );
  if (access === "network_error")
    throw new Fault("NETWORK_ERROR", "页面网络连接失败，未作为正文保存", 502);
  if (["deleted", "paywall", "access_denied"].includes(access))
    throw new Fault("ACCESS_BLOCKED", "原文不可访问或需要额外阅读权限", 403);
  if (access !== "accessible") {
    await run("tabs", { action: "select", tabId, focus: true }, true);
    await waitForUser({
      reason: access,
      title: meta.title,
      url: redactUrl(meta.url),
      tabId,
      requiredAction: "请在浏览器完成验证或登录；完成后再继续",
    });
    meta = await describe();
    checkOrigin(meta.url);
    access = accessState(meta);
    if (access !== "accessible")
      throw new Fault(
        access === "rate_limited" ? "RATE_LIMITED" : "ACCESS_BLOCKED",
        "人工接手后仍未取得可访问正文",
        409,
        false,
        { origin: new URL(meta.url).origin },
      );
  }
  let account = { status: "anonymous" as string, method: "not_required" };
  let verifyAccount: undefined | (() => Promise<string>);
  if (accountPolicy.mode === "required") {
    const verify = async () => {
      if (!accountPolicy.selector || !accountPolicy.expectedHash)
        return "unknown";
      const value = await evaluate(
        `(()=>{const el=document.querySelector(${JSON.stringify(accountPolicy.selector)});return el?${accountPolicy.attribute ? `el.getAttribute(${JSON.stringify(accountPolicy.attribute)})` : "el.textContent"}:null})()`,
      );
      if (typeof value !== "string" || !value.trim()) return "unknown";
      return hash(value.trim()) === accountPolicy.expectedHash
        ? "matched"
        : "mismatched";
    };
    verifyAccount = verify;
    let status = await verify();
    if (status !== "matched") {
      await run("tabs", { action: "select", tabId, focus: true }, true);
      await waitForUser({
        reason: "account_" + status,
        tabId,
        url: redactUrl(meta.url),
        requiredAction:
          "账号未核验或不匹配，请使用已授权账号后继续；修改核验规则会停止旧任务，需新建任务",
      });
      meta = await describe();
      checkOrigin(meta.url);
      status = await verify();
      if (status !== "matched")
        throw new Fault(
          "ACCOUNT_NOT_VERIFIED",
          "仍未核验到所要求账号，正文未交付",
          403,
          false,
          { accountStatus: status },
        );
    }
    account = { status, method: "configured_DOM_fingerprint" };
  }
  // Prepare only this newly created capture page. No clicks, pagination or account transitions.
  const loading = await evaluate(
    `(async()=>{const started=Date.now();let previous='',stable=0,scrolls=0;while(Date.now()-started<3000){const r=${ROOT_EXPRESSION};if(r&&scrolls<4&&scrollY+innerHeight<Math.min(document.documentElement.scrollHeight,12000)){scrollBy(0,innerHeight);scrolls++;}await new Promise(resolve=>setTimeout(resolve,250));const current=r?.innerHTML||'';stable=current===previous?stable+1:0;previous=current;if(document.readyState==='complete'&&stable>=3&&Date.now()-started>=750)return {stable:true,elapsedMs:Date.now()-started,scrolls};}return {stable:false,elapsedMs:Date.now()-started,scrolls};})()`,
  );
  meta = await describe();
  checkOrigin(meta.url);
  const preparedAccess = accessState(meta);
  if (preparedAccess !== "accessible")
    throw new Fault(
      preparedAccess === "rate_limited" ? "RATE_LIMITED" : "ACCESS_BLOCKED",
      "页面在加载期间变为不可访问，未交付正文",
      preparedAccess === "rate_limited" ? 429 : 403,
      false,
      { origin: new URL(meta.url).origin },
    );
  if (verifyAccount && (await verifyAccount()) !== "matched")
    throw new Fault(
      "ACCOUNT_NOT_VERIFIED",
      "加载期间账号核验失效，未交付正文",
      403,
    );
  if (!meta.length) throw new Fault("EMPTY_ARTICLE", "页面没有可用正文");
  if (meta.length > 8 * 1024 ** 2)
    throw new Fault("LIMIT_EXCEEDED", "正文 HTML 超过采集预算");
  // Freeze one DOM revision in page memory; the final DOM fingerprint detects changes during transfer.
  const marker = "__laofu_capture_" + Date.now();
  const frozen = await evaluate(
    `(()=>{const r=${ROOT_EXPRESSION};globalThis[${JSON.stringify(marker)}]=r.innerHTML;return {length:r.innerHTML.length};})()`,
  );
  if (frozen.length > 8 * 1024 ** 2)
    throw new Fault("LIMIT_EXCEEDED", "正文 HTML 超过预算");
  let html = "";
  for (let offset = 0; offset < frozen.length; offset += 6000) {
    html += await evaluate(
      `globalThis[${JSON.stringify(marker)}].slice(${offset},${offset + 6000})`,
    );
  }
  const final = await evaluate(
    `(()=>{const r=${ROOT_EXPRESSION};const same=r.innerHTML===globalThis[${JSON.stringify(marker)}];delete globalThis[${JSON.stringify(marker)}];return {same,url:location.href};})()`,
  );
  meta = {
    ...meta,
    html,
    versionConsistent: final.same && final.url === meta.url,
  };
  const prepared = prepareArticle(meta);
  if (!prepared.text.trim())
    throw new Fault("EMPTY_ARTICLE", "无法提取非空正文");
  let total = Buffer.byteLength(html);
  const maxBytes = input.limits?.maxBytes || 50 * 1024 ** 2;
  if (total > maxBytes)
    throw new Fault("LIMIT_EXCEEDED", "正文超过本次图文预算");
  const dedup = new Map<string, ImageItem>();
  for (const item of prepared.images) {
    if (input.downloadImages === false) {
      item.error = "NOT_REQUESTED";
      continue;
    }
    if (!item.source) continue;
    if (total >= maxBytes) {
      item.error = "LIMIT_EXCEEDED";
      continue;
    }
    const cached = dedup.get(item.source);
    if (cached) {
      Object.assign(item, { ...cached, index: item.index, alt: item.alt });
      continue;
    }
    try {
      let bytes: Buffer;
      if (item.source.startsWith("data:image/")) {
        const match =
          /^data:image\/[a-z0-9.+-]+;base64,([a-zA-Z0-9+/=]+)$/.exec(
            item.source,
          );
        if (!match)
          throw new Fault("UNSUPPORTED_IMAGE_SOURCE", "不支持的内嵌图片");
        bytes = Buffer.from(match[1], "base64");
      } else {
        try {
          const r = await run(
            "fetch",
            { url: item.source, binary: true, via: "extension", tabId },
            true,
          );
          if (!r.base64)
            throw new Fault("IMAGE_DOWNLOAD_FAILED", "图片没有返回二进制内容");
          bytes = Buffer.from(r.base64, "base64");
        } catch (e) {
          if (!(e instanceof Fault && e.code === "LIMIT_EXCEEDED")) throw e;
          // Only an image GET with a confirmed channel-size rejection can use the native file path.
          const temporary = path.join(
            directory,
            `image-${item.index}.download`,
          );
          try {
            const fetched = await run("download", {
              url: item.source,
              savePath: temporary,
              timeout: 120000,
            });
            if (fetched.isError || !fs.existsSync(temporary))
              throw new Fault("IMAGE_DOWNLOAD_FAILED", "原生图片下载未完成");
            if (fs.statSync(temporary).size > maxBytes - total)
              throw new Fault("LIMIT_EXCEEDED", "图片超过剩余图文预算");
            bytes = fs.readFileSync(temporary);
          } finally {
            fs.rmSync(temporary, { force: true });
          }
        }
      }
      total += bytes.length;
      if (total > maxBytes) throw new Fault("LIMIT_EXCEEDED", "图文包超过预算");
      const info = await sharp(bytes, {
        limitInputPixels: 40_000_000,
      }).metadata();
      if (
        !info.width ||
        !info.height ||
        !["png", "jpeg", "webp", "gif", "avif", "tiff"].includes(
          info.format || "",
        )
      )
        throw new Fault("INVALID_IMAGE", "图片格式或尺寸无效");
      await sharp(bytes, { limitInputPixels: 40_000_000 }).stats();
      const rel = `images/image-${String(item.index).padStart(4, "0")}.${info.format}`;
      fs.writeFileSync(path.join(directory, rel), bytes, { mode: 0o600 });
      Object.assign(item, {
        path: rel,
        sha256: hash(bytes),
        bytes: bytes.length,
        width: info.width,
        height: info.height,
        mime: "image/" + info.format,
      });
      dedup.set(item.source, { ...item });
    } catch (e) {
      item.error = e instanceof Fault ? e.code : "IMAGE_DOWNLOAD_FAILED";
    }
  }
  const orderedBlocks = prepared
    .$("p,h1,h2,h3,h4,h5,h6,pre,table,img")
    .toArray()
    .map((el: any, index: number) => ({
      index: index + 1,
      type: el.tagName,
      textHash: hash(prepared.$(el).text()),
      ...(el.tagName === "img"
        ? { imageIndex: Number(prepared.$(el).attr("data-lb-image")) }
        : {}),
    }));
  const rendered = renderArticle(meta, prepared);
  const textCoverage =
    meta.versionConsistent && loading.stable ? "complete_for_scope" : "unknown";
  const success = prepared.images.filter((x) => x.path).length,
    failed = prepared.images.filter(
      (x) => x.error && x.error !== "NOT_REQUESTED",
    ).length;
  const manifest = {
    formatVersion: 1,
    type: "article.capture@v1",
    title: meta.title,
    author: meta.author,
    publishedText: meta.publishedText,
    sourceUrl: redactUrl(source),
    finalUrl: redactUrl(meta.url),
    capturedAt: new Date().toISOString(),
    contentHash: hash(html),
    markdownHash: hash(rendered.markdown),
    scope: "当前已授权可见正文",
    documentRevision: hash(html),
    verification: {
      method:
        "frozen DOM chunks, final DOM equality, decoded images with SHA-256",
      pages: "current_document_only",
      expandedContent: "current_DOM_only",
      missingFragments: null,
    },
    pagination: {
      detectedNextPage: !!meta.hasNextPage,
      status: meta.hasNextPage ? "not_collected" : "unknown",
    },
    orderedBlocks,
    textCoverage,
    mediaCoverage: {
      discoveredImages: prepared.images.length,
      downloadedImages: success,
      failedImages: failed,
      unsupportedEmbeddedMedia: prepared.media,
    },
    truncation: false,
    accessState: access,
    account,
    loading,
    versionConsistent: meta.versionConsistent,
    images: prepared.images.map((i) => ({
      ...i,
      source: i.source.startsWith("data:")
        ? "[inline image]"
        : redactUrl(i.source),
    })),
    warnings: [
      ...(!loading.stable
        ? ["正文未在加载预算内稳定，可能仍有未加载片段"]
        : []),
      ...(!meta.versionConsistent ? ["提取期间页面变化，完整性未知"] : []),
      ...(prepared.media ? ["存在未下载的音视频或嵌入内容"] : []),
      ...(failed ? ["部分图片未取得"] : []),
      ...(meta.hasNextPage ? ["检测到下一页；当前任务仅保存当前文档"] : []),
    ],
  };
  fs.writeFileSync(path.join(directory, "article.md"), rendered.markdown, {
    mode: 0o600,
  });
  fs.writeFileSync(path.join(directory, "article.html"), rendered.html, {
    mode: 0o600,
  });
  fs.writeFileSync(
    path.join(directory, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
    { mode: 0o600 },
  );
  const zip = path.join(directory, "article-with-images.zip");
  await new Promise<void>((resolve, reject) => {
    const out = fs.createWriteStream(zip, { mode: 0o600 });
    const archive = archiver("zip", { zlib: { level: 6 } });
    out.on("close", resolve);
    out.on("error", reject);
    archive.on("error", reject);
    archive.pipe(out);
    for (const name of ["article.md", "article.html", "manifest.json"])
      archive.file(path.join(directory, name), { name });
    archive.directory(path.join(directory, "images"), "images");
    void archive.finalize();
  });
  return {
    tabId,
    state:
      failed || !meta.versionConsistent || meta.hasNextPage || !loading.stable
        ? "partial"
        : "succeeded",
    manifest,
    files: [
      { name: "article.md", mime: "text/markdown" },
      { name: "article.html", mime: "text/html" },
      { name: "manifest.json", mime: "application/json" },
      { name: "article-with-images.zip", mime: "application/zip" },
      ...prepared.images
        .filter(
          (i) =>
            i.path &&
            !prepared.images.some(
              (j) => j.index < i.index && j.path === i.path,
            ),
        )
        .map((i) => ({ name: i.path!, mime: i.mime! })),
    ],
    directory,
  };
}
