import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

test("closing a tab cleans its session state and emits closure without touching other tabs", async () => {
  const source = fs.readFileSync(
    "runtime/engine/extension/background.js",
    "utf8",
  );
  const start = source.indexOf("chrome.tabs.onRemoved.addListener(");
  const end = source.indexOf("\n});", start) + "\n});".length;
  const local: Record<string, any> = {
    activeTabId: 7,
    "agentTab:a": 7,
    "agentTab:b": 8,
    "tabLabel:7": "gone",
    "ownTabs:a": [7, 8],
  };
  // The unrelated key forces evaluation past the matched keys, reproducing childKey's ReferenceError.
  const session: Record<string, any> = {
    unrelated: "keep",
    "seen:a:7": 1,
    "frames:7": {},
    "frames:8": {},
    "seen:a:8": 1,
  };
  const store = (data: Record<string, any>) => ({
    get: async () => ({ ...data }),
    set: async (v: object) => Object.assign(data, v),
    remove: async (keys: string[]) => keys.forEach((k) => delete data[k]),
  });
  let close!: (id: number) => Promise<void>;
  const events: any[] = [],
    marks: any[] = [];
  vm.runInNewContext(source.slice(start, end), {
    chrome: {
      tabs: {
        onRemoved: {
          addListener: (fn: typeof close) => {
            close = fn;
          },
        },
      },
      storage: { local: store(local), session: store(session) },
    },
    labelKey: (id: number) => `tabLabel:${id}`,
    frameSnapKey: (id: number) => `frames:${id}`,
    REG_PREFIX: "ownTabs:",
    noteMarked: async (...v: any[]) => marks.push(v),
    emit: (...v: any[]) => events.push(v),
  });
  await close(7);
  assert.deepEqual(JSON.parse(JSON.stringify(local)), {
    "agentTab:b": 8,
    "ownTabs:a": [8],
  });
  assert.deepEqual(session, {
    unrelated: "keep",
    "frames:8": {},
    "seen:a:8": 1,
  });
  assert.deepEqual(marks, [[7, false]]);
  assert.equal(events.length, 1);
  assert.equal(events[0][0], "tab_closed");
  assert.equal(events[0][1].tabId, 7);
});
