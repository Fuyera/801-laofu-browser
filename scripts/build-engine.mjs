import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import "./verify-baseline.mjs";
const root = path.resolve(import.meta.dirname, ".."),
  out = path.join(root, "runtime/engine");
fs.mkdirSync(out, { recursive: true });
fs.cpSync(path.join(root, "vendor/huashu-chrome-1.2.0"), out, {
  recursive: true,
});
const changed = [];
function patch(rel, changes) {
  const f = path.join(out, rel);
  let body = fs.readFileSync(f, "utf8");
  for (const [before, after] of changes) {
    if (!body.includes(before))
      throw new Error(`Patch anchor missing ${rel}: ${before.slice(0, 80)}`);
    body = body.replace(before, after);
  }
  fs.writeFileSync(f, body);
  changed.push(rel);
}
patch("src/lib/paths.js", [
  [
    "path.join(os.homedir(), '.huashu-chrome')",
    "process.env.LAOFU_ENGINE_HOME || path.join(os.homedir(), '.laofu-browser', 'engine')",
  ],
  [
    "export const DEFAULT_PORT = 8899;",
    "export const DEFAULT_PORT = Number(process.env.LAOFU_BRIDGE_PORT || 18899);",
  ],
]);
patch("src/lib/rpc.js", [
  [
    "this.sessionId = sessionId || makeSessionId(client);",
    "this.sessionId = sessionId || process.env.LAOFU_SESSION_ID || makeSessionId(client);",
  ],
  [
    "this.pinnedSid = !!sessionId;",
    "this.pinnedSid = !!(sessionId || process.env.LAOFU_SESSION_ID);",
  ],
]);
patch("src/bridge.js", [
  [
    "if (msg.role === 'extension') {",
    "if (msg.role === 'extension') {\n      if (!process.env.LAOFU_PAIR_TOKEN || !tokenEquals(msg.pairingToken || '', process.env.LAOFU_PAIR_TOKEN) || msg.profileId !== process.env.LAOFU_PROFILE_ID) return ws.close(4003, 'browser pairing rejected');",
  ],
]);
for (const rel of ["extension/offscreen.js", "extension/background.js"]) {
  patch(rel, [
    [
      "const PORTS = [8899, 8900, 8901, 8902, 8903];",
      "const PORTS = [LAOFU.port];",
    ],
    [
      "role: 'extension',",
      "role: 'extension', pairingToken: LAOFU.token, profileId: LAOFU.profileId,",
    ],
  ]);
  const f = path.join(out, rel);
  fs.writeFileSync(
    f,
    "import { LAOFU } from './laofu-config.js';\n" + fs.readFileSync(f, "utf8"),
  );
}
fs.writeFileSync(
  path.join(out, "extension/laofu-config.js"),
  'export const LAOFU = {port:18899,token:"UNPAIRED",profileId:"UNPAIRED"};\n',
);
patch("extension/background.js", [
  [
    "const NO_SLOT_CMDS = new Set(['tabs', 'download', 'reload', 'status']);",
    "const NO_SLOT_CMDS = new Set(['tabs', 'download', 'reload', 'status', '__lb_control']);\nasync function lbGuard(ctx) {\n const {lbControl:c}=await chrome.storage.session.get('lbControl');\n if(!c || !ctx?.lb || c.jobId!==ctx.lb.jobId || c.fence!==ctx.lb.fence || c.cancelled || Date.now()>c.expiresAt) throw err('CONTROL_REVOKED','Browser execution control is absent, expired or revoked');\n}\n",
  ],
  [
    "const handler = HANDLERS[msg.cmd];",
    "const handler = HANDLERS[msg.cmd];\n    if (msg.cmd !== '__lb_control') await lbGuard({lb:msg.params?.__lb});",
  ],
  [
    "const ctx = { sid: msg.sid, live: msg.live, adopted: false };",
    "const ctx = { sid: msg.sid, live: msg.live, adopted: false, lb:msg.params?.__lb };",
  ],
  [
    "const HANDLERS = {",
    "const HANDLERS = {\n  async __lb_control(p) {\n    const {lbControl:old}=await chrome.storage.session.get('lbControl');\n    if(old && Number(p.fence)<Number(old.fence)) throw err('CONTROL_REVOKED','Stale controller');\n    await chrome.storage.session.set({lbControl:p}); return {text:'control updated'};\n  },",
  ],
  [
    "const execStep = async (st, progress, plan, out = done) => {",
    "const execStep = async (st, progress, plan, out = done) => {\n      await lbGuard(ctx);\n      await chrome.storage.session.set({lbStep:{jobId:ctx.lb.jobId,index:executed,state:'started'}});",
  ],
  [
    "reject(err('TIMEOUT', `下载超过 ${(p.timeout || 120000) / 1000}s 未完成`));",
    "chrome.downloads.cancel(dlId).catch(() => {});\n        reject(err('TIMEOUT', `下载超过 ${(p.timeout || 120000) / 1000}s 未完成，已请求取消`));",
  ],
]);
patch("extension/background.js", [
  ["async ask(p, tabId) {", "async ask(p, tabId, ctx) {"],
  [
    "async __lb_control(p) {\n    const {lbControl:old}=await chrome.storage.session.get('lbControl');",
    "async __lb_control(p) {\n    const {lbControl:old,lbAsk}=await chrome.storage.session.get(['lbControl','lbAsk']);\n    if(p.op==='ask_status') return {ask:lbAsk?.jobId===p.jobId?lbAsk:null};\n    if(p.op==='ask_finish'){if(!old||old.jobId!==p.jobId||old.fence!==p.fence||!lbAsk||lbAsk.jobId!==p.jobId)throw err('CONTROL_REVOKED','No matching handoff');await chrome.storage.session.set({lbAsk:{...lbAsk,outcome:p.outcome==='cancelled'?'cancelled':'continued'}});return {text:'handoff recorded'};}",
  ],
  [
    "const panel = pollPanel(id, timeout);",
    "await chrome.storage.session.set({lbAsk:{jobId:ctx.lb.jobId,tabId:id,ready:true}});\n    const panel = pollPanel(id, timeout, ctx.lb.jobId);",
  ],
  [
    "function pollPanel(id, timeout) {",
    "function pollPanel(id, timeout, lbJobId) {",
  ],
  [
    "const r = await chrome.tabs.sendMessage(id, { __hcAsk: 'poll' });",
    "if(lbJobId){const {lbAsk}=await chrome.storage.session.get('lbAsk');if(lbAsk?.jobId===lbJobId&&lbAsk.outcome)return {outcome:lbAsk.outcome,note:''};}\n        const r = await chrome.tabs.sendMessage(id, { __hcAsk: 'poll' });",
  ],
  [
    "auto?.stop();\n    if (res.outcome === 'completed')",
    "auto?.stop();\n    await chrome.storage.session.remove('lbAsk');\n    if (res.outcome === 'completed' || res.outcome === 'continued' || res.outcome === 'cancelled')",
  ],
]);
// Compare a stable target's text, including equal-length state changes. Never infer
// a business-side effect from unrelated global text changes.
patch("extension/content.js", [
  [
    "const s1 = cheapStats();\n    await sleep(60);",
    "const targetText = (el?.innerText || '').slice(0, 8192);\n    const s1 = cheapStats();\n    await sleep(60);",
  ],
  [
    "      volatile,\n      textLen:",
    "      volatile,\n      lbTargetText: targetText,\n      lbTargetTextStable: targetText === (el?.innerText || '').slice(0, 8192),\n      textLen:",
  ],
  [
    "const bt = base.target || {}, nt = targetState(el);",
    "const bt = base.target || {}, nt = targetState(el);\n    if (el && !nt.gone && base.lbTargetTextStable && base.lbTargetText !== (el.innerText || '').slice(0, 8192)) strong.push('目标元素文本发生变化');",
  ],
]);
// Preserve whether an error is an actual completed browser reply or a transport timeout.
patch("extension/background.js", [
  [
    "{ code: e.code || 'INTERNAL', message: e.message || String(e) }, msg.__k);",
    "{ code: e.code || 'INTERNAL', message: e.message || String(e), browserAcknowledged:true }, msg.__k);",
  ],
]);
patch("src/lib/rpc.js", [
  [
    "{ code: msg.error?.code || 'INTERNAL' }",
    "{ code: msg.error?.code || 'INTERNAL', browserAcknowledged:msg.error?.browserAcknowledged===true }",
  ],
]);
// An absent DOM effect cannot prove that an external write did not happen.
patch("extension/background.js", [
  [
    "const runL1 = async () => {",
    "const runL1 = async () => {\n    await lbGuard(ctx);",
  ],
  [
    "note = usedL2 ? await execL2(id, cmd, params, loc) : await runL1();",
    "await lbGuard(ctx);\n    note = usedL2 ? await execL2(id, cmd, params, loc) : await runL1();",
  ],
  [
    "if (usedL2 && (e.code === 'NEEDS_L2' || e.code === 'L2_BUSY')) {",
    "if (!ctx?.lb && usedL2 && (e.code === 'NEEDS_L2' || e.code === 'L2_BUSY')) {",
  ],
  [
    "if (!ev.changed && !usedL2 && l2ok && !params.real) {",
    "await lbGuard(ctx);\n  if (!ev.changed && !usedL2 && l2ok && !params.real && ctx?.lb) {\n    throw err('EFFECT_UNKNOWN','动作已发出，但没有可核验的页面变化；禁止自动换方式重试，请先核验外部效果');\n  }\n  if (!ev.changed && !usedL2 && l2ok && !params.real && !ctx?.lb) {",
  ],
]);
patch("src/mcp-server.js", [
  [
    "const base = { path: args.path,",
    "const base = { __lb: args.__lb, path: args.path,",
  ],
  [
    "bridge.call('fetch', { url: url.toString(),",
    "bridge.call('fetch', { __lb: args.__lb, url: url.toString(),",
  ],
]);
patch("extension/background.js", [
  ["func: (src, max) => {", "func: async (src, max) => {"],
  [
    'const v = (0, eval)(`"use strict"; (${src})`);',
    'const v = await (0, eval)(`"use strict"; (${src})`);',
  ],
]);
patch("src/mcp-server.js", [
  [
    "return { content: [{ type: 'text', text: hint(e) + mismatchNote() }], isError: true };",
    "return { content: [{ type: 'text', text: hint(e) + mismatchNote() }], isError: true, _meta: {'laofu.error':{code:e.code || 'TOOL_ERROR',browserAcknowledged:e.browserAcknowledged===true}} };",
  ],
]);

