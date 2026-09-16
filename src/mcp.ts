import { VERSION, BUILD, API_VERSION } from "./version.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { BrowserClient } from "./client.js";
import { problem, Fault } from "./errors.js";
export async function serveMcp(client: BrowserClient, profileId: string) {
  const server = new Server(
    { name: "laofu-browser", version: VERSION },
    { capabilities: { tools: {} } },
  );
  let sessionId = "";
  const extra = [
    {
      name: "laofu_jobs",
      description:
        "列出本调用方的任务和命令，找回连接中断前的命令 ID；不会重放",
      inputSchema: {
        type: "object",
        properties: {
          limit: { type: "integer", minimum: 1, maximum: 200 },
          cursor: { type: "string" },
        },
      },
    },
    {
      name: "laofu_task",
      description: "提交持久图文采集任务；返回 taskId，可跨连接查询",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string" },
          idempotencyKey: { type: "string" },
        },
        required: ["url", "idempotencyKey"],
      },
    },
    {
      name: "laofu_job",
      description: "查询任务或命令状态与产物",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },
    {
      name: "laofu_cancel",
      description: "请求取消任务或命令，不重放未知写操作",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },
    {
      name: "laofu_resume",
      description: "人工完成操作后恢复正在等待的任务",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },
  ];
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      ...(await client.capabilities()).tools
        .filter((t: any) => t.authorized)
        .map(({ name, description, inputSchema }: any) => ({
          name,
          description,
          inputSchema,
        })),
      ...extra,
    ],
  }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    let submission:
      | { idempotencyKey: string; sessionId?: string; commandId?: string }
      | undefined;
    try {
      const args: any = req.params.arguments || {};
      let result: any;
      if (req.params.name === "laofu_jobs")
        result = await client.request(
          "GET",
          "/v1/tasks?" +
            new URLSearchParams({
              includeCommands: "1",
              ...(args.limit ? { limit: String(args.limit) } : {}),
              ...(args.cursor ? { cursor: args.cursor } : {}),
            }),
        );
      else if (req.params.name === "laofu_task") {
        submission = { idempotencyKey: args.idempotencyKey };
        result = await client.submitTask(
          {
            type: "article.capture@v1",
            execution: { profileId },
            input: { url: args.url },
          },
          args.idempotencyKey,
        );
      } else if (req.params.name === "laofu_job")
        result = await client.job(args.id);
      else if (req.params.name === "laofu_cancel")
        result = await client.cancel(args.id);
      else if (req.params.name === "laofu_resume")
        result = await client.resume(args.id);
      else {
        if (!sessionId) sessionId = (await client.session(profileId)).id;
        const forwarded = { ...args },
          inputArtifacts: any = {};
        if (req.params.name === "upload" && args.path) {
          const input = await client.upload(args.path);
          inputArtifacts.path = input.id;
          forwarded.path = path.basename(args.path);
        }
        if (args.savePath) forwarded.savePath = path.basename(args.savePath);
        submission = { sessionId, idempotencyKey: crypto.randomUUID() };
        const job = await client.command(
          sessionId,
          { tool: req.params.name, args: forwarded, inputArtifacts },
          submission.idempotencyKey,
        );
        submission.commandId = job.id;
        try {
          result = await client.wait(job.id, { timeoutMs: 30000 });
        } catch (e: any) {
          if (e.code !== "CLIENT_WAIT_TIMEOUT") throw e;
          result = await client.job(job.id);
        }
        if (
          result.state === "succeeded" &&
          args.savePath &&
          result.artifacts?.[0]
        )
          await client.download(result.artifacts[0].id, args.savePath);
        if (result.state === "succeeded" && result.result?.content)
          return {
            ...result.result,
            content: [
              ...result.result.content,
              {
                type: "text",
                text: JSON.stringify({
                  commandId: job.id,
                  artifacts: result.artifacts,
                }),
              },
            ],
          };
      }
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        isError: result.state === "failed",
      };
    } catch (e) {
      const unknown =
        submission &&
        (!(e instanceof Fault) || e.statusCode >= 500 || submission.commandId);
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: JSON.stringify(
              unknown
                ? {
                    error: {
                      code: "EFFECT_UNKNOWN",
                      message:
                        "提交或等待连接中断，结果未知。先用 laofu_jobs / laofu_job 查询记录，不要生成新键重发。",
                      retryable: false,
                    },
                    recovery: {
                      ...submission,
                      queryTool: "laofu_jobs",
                      nextAction: "query_before_resubmit",
                    },
                  }
                : { error: problem(e) },
            ),
          },
        ],
      };
    }
  });
  await server.connect(new StdioServerTransport());
  return server;
}
