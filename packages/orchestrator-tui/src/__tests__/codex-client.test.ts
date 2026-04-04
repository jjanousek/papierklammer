import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter, PassThrough } from "node:stream";
import { CodexClient } from "../codex/client.js";
import { ORCHESTRATOR_INSTRUCTIONS } from "../codex/base-instructions.js";
import type {
  InitializeResult,
  ThreadStartResult,
  TurnStartResult,
  DeltaParams,
  ItemStartedParams,
  ItemCompletedParams,
  TurnCompletedParams,
  CommandOutputDeltaParams,
} from "../codex/types.js";

// ── Test helpers ─────────────────────────────────────────────────────

/** Create a mock child process with writable stdin and readable stdout. */
function createMockProcess() {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const proc = new EventEmitter() as EventEmitter & {
    stdin: PassThrough;
    stdout: PassThrough;
    kill: ReturnType<typeof vi.fn>;
  };
  proc.stdin = stdin;
  proc.stdout = stdout;
  proc.kill = vi.fn();
  return proc;
}

/** Write a JSONL response to the mock process stdout. */
function respond(proc: ReturnType<typeof createMockProcess>, msg: unknown): void {
  proc.stdout.write(`${JSON.stringify(msg)}\n`);
}

/** Read the next request written to stdin and parse it. */
function readNextRequest(proc: ReturnType<typeof createMockProcess>): Promise<unknown> {
  return new Promise((resolve) => {
    const onData = (chunk: Buffer) => {
      const lines = chunk.toString().split("\n").filter(Boolean);
      for (const line of lines) {
        proc.stdin.off("data", onData);
        resolve(JSON.parse(line));
        return;
      }
    };
    proc.stdin.on("data", onData);
  });
}

/** Collect all messages written to stdin up to a timeout. */
function collectRequests(proc: ReturnType<typeof createMockProcess>, count: number, timeoutMs = 200): Promise<unknown[]> {
  return new Promise((resolve) => {
    const messages: unknown[] = [];
    const onData = (chunk: Buffer) => {
      const lines = chunk.toString().split("\n").filter(Boolean);
      for (const line of lines) {
        messages.push(JSON.parse(line));
        if (messages.length >= count) {
          proc.stdin.off("data", onData);
          resolve(messages);
          return;
        }
      }
    };
    proc.stdin.on("data", onData);
    setTimeout(() => {
      proc.stdin.off("data", onData);
      resolve(messages);
    }, timeoutMs);
  });
}

/** Small delay for async processing. */
const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms));

// ── Tests ────────────────────────────────────────────────────────────

