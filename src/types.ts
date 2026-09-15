export type Json =
  null | boolean | number | string | Json[] | { [k: string]: Json };
export type State =
  | "queued"
  | "running"
  | "waiting_user"
  | "suspended"
  | "succeeded"
  | "partial"
  | "failed"
  | "cancelled";
export type Effect = "not_started" | "started" | "confirmed" | "unknown";
export interface Product {
  id: string;
  name: string;
  role: "owner" | "product";
  scopes: string[];
  revoked: boolean;
  limits?: ProductLimits;
}
export interface ProductLimits {
  artifactBytes?: number;
  maxQueued?: number;
  maxResident?: number;
}
export const PRODUCT_LIMITS: Required<ProductLimits> = {
  artifactBytes: 2 * 1024 ** 3,
  maxQueued: 20,
  maxResident: 24,
};
export interface Profile {
  id: string;
  name: string;
  workerId: string;
  mode: "owner" | "isolated";
  productIds: string[];
  network: "owner" | "public";
  ready: boolean;
  quarantined: boolean;
  version: number;
}
export interface Job {
  id: string;
  kind: "command" | "task";
  productId: string;
  sessionId: string;
  profileId: string;
  workerId: string;
  type: string;
  input: Record<string, any>;
  state: State;
  effectState: Effect;
  attempt: number;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
  cancelRequested: boolean;
  result: any;
  error: any;
  fence: number;
  parentId?: string;
  executionPolicy?: AccountPolicy;
}
export interface AccountPolicy {
  mode: "anonymous" | "required";
  origins: string[];
  selector?: string;
  attribute?: string;
  expectedHash?: string;
}
export interface EventRow {
  id: number;
  jobId: string;
  kind: string;
  data: any;
  createdAt: number;
}
export interface Artifact {
  id: string;
  productId: string;
  jobId: string | null;
  filename: string;
  mime: string;
  bytes: number;
  sha256: string;
  createdAt: number;
  deleted: boolean;
  metadata: any;
}
export interface ToolReply {
  content: Array<{
    type: string;
    text?: string;
    data?: string;
    mimeType?: string;
    [k: string]: any;
  }>;
  isError?: boolean;
}
export interface WorkerMessage {
  type: string;
  [k: string]: any;
}
export const TERMINAL = new Set<State>([
  "succeeded",
  "partial",
  "failed",
  "cancelled",
]);
export interface Limits {
  queueTimeoutSeconds?: number;
  activeTimeoutSeconds?: number;
  humanWaitSeconds?: number;
  wallTimeoutSeconds?: number;
  maxSteps?: number;
  maxBytes?: number;
  maxTabs?: number;
}
export interface Execution {
  profileId: string;
  mode?: "desktop" | "server" | "auto";
}
export interface CaptureRequest {
  type: "article.capture@v1";
  execution: Execution;
  input: { url: string; downloadImages?: boolean };
  limits?: Limits;
  requestId?: string;
}
export interface FlowRequest {
  type: "browser.flow@v1";
  execution: Execution;
  input: { steps: Array<{ tool: string; args?: Record<string, unknown> }> };
  limits?: Limits;
  requestId?: string;
}
export interface CommandRequest {
  tool: string;
  args?: Record<string, unknown>;
  inputArtifacts?: { path: string };
  wallTimeoutSeconds?: number;
  requestId?: string;
}
export interface JobView extends Job {
  attemptId: string;
  requestId: string;
  nextAction: string | null;
  resumeAllowed: boolean;
  artifacts: Artifact[];
  checkpoint: any;
  created?: boolean;
}
