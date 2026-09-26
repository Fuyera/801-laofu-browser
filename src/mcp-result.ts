/** Host-facing evidence, not a second task state machine or a retry policy. */
export function jobEvidence(job: any) {
  const unknown = job.effectState === "unknown";
  const failed = job.state === "failed" || job.state === "cancelled";
  const partial = job.state === "partial";
  const terminal = ["succeeded", "partial", "failed", "cancelled"].includes(
    job.state,
  );
  const successful =
    job.state === "succeeded" && !unknown && job.result?.isError !== true;
  return {
    format: "laofu.mcp-result@v1",
    job: {
      id: job.id,
      state: job.state,
      effectState: job.effectState,
      checkpoint: job.checkpoint,
      artifacts: job.artifacts || [],
      error: job.error || null,
    },
    outcome: {
      terminal,
      successful,
      partial,
      requiresAttention:
        unknown ||
        failed ||
        partial ||
        job.state === "waiting_user" ||
        job.state === "suspended" ||
        job.result?.isError === true,
      nextAction: unknown
        ? "verify_effect_before_any_resubmit"
        : job.state === "waiting_user"
          ? "complete_requested_user_action"
          : job.state === "suspended" ||
              failed ||
              partial ||
              job.result?.isError === true
            ? "inspect_result"
            : terminal
              ? "none"
              : "query_job",
      queryTool: "laofu_job",
      queryArguments: { id: job.id },
      userAction: job.nextAction || null,
      resumeAllowed: job.resumeAllowed === true,
    },
  };
}

// Only tools which cannot navigate, focus, save files or change site notes.
const readOnly = new Set([
  "snapshot",
  "read_text",
  "query",
  "laofu_jobs",
  "laofu_job",
]);
export function toolAnnotations(name: string) {
  return {
    readOnlyHint: readOnly.has(name),
    destructiveHint: !readOnly.has(name),
    openWorldHint: ![
      "laofu_jobs",
      "laofu_job",
      "laofu_cancel",
      "laofu_resume",
    ].includes(name),
  };
}
