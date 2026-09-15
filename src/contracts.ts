import { tools } from "./catalog.js";
const str = { type: "string" },
  profileId = { type: "string", pattern: "^prf_[a-f0-9]{32}$" },
  artifactId = { type: "string", pattern: "^art_[a-f0-9]{32}$" };
const object = (
  properties: any,
  required: string[] = [],
  additionalProperties = false,
) => ({ type: "object", properties, required, additionalProperties });
const integer = (minimum: number, maximum: number) => ({
  type: "integer",
  minimum,
  maximum,
});
const productLimits = object({
  artifactBytes: integer(1024, 10 * 1024 ** 3),
  maxQueued: integer(1, 1000),
  maxResident: integer(1, 1000),
});
export const commandBody = {
  oneOf: tools.map((t) =>
    object(
      {
        tool: { const: t.name },
        args: t.inputSchema,
        inputArtifacts: object({ path: artifactId }),
        wallTimeoutSeconds: integer(1, 3600),
        requestId: { type: "string", maxLength: 200 },
      },
      ["tool"],
    ),
  ),
};
export const taskBody = object(
  {
    type: { enum: ["article.capture@v1", "browser.flow@v1"] },
    profileId,
    execution: object(
      { profileId, mode: { enum: ["desktop", "server", "auto"] } },
      ["profileId"],
    ),
    input: {
      oneOf: [
        object(
          {
            url: { type: "string", format: "uri", pattern: "^https?://" },
            downloadImages: { type: "boolean" },
          },
          ["url"],
        ),
        object(
          {
            steps: {
              type: "array",
              minItems: 1,
              maxItems: 30,
              items: {
                oneOf: tools.map((t) =>
                  object({ tool: { const: t.name }, args: t.inputSchema }, [
                    "tool",
                  ]),
                ),
              },
            },
          },
          ["steps"],
        ),
      ],
    },
    limits: object({
      queueTimeoutSeconds: integer(1, 900),
      activeTimeoutSeconds: integer(1, 1800),
      humanWaitSeconds: integer(5, 600),
      wallTimeoutSeconds: integer(5, 3600),
      maxSteps: integer(1, 2000),
      maxBytes: integer(1024, 1024 ** 3),
      maxTabs: integer(1, 50),
    }),
    requestId: { type: "string", maxLength: 200 },
  },
  ["type", "input"],
);
export const bodySchemas: Record<string, any> = {
  "POST /v1/admin/bootstrap": object({ token: str }, ["token"]),
  "POST /v1/admin/products": object(
    {
      name: { type: "string", minLength: 1, maxLength: 100 },
      limits: productLimits,
      scopes: {
        type: "array",
        uniqueItems: true,
        items: {
          enum: [
            "article.capture",
            "browser.read",
            "artifacts.write",
            "learnings.write",
          ],
        },
      },
    },
    ["name"],
  ),
  "PATCH /v1/admin/products/:id": object({ limits: productLimits }, ["limits"]),
  "PUT /v1/admin/profiles/:id/account-policy": object(
    {
      mode: { enum: ["anonymous", "required"] },
      origins: {
        type: "array",
        maxItems: 50,
        uniqueItems: true,
        items: { type: "string", format: "uri", pattern: "^https?://" },
      },
      selector: { type: "string", minLength: 1, maxLength: 500 },
      attribute: { type: "string", pattern: "^[a-zA-Z][a-zA-Z0-9_-]{0,100}$" },
      expectedHash: { type: "string", pattern: "^[a-f0-9]{64}$" },
    },
    ["mode", "origins"],
  ),
  "POST /v1/admin/workers": object({
    name: { type: "string", maxLength: 100 },
    mode: { enum: ["owner", "isolated"] },
  }),
  "PATCH /v1/admin/profiles/:id": object(
    {
      productIds: {
        type: "array",
        maxItems: 1,
        uniqueItems: true,
        items: { type: "string", pattern: "^prd_[a-f0-9]{32}$" },
      },
    },
    ["productIds"],
  ),
  "POST /v1/admin/profiles/:id/recover": object(
    {
      confirmStopped: { const: true },
      acknowledgeUnknownEffects: { const: true },
    },
    ["confirmStopped", "acknowledgeUnknownEffects"],
  ),
  "POST /v1/sessions": object({ profileId }, ["profileId"]),
  "POST /v1/sessions/:id/commands": commandBody,
  "POST /v1/tasks": taskBody,
  "POST /v1/learnings/:domain/restore": object(
    { targetVersion: integer(1, 1e9), version: integer(0, 1e9) },
    ["targetVersion", "version"],
  ),
  "PUT /v1/learnings/:domain": object(
    { body: { type: "string", maxLength: 100000 }, version: integer(0, 1e9) },
    ["body", "version"],
  ),
};
export const errorResponse = object(
  {
    error: object(
      {
        code: str,
        message: str,
        retryable: { type: "boolean" },
        details: { type: "object", additionalProperties: true },
      },
      ["code", "message", "retryable"],
    ),
  },
  ["error"],
);
export const artifactResponse = object(
  {
    id: artifactId,
    productId: str,
    jobId: { type: ["string", "null"] },
    filename: str,
    mime: str,
    bytes: integer(0, Number.MAX_SAFE_INTEGER),
    sha256: { type: "string", pattern: "^[a-f0-9]{64}$" },
    createdAt: integer(0, Number.MAX_SAFE_INTEGER),
    deleted: { type: "boolean" },
    metadata: { type: "object", additionalProperties: true },
  },
  ["id", "filename", "mime", "bytes", "sha256"],
  true,
);
export const jobResponse = object(
  {
    id: str,
    kind: { enum: ["task", "command"] },
    type: str,
    state: {
      enum: [
        "queued",
        "running",
        "waiting_user",
        "suspended",
        "succeeded",
        "partial",
        "failed",
        "cancelled",
      ],
    },
    effectState: { enum: ["not_started", "started", "confirmed", "unknown"] },
    profileId,
    productId: str,
    workerId: str,
    sessionId: str,
    requestId: str,
    attemptId: str,
    attempt: integer(1, Number.MAX_SAFE_INTEGER),
    createdAt: integer(0, Number.MAX_SAFE_INTEGER),
    updatedAt: integer(0, Number.MAX_SAFE_INTEGER),
    expiresAt: integer(0, Number.MAX_SAFE_INTEGER),
    cancelRequested: { type: "boolean" },
    result: {},
    error: {},
    artifacts: { type: "array", items: artifactResponse },
  },
  [
    "id",
    "kind",
    "type",
    "state",
    "effectState",
    "profileId",
    "requestId",
    "attemptId",
  ],
  true,
);
export function applyContracts(route: any) {
  const methods = Array.isArray(route.method) ? route.method : [route.method];
  for (const method of methods) {
    if (
      ["/v1/tasks", "/v1/sessions/:id/commands"].includes(route.url) &&
      method === "POST"
    )
      route.schema = {
        ...route.schema,
        response: {
          202: jobResponse,
          400: errorResponse,
          401: errorResponse,
          403: errorResponse,
          409: errorResponse,
          503: errorResponse,
        },
      };
    if (
      ["/v1/tasks/:id", "/v1/commands/:id"].includes(route.url) &&
      method === "GET"
    )
      route.schema = {
        ...route.schema,
        response: { 200: jobResponse, 401: errorResponse, 403: errorResponse },
      };

    const schema = bodySchemas[method + " " + route.url];
    if (schema) route.schema = { ...route.schema, body: schema };
    if (
      method === "POST" &&
      ["/v1/tasks", "/v1/sessions/:id/commands"].includes(route.url)
    )
      route.schema = {
        ...route.schema,
        headers: object(
          {
            "idempotency-key": { type: "string", minLength: 1, maxLength: 200 },
          },
          ["idempotency-key"],
          true,
        ),
      };
  }
}
export const errorCodes = {
  INVALID_ARGUMENT: "请求未受理；参数或预算无效",
  UNAUTHORIZED: "凭据缺失、过期或吊销",
  FORBIDDEN: "调用方无权访问；不区分他人资源是否存在",
  IDEMPOTENCY_CONFLICT: "稳定幂等键已用于不同请求",
  PROFILE_BUSY: "浏览器由另一个控制者占用",
  AUTH_REQUIRED: "页面需要人工登录",
  RATE_LIMITED: "页面限流；本任务不自动重试",
  EFFECT_UNKNOWN: "已发送动作的外部结果未确认；禁止自动重放",
  TIMEOUT: "预算到期；查询原命令以确认停止与效果",
  ARTIFACT_INCOMPLETE: "下载或上传未通过长度/哈希完整性校验",
  CAPABILITY_UNAVAILABLE: "能力、权限或环境门槛未满足",
};
