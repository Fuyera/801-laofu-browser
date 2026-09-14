import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import { createServer } from "../dist/server.js";
import {
  commandBody,
  taskBody,
  jobResponse,
  artifactResponse,
  errorResponse,
  errorCodes,
} from "../dist/contracts.js";
import { baseline } from "../dist/catalog.js";
const home = fs.mkdtempSync(path.join(os.tmpdir(), "lb-contract-")),
  server = await createServer({ home });
try {
  await server.app.ready();
  fs.writeFileSync(
    "docs/openapi.json",
    JSON.stringify(server.app.swagger(), null, 2) + "\n",
  );
  fs.writeFileSync(
    "docs/schemas.json",
    JSON.stringify(
      {
        contractVersion: "1.0",
        upstream: baseline.baseline,
        commandRequest: commandBody,
        taskRequest: taskBody,
        job: jobResponse,
        artifact: artifactResponse,
        error: errorResponse,
        errorCodes,
      },
      null,
      2,
    ) + "\n",
  );
  for (const tool of baseline.tools) {
    const schema = commandBody.oneOf.find(
      (c) => c.properties.tool.const === tool.name,
    )?.properties.args;
    assert.deepEqual(schema, tool.inputSchema);
  }
  console.log(
    JSON.stringify({
      tools: baseline.tools.length,
      parameterEntries: baseline.tools.reduce(
        (n, t) => n + Object.keys(t.inputSchema.properties || {}).length,
        0,
      ),
      schemasMatch: true,
    }),
  );
} finally {
  await server.app.close();
  fs.rmSync(home, { recursive: true, force: true });
}