patch("extension/background.js", [
  [
    "if (!binary) return { status: res.status, body: (await res.text()).slice(0, maxBody) };",
    "if (!binary) { const full=await res.text(); return {status:res.status,body:full.slice(0,maxBody),truncated:full.length>maxBody,originalLength:full.length}; }",
  ],
  [
    'return { untrusted: true, meta: `url="${p.url}"`, text: `${result.status}\\n\\n${result.body}` };',
    'return { untrusted: true, meta: `url="${p.url}"`, text: `${result.status}\\n\\n${result.body}`, truncated:result.truncated, originalLength:result.originalLength };',
  ],
  [
    "body: String(r.body || '').slice(0, maxBody) }",
    "body: String(r.body || '').slice(0, maxBody), truncated:!!r.truncated || String(r.body||'').length>maxBody, originalLength:r.originalLength ?? null }",
  ],
  [
    "text: `${result.status} ${result.url}\\n\\n${result.body}` };",
    "text: `${result.status} ${result.url}\\n\\n${result.body}`,truncated:result.truncated,originalLength:result.originalLength };",
  ],
]);
patch("extension/net-hook.js", [
  [
    "const body = /json|text|javascript/.test(ct) ? (await res.clone().text()).slice(0, MAX_BODY) : '';",
    "const full = /json|text|javascript/.test(ct) ? (await res.clone().text()) : ''; const body=full.slice(0,MAX_BODY);",
  ],
  [
    "url, status: res.status, ct, body });",
    "url, status: res.status, ct, body, truncated:full.length>MAX_BODY,originalLength:full.length });",
  ],
  [
    "body: String(this.responseText || '').slice(0, MAX_BODY),",
    "body: String(this.responseText || '').slice(0, MAX_BODY),truncated:String(this.responseText||'').length>MAX_BODY,originalLength:String(this.responseText||'').length,",
  ],
]);
patch("src/mcp-server.js", [
  [
    "return { content: [{ type: 'text', text: body + mismatchNote() }] };",
    "return { content: [{ type: 'text', text: body + mismatchNote() }], _meta:{'laofu.output':{truncated:!!data.truncated || /已截断|超过 maxBody/.test(data.text||''),originalLength:data.originalLength ?? null,outcome:data.outcome ?? null,effectUnknown:!!data.effectUnknown,completed:data.completed ?? null,doneCount:data.doneCount ?? null,nextAction:data.truncated?'request_larger_budget_or_article_capture':null}} };",
  ],
  [
    "const m = /^(\\d+)\\n\\n([\\s\\S]*)$/.exec(data?.text || '');",
    "if(data.truncated) throw Object.assign(new Error('TRUNCATED: 分页响应在浏览器内已截断，未保存为完整 JSON；请增大 maxBody'),{code:'TRUNCATED'});\n    const m = /^(\\d+)\\n\\n([\\s\\S]*)$/.exec(data?.text || '');",
  ],
]);
patch("src/mcp-server.js", [
  [
    "if (n === 'download') return 150000;",
    "if (n === 'download') return Math.min(Math.max(Number(a.timeout)||120000,1000),600000)+30000;",
  ],
]);
patch("extension/background.js", [
  [
    "throw err('INTERNAL', `扩展侧下载失败：",
    "throw err(e.code || 'INTERNAL', `扩展侧下载失败：",
  ],
]);
patch("extension/background.js", [
  [
    "stopped = { label, why: `[${e.code || 'INTERNAL'}] ${e.message}` };",
    "stopped = { label, code:e.code, why: `[${e.code || 'INTERNAL'}] ${e.message}` };",
  ],
  [
    "completed: !stopped, doneCount: doneTop };",
    "completed: !stopped, doneCount: doneTop, effectUnknown:stopped?.code==='EFFECT_UNKNOWN' };",
  ],
]);
// Brand labels are ours; preserve the immutable upstream attribution and source.
patch("extension/background.js", [["const GROUP_TITLE = '花叔';", `const GROUP_TITLE = '老傅';
// Migrate only groups recorded as this extension's own and still bearing its old label.
void (async () => {
  const saved = await chrome.storage.local.get(null);
  for (const [key, groupId] of Object.entries(saved)) {
    if (!key.startsWith('agentGroup:') || !Number.isInteger(groupId)) continue;
    const group = await chrome.tabGroups.get(groupId).catch(() => null);
    if (group?.title === '花叔') await chrome.tabGroups.update(groupId, {title: GROUP_TITLE});
  }
})().catch(() => {});
`]]);
for (const rel of ["extension/popup.html", "extension/popup.js"]) {
  const f = path.join(out, rel);
  fs.writeFileSync(
    f,
    fs.readFileSync(f, "utf8").replaceAll("huashu-chrome", "laofu-browser"),
  );
  changed.push(rel);
}

