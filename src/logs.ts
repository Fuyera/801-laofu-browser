import fs from "node:fs";
import path from "node:path";
import { mkdir, sanitizeLog } from "./util.js";
export function operationalLog(home: string) {
  const dir = mkdir(path.join(home, "logs"));
  const prune = () => {
    const cutoff = Date.now() - 30 * 86400000;
    for (const name of fs.readdirSync(dir)) {
      if (!/^operations-\d{4}-\d{2}-\d{2}\.jsonl$/.test(name)) continue;
      if (Date.parse(name.slice(11, 21)) < cutoff)
        fs.rmSync(path.join(dir, name));
    }
  };
  prune();
  const timer = setInterval(prune, 86400000);
  timer.unref();
  return {
    write(event: string, data: any) {
      try {
        fs.appendFileSync(
          path.join(
            dir,
            `operations-${new Date().toISOString().slice(0, 10)}.jsonl`,
          ),
          JSON.stringify({
            at: new Date().toISOString(),
            event,
            ...sanitizeLog(data),
          }) + "\n",
          { mode: 0o600 },
        );
      } catch {
        /* An operational log failure cannot alter an already committed browser effect. */
      }
    },
    close() {
      clearInterval(timer);
    },
  };
}
