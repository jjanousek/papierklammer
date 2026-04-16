import { spawn, type ChildProcess } from "node:child_process";
import readline from "node:readline";
import type {
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcNotification,
  InitializeParams,
  InitializeResult,
  ThreadStartParams,
  ThreadStartResult,
  TurnStartParams,
  TurnStartResult,
  TurnInterruptParams,
  DeltaParams,
  ItemStartedParams,
  ItemCompletedParams,
  TurnCompletedParams,
  CommandOutputDeltaParams,
  ReasoningDeltaParams,
  WireMessage,
  ReasoningEffort,
  ReasoningSummary,
} from "./types.js";
import { isResponse, isNotification } from "./types.js";

/** Options passed to CodexClient constructor. */
export interface CodexClientOptions {
  /** Override spawn for testing. Defaults to child_process.spawn. */
  spawnFn?: typeof spawn;
  /** Auto-reconnect on subprocess crash. Defaults to true. */
  autoReconnect?: boolean;
  /** Reconnect delay in ms. Defaults to 3000. */
  reconnectDelayMs?: number;
}

/** Callbacks for streaming events. */
export interface CodexCallbacks {
  onDelta?: (params: DeltaParams) => void;
  onItemStarted?: (params: ItemStartedParams) => void;
  onItemCompleted?: (params: ItemCompletedParams) => void;
  onTurnCompleted?: (params: TurnCompletedParams) => void;
  onCommandOutput?: (params: CommandOutputDeltaParams) => void;
  onReasoningDelta?: (params: ReasoningDeltaParams) => void;
  onConnected?: () => void;
  onDisconnected?: () => void;
  onError?: (error: Error) => void;
}

type PendingRequest = {
  resolve: (value: JsonRpcResponse) => void;
  reject: (reason: Error) => void;
};

const CODEX_APP_SERVER_ARGS = [
  "app-server",
  "-c",
  "sandbox_workspace_write.network_access=true",
] as const;

/**
 * Client for the Codex app-server JSON-RPC protocol over stdio.
 *
 * Spawns `codex app-server` as a subprocess, communicates via JSONL
 * (one JSON message per line) on stdin/stdout.
 */
export class CodexClient {
  private proc: ChildProcess | null = null;
  private rl: readline.Interface | null = null;
  private nextId = 0;
  private pending = new Map<number, PendingRequest>();
  private destroyed = false;
  private initialized = false;
  private initializePromise: Promise<InitializeResult> | null = null;
  private initializeResult: InitializeResult | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly spawnFn: typeof spawn;
  private readonly autoReconnect: boolean;
  private readonly reconnectDelayMs: number;

  public callbacks: CodexCallbacks = {};

  constructor(opts: CodexClientOptions = {}) {
    this.spawnFn = opts.spawnFn ?? spawn;
    this.autoReconnect = opts.autoReconnect ?? true;
    this.reconnectDelayMs = opts.reconnectDelayMs ?? 3000;
    this.spawnProcess();
  }

  // ── Process management ─────────────────────────────────────────────

  private spawnProcess(): void {
    let proc: ChildProcess;
    try {
      proc = this.spawnFn("codex", [...CODEX_APP_SERVER_ARGS], {
        stdio: ["pipe", "pipe", "inherit"],
      });
    } catch (error) {
      queueMicrotask(() => {
        this.handleProcessFailure(error);
      });
      return;
    }

    this.proc = proc;

    if (!proc.stdout || !proc.stdin) {
      queueMicrotask(() => {
        if (this.proc === proc) {
          this.handleProcessFailure(
            new Error("Failed to spawn codex app-server with stdio pipes"),
          );
        }
      });
      return;
    }

    this.rl = readline.createInterface({ input: proc.stdout });
    this.rl.on("line", (line: string) => this.handleLine(line));

    proc.on("error", (error) => {
      if (this.proc !== proc) return;
      this.handleProcessFailure(error);
    });

    proc.on("exit", () => {
      if (this.proc !== proc) return;
      this.handleProcessFailure();
    });
  }

