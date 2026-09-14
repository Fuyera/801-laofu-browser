import test from "node:test";
import assert from "node:assert/strict";
import { prepareArticle, renderArticle, accessState } from "../src/article.js";
test("article conversion preserves paragraph/image order, code spacing and table while removing active content", () => {
  const meta = {
    url: "https://example.com/article?token=secret",
    title: "原文",
    author: "作者",
    html: '<p>第一段</p><img data-src="/a.png" alt="示例"><pre><code>  x = 1\n  y = 2</code></pre><table><thead><tr><th>项目</th><th>数量</th></tr></thead><tbody><tr><td>图</td><td>1</td></tr></tbody></table><p>末段<a href="javascript:alert(1)">链接</a></p><script>alert(1)</script><img src="/b.png" onerror="fetch(\'/secret\')">',
  };
  const prepared = prepareArticle(meta);
  prepared.images[0].path = "images/image-0001.png";
  prepared.images[1].error = "IMAGE_DOWNLOAD_FAILED";
  const out = renderArticle(meta, prepared);
  assert.ok(
    out.markdown.indexOf("第一段") <
      out.markdown.indexOf("images/image-0001.png"),
  );
  assert.ok(
    out.markdown.indexOf("images/image-0001.png") <
      out.markdown.indexOf("末段"),
  );
  assert.match(out.markdown, /  x = 1\n  y = 2/);
  assert.match(out.markdown, /\| 项目 \| 数量 \|/);
  assert.match(out.markdown, /图片 2 未取得/);
  assert.doesNotMatch(out.html, /<script|onerror|javascript:/);
  assert.doesNotMatch(out.markdown, /token=secret/);
  assert.doesNotMatch(out.html, /src="https?:/);
});
test("verification walls are not articles and an article discussing captchas is not a wall", () => {
  assert.equal(
    accessState({ title: "环境异常", text: "请完成验证" }),
    "verification_required",
  );
  assert.equal(
    accessState({ title: "操作过于频繁", text: "请稍后重试" }),
    "rate_limited",
  );
  assert.equal(
    accessState({
      title: "验证码的工作原理",
      text: "验证码帮助系统区分访问类型。".repeat(30),
      hasArticle: true,
    }),
    "accessible",
  );
});

test("network and HTTP error pages and explicit paywalls cannot become successful articles", () => {
  assert.equal(
    accessState({
      url: "chrome-error://chromewebdata/",
      title: "无法访问此网站",
      text: "ERR_PROXY_CONNECTION_FAILED",
    }),
    "network_error",
  );
  assert.equal(
    accessState({
      url: "https://example.com",
      httpStatus: 403,
      title: "Denied",
      text: "NETWORK_DENIED",
      hasArticle: true,
    }),
    "access_denied",
  );
  assert.equal(
    accessState({ httpStatus: 429, title: "原文", text: "访问限制" }),
    "rate_limited",
  );
  assert.equal(
    accessState({
      title: "文章",
      text: "预览正文".repeat(60),
      hasArticle: true,
      blockedMarker: "paywall",
    }),
    "paywall",
  );
  assert.equal(
    accessState({ httpStatus: 404, title: "Not found", text: "页面不存在" }),
    "deleted",
  );
});
