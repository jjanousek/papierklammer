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
  WireMessage,
  ReasoningEffort,
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
  onConnected?: () => void;
  onDisconnected?: () => void;
}

type PendingRequest = {
  resolve: (value: JsonRpcResponse) => void;
  reject: (reason: Error) => void;
};

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
    this.proc = this.spawnFn("codex", ["app-server"], {
      stdio: ["pipe", "pipe", "inherit"],
    });

    if (!this.proc.stdout || !this.proc.stdin) {
      throw new Error("Failed to spawn codex app-server with stdio pipes");
    }

    this.rl = readline.createInterface({ input: this.proc.stdout });
    this.rl.on("line", (line: string) => this.handleLine(line));

    this.proc.on("exit", (code, signal) => {
      this.cleanup();
      this.callbacks.onDisconnected?.();

      if (!this.destroyed && this.autoReconnect) {
        this.reconnectTimer = setTimeout(() => {
          this.reconnectTimer = null;
          this.spawnProcess();
          // Re-initialize after reconnect
          void this.initialize().then(() => {
            this.callbacks.onConnected?.();
          }).catch(() => {
            // Will be handled by the next reconnect attempt
          });
        }, this.reconnectDelayMs);
      }
    });
  }

  private cleanup(): void {
    this.rl?.close();
    this.rl = null;
    this.initialized = false;

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
    const params: InitializeParams = {
      clientInfo: {
        name: "papierklammer-tui",
        version: "1.0.0",
      },
      capabilities: {},
    };

    const response = await this.sendRequest("initialize", params);

    if (response.error) {
      throw new Error(`Initialize failed: ${response.error.message}`);
    }

    this.sendNotification("initialized");
    this.initialized = true;

    return response.result as InitializeResult;
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
  async startTurn(threadId: string, text: string, overrides?: { modelReasoningEffort?: ReasoningEffort }): Promise<TurnStartResult> {
    const params: TurnStartParams = {
      threadId,
      input: [{ type: "text", text }],
      ...(overrides?.modelReasoningEffort ? { modelReasoningEffort: overrides.modelReasoningEffort } : {}),
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
      this.proc.kill("SIGTERM");
      this.proc = null;
    }

    this.cleanup();
  }

  /** Whether the client is initialized and connected. */
  get isConnected(): boolean {
    return this.initialized && this.proc !== null;
  }
}
