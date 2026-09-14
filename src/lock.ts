import fs from "node:fs";
import path from "node:path";
import { mkdir } from "./util.js";
import { Fault } from "./errors.js";
export function processLock(home: string, name: string) {
  mkdir(home);
  const file = path.join(home, name + ".lock");
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = fs.openSync(file, "wx", 0o600);
      fs.writeFileSync(
        fd,
        JSON.stringify({ pid: process.pid, startedAt: Date.now() }),
      );
      fs.closeSync(fd);
      return () => {
        try {
          if (JSON.parse(fs.readFileSync(file, "utf8")).pid === process.pid)
            fs.unlinkSync(file);
        } catch {}
      };
    } catch (e: any) {
      if (e.code !== "EEXIST") throw e;
      let pid: number;
      try {
        pid = JSON.parse(fs.readFileSync(file, "utf8")).pid;
        if (!Number.isInteger(pid) || pid < 1) throw new Error();
      } catch {
        throw new Fault("STATE_LOCKED", `状态锁无法核验，请检查 ${file}`);
      }
      try {
        process.kill(pid, 0);
        throw new Fault("STATE_LOCKED", "此状态目录已有进程使用");
      } catch (e: any) {
        if (e.code !== "ESRCH") throw e;
      }
      fs.unlinkSync(file);
    }
  }
  throw new Fault("STATE_LOCKED", "未能取得状态目录独占锁");
}
