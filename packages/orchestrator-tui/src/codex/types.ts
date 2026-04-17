/**
 * TypeScript types for the Codex app-server JSON-RPC protocol.
 *
 * The Codex app-server uses JSON-RPC 2.0 style messages over stdio (JSONL)
 * but omits the "jsonrpc":"2.0" header on the wire.
 */

// ── JSON-RPC base types ──────────────────────────────────────────────

/** Client → server request (has an `id` for response matching). */
export interface JsonRpcRequest {
  method: string;
  id: number;
  params?: unknown;
}

/** Server → client response (echoes the request `id`). */
export interface JsonRpcResponse {
  id: number;
  result?: unknown;
  error?: JsonRpcError;
}

export interface JsonRpcError {
  code: number;
  message: string;
}

/** Notification — no `id`, no response expected. Sent by either side. */
export interface JsonRpcNotification {
  method: string;
  params?: unknown;
}

// ── Initialize ───────────────────────────────────────────────────────

export interface InitializeParams {
  clientInfo: {
    name: string;
    version: string;
  };
  capabilities: Record<string, unknown>;
}

export interface InitializeResult {
  userAgent: string;
  codexHome: string;
  platformFamily: string;
  platformOs: string;
}

// ── Reasoning effort ─────────────────────────────────────────────────

export type ReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh";

export type ReasoningSummary = "none" | "auto" | "concise" | "detailed";

// ── Thread ───────────────────────────────────────────────────────────

export interface ThreadStartParams {
  model?: string;
  cwd?: string;
  approvalPolicy?: string;
  sandbox?: string;
  baseInstructions?: string;
  personality?: string;
  modelReasoningEffort?: ReasoningEffort;
  serviceTier?: string;
}

export interface ThreadInfo {
  id: string;
  preview?: string;
  ephemeral?: boolean;
  modelProvider?: string;
  createdAt?: number;
}

export interface ThreadStartResult {
  thread: ThreadInfo;
}

// ── Turn ─────────────────────────────────────────────────────────────

export interface UserInput {
  type: "text";
  text: string;
}

export interface TurnStartParams {
  threadId: string;
  input: UserInput[];
  /** Current Codex protocol field for reasoning effort overrides. */
  effort?: ReasoningEffort;
  /** Compatibility field accepted by older app-server builds. */
  modelReasoningEffort?: ReasoningEffort;
  summary?: ReasoningSummary;
  serviceTier?: string;
}

export interface TurnInterruptParams {
  threadId: string;
  turnId: string;
}

export interface TurnInfo {
  id: string;
  status: "inProgress" | "completed" | "interrupted" | "failed";
  items: ThreadItem[];
  error: TurnError | null;
}

export interface TurnError {
  message: string;
  codexErrorInfo?: { type: string };
  additionalDetails?: string;
}

export interface TurnStartResult {
  turn: TurnInfo;
}

// ── Thread Items ─────────────────────────────────────────────────────

export type ThreadItem =
  | AgentMessageItem
  | ReasoningItem
  | CommandExecutionItem
  | UserMessageItem
  | GenericItem;

export interface AgentMessageItem {
  type: "agentMessage";
  id: string;
  text: string;
  phase: string | null;
}

export interface ReasoningItem {
  type: "reasoning";
  id: string;
  summary?: unknown[] | string | null;
  content?: unknown[] | string | null;
  phase?: string | null;
}

export interface CommandExecutionItem {
  type: "commandExecution";
  id: string;
  command: string;
  cwd: string;
  aggregatedOutput: string | null;
  exitCode: number | null;
  status: string;
}

export interface UserMessageItem {
  type: "userMessage";
  id: string;
  content: UserInput[];
}

export interface GenericItem {
  type: string;
  id: string;
  [key: string]: unknown;
}

// ── Streaming notifications ──────────────────────────────────────────

export interface DeltaParams {
  threadId: string;
  turnId: string;
  itemId: string;
  delta: string;
}

export interface ItemStartedParams {
  item: ThreadItem;
  threadId: string;
  turnId: string;
}

export interface ItemCompletedParams {
  item: ThreadItem;
  threadId: string;
  turnId: string;
}

export interface TurnCompletedParams {
  threadId: string;
  turn: TurnInfo;
}

export interface TurnStartedParams {
  turn: TurnInfo;
}

export interface CommandOutputDeltaParams {
  threadId: string;
  turnId: string;
  itemId: string;
  delta: string;
}

export interface ToolProgressParams {
  threadId?: string;
  turnId?: string;
  itemId?: string;
  delta?: string;
  progress?: unknown;
  update?: unknown;
  message?: string;
}

export interface ReasoningDeltaParams {
  threadId: string;
  turnId: string;
  itemId: string;
  delta: string;
  summaryIndex?: number;
}

// ── Wire message union ───────────────────────────────────────────────

/**
 * Any message that can appear on the wire (parsed from a JSONL line).
 * Discriminated by the presence of `method` and/or `id`.
 */
export type WireMessage =
  | JsonRpcRequest
  | JsonRpcResponse
  | JsonRpcNotification;

/**
 * Helper to check if a wire message is a response (has `id`, no `method`).
 */
export function isResponse(msg: WireMessage): msg is JsonRpcResponse {
  return "id" in msg && !("method" in msg);
}

/**
 * Helper to check if a wire message is a notification (has `method`, no `id`).
 */
export function isNotification(msg: WireMessage): msg is JsonRpcNotification {
  return "method" in msg && !("id" in msg);
}