describe("CodexClient", () => {
  let mockProc: ReturnType<typeof createMockProcess>;
  let spawnFn: ReturnType<typeof vi.fn>;
  let client: CodexClient;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockProc = createMockProcess();
    spawnFn = vi.fn().mockReturnValue(mockProc);
  });

  afterEach(() => {
    client?.destroy();
    vi.useRealTimers();
  });

  // ── Spawn ────────────────────────────────────────────────────────

  it("spawns codex app-server subprocess on construction", () => {
    client = new CodexClient({ spawnFn, autoReconnect: false });

    expect(spawnFn).toHaveBeenCalledWith("codex", [
      "app-server",
      "-c",
      "sandbox_workspace_write.network_access=true",
    ], {
      stdio: ["pipe", "pipe", "inherit"],
    });
  });

  // ── Initialize handshake ─────────────────────────────────────────

  it("sends initialize request and initialized notification", async () => {
    client = new CodexClient({ spawnFn, autoReconnect: false });

    // Start collecting messages (initialize request + initialized notification)
    const messagesPromise = collectRequests(mockProc, 2);

    const initPromise = client.initialize();

    // Wait for the initialize request to arrive
    await tick();

    // Send response to the initialize request
    respond(mockProc, {
      id: 0,
      result: {
        userAgent: "codex/0.117.0",
        codexHome: "/home/test/.codex",
        platformFamily: "unix",
        platformOs: "macos",
      } satisfies InitializeResult,
    });

    const result = await initPromise;
    expect(result.userAgent).toBe("codex/0.117.0");
    expect(result.platformOs).toBe("macos");

    // Verify the messages sent
    const messages = await messagesPromise;
    expect(messages).toHaveLength(2);

    // First: initialize request
    const initReq = messages[0] as { method: string; id: number; params: unknown };
    expect(initReq.method).toBe("initialize");
    expect(initReq.id).toBe(0);
    expect(initReq.params).toEqual({
      clientInfo: { name: "papierklammer-tui", version: "1.0.0" },
      capabilities: {},
    });

    // Second: initialized notification (no id)
    const initNotif = messages[1] as { method: string };
    expect(initNotif.method).toBe("initialized");
    expect("id" in initNotif).toBe(false);
  });

  it("throws on initialize error", async () => {
    client = new CodexClient({ spawnFn, autoReconnect: false });

    const initPromise = client.initialize();
    await tick();

    respond(mockProc, {
      id: 0,
      error: { code: -1, message: "Already initialized" },
    });

    await expect(initPromise).rejects.toThrow("Initialize failed: Already initialized");
  });

  it("coalesces reconnect with an in-flight initialize on the same subprocess", async () => {
    client = new CodexClient({ spawnFn, autoReconnect: false });

    const sentMessages: unknown[] = [];
    mockProc.stdin.on("data", (chunk: Buffer) => {
      const lines = chunk.toString().split("\n").filter(Boolean);
      for (const line of lines) {
        sentMessages.push(JSON.parse(line));
      }
    });

    const initPromise = client.initialize();
    const reconnectPromise = client.reconnect();
    await tick();

    expect(
      sentMessages.filter((msg: any) => msg.method === "initialize"),
    ).toHaveLength(1);

    respond(mockProc, {
      id: 0,
      result: {
        userAgent: "codex/0.117.0",
        codexHome: "/home/test/.codex",
        platformFamily: "unix",
        platformOs: "macos",
      } satisfies InitializeResult,
    });

    const [initResult, reconnectResult] = await Promise.all([
      initPromise,
      reconnectPromise,
    ]);

    expect(initResult).toEqual(reconnectResult);
    await tick();
    expect(
      sentMessages.filter((msg: any) => msg.method === "initialized"),
    ).toHaveLength(1);
  });

  // ── Thread start ─────────────────────────────────────────────────

  it("starts a thread and returns threadId", async () => {
    client = new CodexClient({ spawnFn, autoReconnect: false });

    // Initialize first
    const initP = client.initialize();
    await tick();
    respond(mockProc, { id: 0, result: { userAgent: "codex/0.117.0" } });
    await initP;

    // Start thread
    const threadPromise = client.startThread({ model: "gpt-5.4", cwd: "/tmp" });
    await tick();

    // Verify request
    const reqPromise = readNextRequest(mockProc);
    respond(mockProc, {
      id: 1,
      result: {
        thread: { id: "thr_abc123" },
      } satisfies ThreadStartResult,
    });

    const threadId = await threadPromise;
    expect(threadId).toBe("thr_abc123");
  });

  it("injects baseInstructions on thread start", async () => {
    client = new CodexClient({ spawnFn, autoReconnect: false });

    // Initialize
    const initP = client.initialize();
    await tick();
    respond(mockProc, { id: 0, result: { userAgent: "codex/0.117.0" } });
    await initP;

    // Drain any buffered messages from init
    await tick();

    // Now collect the thread/start request
    const allMsgs: unknown[] = [];
    const onData = (chunk: Buffer) => {
      const lines = chunk.toString().split("\n").filter(Boolean);
      for (const line of lines) {
        allMsgs.push(JSON.parse(line));
      }
    };
    mockProc.stdin.on("data", onData);

    const threadPromise = client.startThread({
      baseInstructions: "You are the Papierklammer orchestrator assistant.",
    });
    await tick();

    respond(mockProc, { id: 1, result: { thread: { id: "thr_xyz" } } });
    await threadPromise;

    mockProc.stdin.off("data", onData);

    // Find the thread/start message
    const req = allMsgs.find((m: any) => m.method === "thread/start") as { method: string; params: Record<string, unknown> };
    expect(req).toBeDefined();
    expect(req.method).toBe("thread/start");
    expect(req.params.baseInstructions).toBe("You are the Papierklammer orchestrator assistant.");
    expect(req.params.approvalPolicy).toBe("never");
    expect(req.params.sandbox).toBe("workspace-write");
  });

  // ── Turn start and delta streaming ───────────────────────────────

  it("starts a turn and streams deltas via callbacks", async () => {
    client = new CodexClient({ spawnFn, autoReconnect: false });

    const deltas: string[] = [];
    client.callbacks.onDelta = (params: DeltaParams) => {
      deltas.push(params.delta);
    };

    // Initialize
    const initP = client.initialize();
    await tick();
    respond(mockProc, { id: 0, result: { userAgent: "codex/0.117.0" } });
    await initP;

    // Start turn
    const turnPromise = client.startTurn("thr_abc", "What is blocked?");
    await tick();

    respond(mockProc, {
      id: 1,
      result: {
        turn: { id: "turn_1", status: "inProgress", items: [], error: null },
      } satisfies TurnStartResult,
    });

    const turnResult = await turnPromise;
    expect(turnResult.turn.id).toBe("turn_1");
    expect(turnResult.turn.status).toBe("inProgress");

    // Stream deltas
    respond(mockProc, {
      method: "item/agentMessage/delta",
      params: { threadId: "thr_abc", turnId: "turn_1", itemId: "item_1", delta: "Here's " },
    });
    await tick();

    respond(mockProc, {
      method: "item/agentMessage/delta",
      params: { threadId: "thr_abc", turnId: "turn_1", itemId: "item_1", delta: "a summary." },
    });
    await tick();

    expect(deltas).toEqual(["Here's ", "a summary."]);
  });

  // ── Turn completion ──────────────────────────────────────────────

  it("fires onTurnCompleted callback", async () => {
    client = new CodexClient({ spawnFn, autoReconnect: false });

    let completedTurn: TurnCompletedParams | null = null;
    client.callbacks.onTurnCompleted = (params) => {
      completedTurn = params;
    };

    // Initialize
    const initP = client.initialize();
    await tick();
    respond(mockProc, { id: 0, result: { userAgent: "codex/0.117.0" } });
    await initP;

    // Send turn/completed notification
    respond(mockProc, {
      method: "turn/completed",
      params: {
        threadId: "thr_abc",
        turn: {
          id: "turn_1",
          status: "completed",
          items: [{ type: "agentMessage", id: "item_1", text: "Done!", phase: null }],
          error: null,
        },
      },
    });
    await tick();

    expect(completedTurn).not.toBeNull();
    expect(completedTurn!.turn.status).toBe("completed");
    expect(completedTurn!.turn.items).toHaveLength(1);
  });

  // ── Multi-turn with same threadId ────────────────────────────────

  it("supports multi-turn on the same thread", async () => {
    client = new CodexClient({ spawnFn, autoReconnect: false });

    // Initialize
    const initP = client.initialize();
    await tick();
    respond(mockProc, { id: 0, result: { userAgent: "codex/0.117.0" } });
    await initP;

    // Drain init messages
    await tick();

    // Collect all requests going forward
    const allMsgs: unknown[] = [];
    const onData = (chunk: Buffer) => {
      const lines = chunk.toString().split("\n").filter(Boolean);
      for (const line of lines) {
        allMsgs.push(JSON.parse(line));
      }
    };
    mockProc.stdin.on("data", onData);

    // First turn
    const turn1Promise = client.startTurn("thr_abc", "First message");
    await tick();
    respond(mockProc, {
      id: 1,
      result: { turn: { id: "turn_1", status: "inProgress", items: [], error: null } },
    });
    await turn1Promise;

    // Turn completed
    respond(mockProc, {
      method: "turn/completed",
      params: { threadId: "thr_abc", turn: { id: "turn_1", status: "completed", items: [], error: null } },
    });
    await tick();

    // Second turn — same thread
    const turn2Promise = client.startTurn("thr_abc", "Second message");
    await tick();
    respond(mockProc, {
      id: 2,
      result: { turn: { id: "turn_2", status: "inProgress", items: [], error: null } },
    });
    await turn2Promise;

    mockProc.stdin.off("data", onData);

    // Filter to turn/start requests only
    const turnMsgs = allMsgs.filter((m: any) => m.method === "turn/start");
    expect(turnMsgs).toHaveLength(2);

    const req1 = turnMsgs[0] as { method: string; params: { threadId: string; input: unknown[] } };
    const req2 = turnMsgs[1] as { method: string; params: { threadId: string; input: unknown[] } };

    expect(req1.method).toBe("turn/start");
    expect(req1.params.threadId).toBe("thr_abc");
    expect(req1.params.input).toEqual([{ type: "text", text: "First message" }]);

    expect(req2.method).toBe("turn/start");
    expect(req2.params.threadId).toBe("thr_abc");
    expect(req2.params.input).toEqual([{ type: "text", text: "Second message" }]);
  });

  // ── Interrupt ────────────────────────────────────────────────────

  it("sends turn/interrupt request", async () => {
    client = new CodexClient({ spawnFn, autoReconnect: false });

    // Initialize
    const initP = client.initialize();
    await tick();
    respond(mockProc, { id: 0, result: { userAgent: "codex/0.117.0" } });
    await initP;

    // Drain init messages
    await tick();

    // Collect going forward
    const allMsgs: unknown[] = [];
    const onData = (chunk: Buffer) => {
      const lines = chunk.toString().split("\n").filter(Boolean);
      for (const line of lines) {
        allMsgs.push(JSON.parse(line));
      }
    };
    mockProc.stdin.on("data", onData);

    // Interrupt
    const interruptPromise = client.interrupt("thr_abc", "turn_1");
    await tick();
    respond(mockProc, { id: 1, result: {} });

    await interruptPromise;

    mockProc.stdin.off("data", onData);

    const req = allMsgs.find((m: any) => m.method === "turn/interrupt") as { method: string; params: { threadId: string; turnId: string } };
    expect(req).toBeDefined();
    expect(req.method).toBe("turn/interrupt");
    expect(req.params.threadId).toBe("thr_abc");
    expect(req.params.turnId).toBe("turn_1");
  });

  // ── Auto-reconnect on crash ──────────────────────────────────────

  it("auto-reconnects on subprocess exit", async () => {
    // Create two mock processes (one for initial, one for reconnect)
    const proc1 = createMockProcess();
    const proc2 = createMockProcess();
    let spawnCount = 0;
    const mockSpawn = vi.fn().mockImplementation(() => {
      spawnCount++;
      return spawnCount === 1 ? proc1 : proc2;
    });

    client = new CodexClient({
      spawnFn: mockSpawn,
      autoReconnect: true,
      reconnectDelayMs: 3000,
    });

    expect(mockSpawn).toHaveBeenCalledTimes(1);

    let disconnected = false;
    let reconnected = false;
    client.callbacks.onDisconnected = () => { disconnected = true; };
    client.callbacks.onConnected = () => { reconnected = true; };

    // Simulate subprocess crash
    proc1.emit("exit", 1, null);
    await tick();
    expect(disconnected).toBe(true);

    // Advance past reconnect delay
    vi.advanceTimersByTime(3000);
    await tick();

    expect(mockSpawn).toHaveBeenCalledTimes(2);

    // The client should attempt to initialize on the new process
    // Respond to the auto-initialize request on proc2
    respond(proc2, { id: 0, result: { userAgent: "codex/0.117.0" } });
    await tick(50);

    expect(reconnected).toBe(true);
  });

  it("does not auto-reconnect when destroyed", async () => {
    client = new CodexClient({
      spawnFn,
      autoReconnect: true,
      reconnectDelayMs: 3000,
    });

    client.destroy();

    // Simulate subprocess exit after destroy
    mockProc.emit("exit", 0, null);
    vi.advanceTimersByTime(5000);
    await tick();

    // Should only have been called once (initial spawn)
    expect(spawnFn).toHaveBeenCalledTimes(1);
  });

  it("does not auto-reconnect when autoReconnect is false", async () => {
    client = new CodexClient({
      spawnFn,
      autoReconnect: false,
    });

    // Simulate subprocess crash
    mockProc.emit("exit", 1, null);
    vi.advanceTimersByTime(5000);
    await tick();

    expect(spawnFn).toHaveBeenCalledTimes(1);
  });

  // ── Item events ──────────────────────────────────────────────────

  it("fires onItemStarted and onItemCompleted callbacks", async () => {
    client = new CodexClient({ spawnFn, autoReconnect: false });

    let started: ItemStartedParams | null = null;
    let completed: ItemCompletedParams | null = null;
    client.callbacks.onItemStarted = (params) => { started = params; };
    client.callbacks.onItemCompleted = (params) => { completed = params; };

    // Initialize
    const initP = client.initialize();
    await tick();
    respond(mockProc, { id: 0, result: { userAgent: "codex/0.117.0" } });
    await initP;

    // Item started
    respond(mockProc, {
      method: "item/started",
      params: {
        item: { type: "agentMessage", id: "item_1", text: "", phase: null },
        threadId: "thr_abc",
        turnId: "turn_1",
      },
    });
    await tick();

    expect(started).not.toBeNull();
    expect(started!.item.type).toBe("agentMessage");
    expect(started!.item.id).toBe("item_1");

    // Item completed
    respond(mockProc, {
      method: "item/completed",
      params: {
        item: { type: "agentMessage", id: "item_1", text: "Hello world", phase: null },
        threadId: "thr_abc",
        turnId: "turn_1",
      },
    });
    await tick();

    expect(completed).not.toBeNull();
    expect(completed!.item.type).toBe("agentMessage");
  });

  // ── Command output ───────────────────────────────────────────────

  it("fires onCommandOutput callback", async () => {
    client = new CodexClient({ spawnFn, autoReconnect: false });

    let output: CommandOutputDeltaParams | null = null;
    client.callbacks.onCommandOutput = (params) => { output = params; };

    // Initialize
    const initP = client.initialize();
    await tick();
    respond(mockProc, { id: 0, result: { userAgent: "codex/0.117.0" } });
    await initP;

    respond(mockProc, {
      method: "item/commandExecution/outputDelta",
      params: {
        threadId: "thr_abc",
        turnId: "turn_1",
        itemId: "cmd_1",
        delta: "npm test output...\n",
      },
    });
    await tick();

    expect(output).not.toBeNull();
    expect(output!.delta).toBe("npm test output...\n");
    expect(output!.itemId).toBe("cmd_1");
  });

  // ── Destroy ──────────────────────────────────────────────────────

  it("destroy sends SIGTERM to subprocess", () => {
    client = new CodexClient({ spawnFn, autoReconnect: false });

    client.destroy();
    expect(mockProc.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("rejects pending requests on destroy", async () => {
    client = new CodexClient({ spawnFn, autoReconnect: false });

    const promise = client.initialize();
    await tick();

    client.destroy();

    await expect(promise).rejects.toThrow("Codex subprocess exited");
  });

  // ── isConnected ──────────────────────────────────────────────────

  it("isConnected is false before initialize", () => {
    client = new CodexClient({ spawnFn, autoReconnect: false });
    expect(client.isConnected).toBe(false);
  });

  it("isConnected is true after initialize", async () => {
    client = new CodexClient({ spawnFn, autoReconnect: false });

    const initP = client.initialize();
    await tick();
    respond(mockProc, { id: 0, result: { userAgent: "codex/0.117.0" } });
    await initP;

    expect(client.isConnected).toBe(true);
  });

  // ── Malformed input handling ─────────────────────────────────────

  it("ignores malformed JSONL lines", async () => {
    client = new CodexClient({ spawnFn, autoReconnect: false });

    // Write garbage to stdout — should not throw
    mockProc.stdout.write("not valid json\n");
    await tick();

    // Client should still be functional
    const initP = client.initialize();
    await tick();
    respond(mockProc, { id: 0, result: { userAgent: "codex/0.117.0" } });
    await initP;

    expect(client.isConnected).toBe(true);
  });
});

// ── VAL-TUI-MGMT-001: BaseInstructions contain orchestrator tool descriptions ──

describe("ORCHESTRATOR_INSTRUCTIONS content (VAL-TUI-MGMT-001)", () => {
  it("contains all orchestrator management operation descriptions", () => {
    // Create issues
    expect(ORCHESTRATOR_INSTRUCTIONS).toContain("POST /api/orchestrator/issues");
    expect(ORCHESTRATOR_INSTRUCTIONS).toMatch(/create/i);

    // Unblock agents
    expect(ORCHESTRATOR_INSTRUCTIONS).toContain("POST /api/orchestrator/issues/:id/unblock");
    expect(ORCHESTRATOR_INSTRUCTIONS).toMatch(/unblock/i);

    // Nudge agents
    expect(ORCHESTRATOR_INSTRUCTIONS).toContain("POST /api/orchestrator/agents/:id/nudge");
    expect(ORCHESTRATOR_INSTRUCTIONS).toMatch(/nudge/i);

    // Change priorities
    expect(ORCHESTRATOR_INSTRUCTIONS).toContain("PATCH /api/orchestrator/issues/:id/priority");
    expect(ORCHESTRATOR_INSTRUCTIONS).toMatch(/priorit/i);

    // Cleanup stale runs
    expect(ORCHESTRATOR_INSTRUCTIONS).toContain("DELETE /api/orchestrator/stale/runs");
    expect(ORCHESTRATOR_INSTRUCTIONS).toMatch(/cleanup|stale/i);

    // Cleanup stale intents
    expect(ORCHESTRATOR_INSTRUCTIONS).toContain("DELETE /api/orchestrator/stale/intents");

    // View status
    expect(ORCHESTRATOR_INSTRUCTIONS).toContain("GET /api/orchestrator/status");
    expect(ORCHESTRATOR_INSTRUCTIONS).toMatch(/status/i);

    // View stale
    expect(ORCHESTRATOR_INSTRUCTIONS).toContain("GET /api/orchestrator/stale");

    // Authentication method
    expect(ORCHESTRATOR_INSTRUCTIONS).toContain("Bearer");
    expect(ORCHESTRATOR_INSTRUCTIONS).toMatch(/Authorization/i);
  });

  it("mentions the API URL and authentication", () => {
    expect(ORCHESTRATOR_INSTRUCTIONS).toContain("API");
    expect(ORCHESTRATOR_INSTRUCTIONS).toContain("Bearer");
  });
});
