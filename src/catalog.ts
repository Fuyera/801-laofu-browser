import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import AjvImport from "ajv";
import { Fault } from "./errors.js";
const Ajv = AjvImport as unknown as new (options: any) => any;
export const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
export const baseline = JSON.parse(
  fs.readFileSync(path.join(ROOT, "docs/LAOFU_BROWSER_BASELINE.json"), "utf8"),
);
export const tools: Array<{
  name: string;
  description: string;
  inputSchema: any;
  id: string;
}> = baseline.tools;
const ajv = new Ajv({ strict: false, allErrors: true });
const validators = new Map(
  tools.map((t) => [t.name, ajv.compile(t.inputSchema)]),
);
export function validateTool(name: string, args: any) {
  const check = validators.get(name);
  if (!check) throw new Fault("CAPABILITY_UNAVAILABLE", "工具不存在", 404);
  if (!check(args))
    throw new Fault("INVALID_ARGUMENT", "工具参数不符合冻结的参数定义");
}
export const readingTools = new Set([
  "snapshot",
  "read_text",
  "query",
  "screenshot",
  "status",
]);
