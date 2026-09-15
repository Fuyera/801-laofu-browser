import fs from "node:fs";
const root = new URL("../", import.meta.url);
export const VERSION: string = JSON.parse(
  fs.readFileSync(new URL("package.json", root), "utf8"),
).version;
export const API_VERSION = "v1";
export const BUILD = (() => {
  try {
    return JSON.parse(
      fs.readFileSync(new URL("runtime/build.json", root), "utf8"),
    );
  } catch {
    return { version: VERSION, commit: null, dirty: null, builtAt: null };
  }
})();