  private normalizeError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error));
  }

  private shouldAutoReconnect(error?: Error): boolean {
    const errnoLike = error as NodeJS.ErrnoException | undefined;
    return errnoLike?.code !== "ENOENT";
  }

  private scheduleReconnect(): void {
    if (this.destroyed || !this.autoReconnect || this.reconnectTimer) {
      return;
    }

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.spawnProcess();
      // Re-initialize after reconnect
      void this.initialize().then(() => {
        this.callbacks.onConnected?.();
      }).catch(() => {
        // Process failures will surface via error/exit listeners and schedule
        // subsequent retries when appropriate.
      });
    }, this.reconnectDelayMs);
  }

  private handleProcessFailure(error?: unknown): void {
    const normalizedError = error == null ? undefined : this.normalizeError(error);
    this.cleanup();
    this.proc = null;

    if (normalizedError) {
      this.callbacks.onError?.(normalizedError);
    }
    this.callbacks.onDisconnected?.();

    if (!normalizedError || this.shouldAutoReconnect(normalizedError)) {
      this.scheduleReconnect();
    }
  }

  private cleanup(): void {
    this.rl?.close();
    this.rl = null;
    this.initialized = false;
    this.initializePromise = null;
    this.initializeResult = null;

    // Reject all pending requests
    for (const [, pending] of this.pending) {
      pending.reject(new Error("Codex subprocess exited"));
    }
    this.pending.clear();
  }

  // ── Wire protocol ──────────────────────────────────────────────────

  private send(msg: JsonRpcRequest | JsonRpcNotification): void {
    if (!this.proc?.stdin?.writable) {
      throw new Error("Codex subprocess stdin is not writable");
    }
    this.proc.stdin.write(`${JSON.stringify(msg)}\n`);
  }

  private sendRequest(method: string, params?: unknown): Promise<JsonRpcResponse> {
    const id = this.nextId++;
    const msg: JsonRpcRequest = { method, id, params };

    return new Promise<JsonRpcResponse>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try {
        this.send(msg);
      } catch (err) {
        this.pending.delete(id);
        reject(err);
      }
    });
  }

  private sendNotification(method: string, params?: unknown): void {
    const msg: JsonRpcNotification = { method, params };
    this.send(msg);
  }

  private handleLine(line: string): void {
    let msg: WireMessage;
    try {
      msg = JSON.parse(line) as WireMessage;
    } catch {
      // Skip malformed lines (e.g. debug logs)
      return;
    }

    if (isResponse(msg)) {
      const pending = this.pending.get(msg.id);
      if (pending) {
        this.pending.delete(msg.id);
        pending.resolve(msg);
      }
      return;
    }

    if (isNotification(msg)) {
      this.routeNotification(msg);
    }
  }

  private routeNotification(msg: JsonRpcNotification): void {
    switch (msg.method) {
      case "item/agentMessage/delta":
        this.callbacks.onDelta?.(msg.params as DeltaParams);
        break;
      case "item/started":
        this.callbacks.onItemStarted?.(msg.params as ItemStartedParams);
        break;
      case "item/completed":
        this.callbacks.onItemCompleted?.(msg.params as ItemCompletedParams);
        break;
      case "turn/completed":
        this.callbacks.onTurnCompleted?.(msg.params as TurnCompletedParams);
        break;
      case "item/commandExecution/outputDelta":
        this.callbacks.onCommandOutput?.(msg.params as CommandOutputDeltaParams);
        break;
      case "item/reasoning/textDelta":
      case "item/reasoning/summaryTextDelta":
        this.callbacks.onReasoningDelta?.(msg.params as ReasoningDeltaParams);
        break;
      // Other notifications are silently ignored
    }
  }

  // ── Public API ─────────────────────────────────────────────────────

  /**
   * Perform the initialize handshake:
   * 1. Send `initialize` request with client info
   * 2. Wait for response
   * 3. Send `initialized` notification
   */
  async initialize(): Promise<InitializeResult> {
    if (this.destroyed) {
      throw new Error("Codex client has been destroyed");
    }

    if (this.initialized && this.proc && this.initializeResult) {
      return this.initializeResult;
    }

    if (this.initializePromise) {
      return this.initializePromise;
    }

    const params: InitializeParams = {
      clientInfo: {
        name: "papierklammer-tui",
        version: "1.0.0",
      },
      capabilities: {},
    };

    const initializePromise = this.sendRequest("initialize", params)
      .then((response) => {
        if (response.error) {
          throw new Error(`Initialize failed: ${response.error.message}`);
        }

        const result = response.result as InitializeResult;
        this.sendNotification("initialized");
        this.initialized = true;
        this.initializeResult = result;

        return result;
      })
      .finally(() => {
        if (this.initializePromise === initializePromise) {
          this.initializePromise = null;
        }
      });

    this.initializePromise = initializePromise;
    return initializePromise;
  }

  /**
   * Ensure the client has a live subprocess and completed initialize handshake.
   */
  async reconnect(): Promise<InitializeResult> {
    if (this.destroyed) {
      throw new Error("Codex client has been destroyed");
    }

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (!this.proc) {
      this.spawnProcess();
    }

    if (this.initialized && this.proc && this.initializeResult) {
      return this.initializeResult;
    }

    return this.initialize();
  }

  /**
   * Start a new thread/conversation.
   * Returns the thread ID.
   */
  async startThread(opts: ThreadStartParams = {}): Promise<string> {
    const response = await this.sendRequest("thread/start", {
      approvalPolicy: "never",
      sandbox: "workspace-write",
      ...opts,
    });

    if (response.error) {
      throw new Error(`thread/start failed: ${response.error.message}`);
    }

    const result = response.result as ThreadStartResult;
    return result.thread.id;
  }

  /**
   * Start a turn in an existing thread (send user message).
   * Returns the turn info from the response.
   */
  async startTurn(
    threadId: string,
    text: string,
    overrides?: {
      modelReasoningEffort?: ReasoningEffort;
      summary?: ReasoningSummary;
      serviceTier?: string;
    },
  ): Promise<TurnStartResult> {
    const params: TurnStartParams = {
      threadId,
      input: [{ type: "text", text }],
      ...(overrides?.modelReasoningEffort ? { effort: overrides.modelReasoningEffort } : {}),
      ...(overrides?.modelReasoningEffort ? { modelReasoningEffort: overrides.modelReasoningEffort } : {}),
      ...(overrides?.summary ? { summary: overrides.summary } : {}),
      ...(overrides?.serviceTier ? { serviceTier: overrides.serviceTier } : {}),
    };

    const response = await this.sendRequest("turn/start", params);

    if (response.error) {
      throw new Error(`turn/start failed: ${response.error.message}`);
    }

    return response.result as TurnStartResult;
  }

  /**
   * Interrupt an in-flight turn.
   */
  async interrupt(threadId: string, turnId: string): Promise<void> {
    const params: TurnInterruptParams = { threadId, turnId };
    const response = await this.sendRequest("turn/interrupt", params);

    if (response.error) {
      throw new Error(`turn/interrupt failed: ${response.error.message}`);
    }
  }

  /**
   * Destroy the client: kill subprocess, clean up timers.
   */
  destroy(): void {
    this.destroyed = true;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.proc) {
      const proc = this.proc;
      this.proc = null;
      proc.kill("SIGTERM");
      this.proc = null;
    }

    this.cleanup();
  }

  /** Whether the client is initialized and connected. */
  get isConnected(): boolean {
    return this.initialized && this.proc !== null;
  }
}