{
  const file = path.join(out, "extension/background.js");
  let code = fs.readFileSync(file, "utf8");
  const start = code.indexOf("  async download(p) {"),
    end = code.indexOf("  async upload(p, tabId) {", start);
  if (start < 0 || end < 0) throw new Error("download handler anchor missing");
  code =
    code.slice(0, start) +
    fs.readFileSync(path.join(root, "scripts/download-handler.txt"), "utf8") +
    code.slice(end);
  code = code.replace(
    "const bytes = new Uint8Array(await res.arrayBuffer());",
    "const max=12*1024*1024;const parts=[];let size=0;const reader=res.body.getReader();while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>max){await reader.cancel();throw err('LIMIT_EXCEEDED','二进制通道超过 12 MiB；使用原生 download');}parts.push(value);}const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}",
  );
  code = code.replace(
    "const bytes = new Uint8Array(await res.arrayBuffer());",
    "const parts=[];let size=0;const reader=res.body.getReader();while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>12*1024*1024){await reader.cancel();throw new Error('LIMIT_EXCEEDED: 二进制通道超过 12 MiB');}parts.push(value);}const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}",
  );
  fs.writeFileSync(file, code);
  changed.push("extension/background.js:bounded-download");
}
const manifest = JSON.parse(
  fs.readFileSync(path.join(out, "extension/manifest.json"), "utf8"),
);
manifest.name = "laofu-browser";
manifest.description = "老傅的浏览器执行能力；基于 huashu-chrome 1.2.0";
manifest.action.default_title = "laofu-browser";
delete manifest.key;
fs.writeFileSync(
  path.join(out, "extension/manifest.json"),
  JSON.stringify(manifest, null, 2) + "\n",
);
fs.writeFileSync(
  path.join(out, "PATCHES.json"),
  JSON.stringify(
    {
      upstream: "huashu-chrome@1.2.0",
      changes: changed,
      scope: [
        "isolated state directory",
        "explicit browser pairing",
        "stable service session",
        "execution control checks",
        "download timeout cancellation",
        "independent extension identity",
      ],
      generatedAt: new Date().toISOString(),
    },
    null,
    2,
  ),
);
console.log(JSON.stringify({ engine: out, patches: changed.length }));
