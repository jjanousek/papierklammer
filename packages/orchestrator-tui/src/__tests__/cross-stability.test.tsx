import React from "react";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render } from "ink-testing-library";
import { EventEmitter, PassThrough } from "node:stream";
import { App } from "../components/App.js";
import type { AgentOverview } from "../hooks/useOrchestratorStatus.js";

// Mock ink-spinner to render a deterministic marker instead of animated frames
vi.mock("ink-spinner", () => ({
  default: () => React.createElement("ink-text", null, "SPINNER"),
}));

// Suppress alternate screen buffer escape codes during tests
beforeEach(() => {
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

const tick = (ms = 50) => new Promise((r) => setTimeout(r, ms));

const MOCK_AGENTS: AgentOverview[] = [
  { agentId: "a1", name: "CEO", status: "idle", activeRunCount: 0, queuedIntentCount: 0 },
];

function createMockFetch() {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      agents: MOCK_AGENTS,
      totalActiveRuns: 0,
      totalQueuedIntents: 0,
      totalActiveLeases: 0,
    }),
  });
}

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

function respond(proc: ReturnType<typeof createMockProcess>, msg: unknown): void {
  proc.stdout.write(`${JSON.stringify(msg)}\n`);
}

/** Helper: initialize codex, tab to input */
async function setupApp() {
  const mockProc = createMockProcess();
  const mockSpawn = vi.fn().mockReturnValue(mockProc);
  const mockFetch = createMockFetch();

  const sentMessages: unknown[] = [];
  mockProc.stdin.on("data", (chunk: Buffer) => {
    const lines = chunk.toString().split("\n").filter(Boolean);
    for (const line of lines) {
      sentMessages.push(JSON.parse(line));
    }
  });

  const result = render(
    <App
      url="http://localhost:3100"
      apiKey="test-key"
      companyId="test-company"
      fetchFn={mockFetch}
      pollInterval={60000}
      spawnFn={mockSpawn}
      enableCodex={true}
    />,
  );

  await tick();

  // Initialize Codex
  respond(mockProc, { id: 0, result: { userAgent: "codex/0.117.0" } });
  await tick();

  // Tab to input
  result.stdin.write("\t");
  await tick();
  result.stdin.write("\t");
  await tick();

  return { ...result, mockProc, sentMessages };
}

/** Simulate terminal resize on ink-testing-library stdout */
function resizeTerminal(
  stdout: NodeJS.WriteStream | EventEmitter,
  newRows: number,
  newColumns?: number,
): void {
  const stream = stdout as unknown as EventEmitter & {
    rows?: number;
    columns?: number;
  };
  Object.defineProperty(stream, "rows", {
    value: newRows,
    writable: true,
    configurable: true,
  });
  if (newColumns !== undefined) {
    Object.defineProperty(stream, "columns", {
      value: newColumns,
      writable: true,
      configurable: true,
    });
  }
  stream.emit("resize");
}

// ── VAL-TUI-CROSS-001: Resize during thinking doesn't break layout ──

describe("VAL-TUI-CROSS-001: Resize during thinking doesn't break layout", () => {
  it("resize while isThinking=true recalculates layout and spinner continues", async () => {
    const { stdin, lastFrame, unmount, mockProc, stdout } = await setupApp();

    // Send a message to enter thinking state
    stdin.write("Hello");
    await tick();
    stdin.write("\r");
    await tick(100);

    // Verify thinking state with spinner
    let frame = lastFrame()!;
    expect(frame).toContain("You:");
    expect(frame).toContain("Hello");
    expect(frame).toContain("SPINNER");
    expect(frame).toContain("thinking...");

    // Record initial layout dimensions
    const initialLines = frame.split("\n").length;

    // Simulate terminal resize while thinking
    resizeTerminal(stdout as unknown as EventEmitter, 30);
    await tick();

    // After resize: layout should have recalculated
    frame = lastFrame()!;
    const resizedLines = frame.split("\n").length;

    // Layout adapts: more rows available → more lines rendered
    expect(resizedLines).toBeGreaterThanOrEqual(initialLines);

    // Spinner should still be active (thinking state preserved)
    expect(frame).toContain("SPINNER");
    expect(frame).toContain("thinking...");

    // All layout regions still present
    expect(frame).toContain("Papierklammer");
    expect(frame).toContain("Codex:");

    // User message still visible
    expect(frame).toContain("Hello");

    unmount();
  });

  it("response completes normally after resize during thinking", async () => {
    const { stdin, lastFrame, unmount, mockProc, stdout } = await setupApp();

    // Send a message
    stdin.write("Test resize");
    await tick();
    stdin.write("\r");
    await tick(100);

    // Verify thinking state
    let frame = lastFrame()!;
    expect(frame).toContain("SPINNER");
    expect(frame).toContain("thinking...");

    // Resize terminal while thinking
    resizeTerminal(stdout as unknown as EventEmitter, 35, 120);
    await tick();

    // Spinner should still be active
    frame = lastFrame()!;
    expect(frame).toContain("SPINNER");

    // Now complete the Codex response cycle
    respond(mockProc, { id: 1, result: { thread: { id: "thr_resize" } } });
    await tick();
    respond(mockProc, {
      id: 2,
      result: { turn: { id: "turn_1", status: "inProgress", items: [], error: null } },
    });
    await tick();

    // Stream a response delta
    respond(mockProc, {
      method: "item/agentMessage/delta",
      params: {
        threadId: "thr_resize",
        turnId: "turn_1",
        itemId: "item_1",
        delta: "Response after resize",
      },
    });
    await tick();

    frame = lastFrame()!;
    // Streaming text should appear
    expect(frame).toContain("Response after resize");
    // Chat thinking spinner should be gone (streaming has started)
    // Note: InputBar still shows SPINNER for "Waiting for response..." while disabled,
    // but the "thinking..." indicator in the message area should be gone.
    expect(frame).not.toContain("thinking...");
    // Streaming cursor should be visible
    expect(frame).toContain("▌");

    // Complete the turn
    respond(mockProc, {
      method: "turn/completed",
      params: {
        threadId: "thr_resize",
        turn: { id: "turn_1", status: "completed", items: [], error: null },
      },
    });
    await tick();

    frame = lastFrame()!;
    // Finalized message should be present
    expect(frame).toContain("Orchestrator:");
    expect(frame).toContain("Response after resize");
    // No more streaming cursor or spinner
    expect(frame).not.toContain("▌");
    expect(frame).not.toContain("SPINNER");
    expect(frame).not.toContain("thinking...");

    unmount();
  });

  it("full flow: send → resize mid-stream → complete → send another", async () => {
    const { stdin, lastFrame, unmount, mockProc, sentMessages, stdout } =
      await setupApp();

    // === Message 1: send and enter thinking ===
    stdin.write("First message");
    await tick();
    stdin.write("\r");
    await tick(100);

    let frame = lastFrame()!;
    expect(frame).toContain("First message");
    expect(frame).toContain("SPINNER");

    // Respond to thread/start
    respond(mockProc, { id: 1, result: { thread: { id: "thr_full" } } });
    await tick();
    // Respond to turn/start
    respond(mockProc, {
      id: 2,
      result: { turn: { id: "turn_1", status: "inProgress", items: [], error: null } },
    });
    await tick();

    // Start streaming
    respond(mockProc, {
      method: "item/agentMessage/delta",
      params: {
        threadId: "thr_full",
        turnId: "turn_1",
        itemId: "item_1",
        delta: "Streaming partial",
      },
    });
    await tick();

    frame = lastFrame()!;
    expect(frame).toContain("Streaming partial");

    // === Resize terminal mid-stream ===
    resizeTerminal(stdout as unknown as EventEmitter, 40, 100);
    await tick();

    // Layout should recalculate, streaming text still present
    frame = lastFrame()!;
    expect(frame).toContain("Streaming partial");
    expect(frame).toContain("Papierklammer");
    expect(frame).toContain("Codex:");

    // Continue streaming after resize
    respond(mockProc, {
      method: "item/agentMessage/delta",
      params: {
        threadId: "thr_full",
        turnId: "turn_1",
        itemId: "item_1",
        delta: " and more text",
      },
    });
    await tick();

    frame = lastFrame()!;
    expect(frame).toContain("Streaming partial and more text");

    // Complete the turn
    respond(mockProc, {
      method: "turn/completed",
      params: {
        threadId: "thr_full",
        turn: { id: "turn_1", status: "completed", items: [], error: null },
      },
    });
    await tick();

    frame = lastFrame()!;
    expect(frame).toContain("Orchestrator:");
    expect(frame).toContain("Streaming partial and more text");
    expect(frame).not.toContain("thinking...");
    expect(frame).not.toContain("SPINNER");

    // === Message 2: send another after resize + completion ===
    stdin.write("Second message");
    await tick();
    stdin.write("\r");
    await tick(100);

    frame = lastFrame()!;
    expect(frame).toContain("Second message");
    expect(frame).toContain("SPINNER");
    expect(frame).toContain("thinking...");

    // Respond to turn/start (same thread, no new thread/start)
    respond(mockProc, {
      id: 3,
      result: { turn: { id: "turn_2", status: "inProgress", items: [], error: null } },
    });
    await tick();

    // Stream second response
    respond(mockProc, {
      method: "item/agentMessage/delta",
      params: {
        threadId: "thr_full",
        turnId: "turn_2",
        itemId: "item_2",
        delta: "Second reply",
      },
    });
    await tick();

    frame = lastFrame()!;
    expect(frame).toContain("Second reply");

    // Complete second turn
    respond(mockProc, {
      method: "turn/completed",
      params: {
        threadId: "thr_full",
        turn: { id: "turn_2", status: "completed", items: [], error: null },
      },
    });
    await tick();

    frame = lastFrame()!;
    expect(frame).toContain("First message");
    expect(frame).toContain("Streaming partial and more text");
    expect(frame).toContain("Second message");
    expect(frame).toContain("Second reply");
    expect(frame).not.toContain("thinking...");
    expect(frame).not.toContain("SPINNER");

    // Verify wire: 1 thread/start, 2 turn/starts with same threadId
    const threadStarts = sentMessages.filter(
      (m: any) => m.method === "thread/start",
    );
    const turnStarts = sentMessages.filter(
      (m: any) => m.method === "turn/start",
    );
    expect(threadStarts).toHaveLength(1);
    expect(turnStarts).toHaveLength(2);
    for (const ts of turnStarts) {
      expect((ts as any).params.threadId).toBe("thr_full");
    }

    unmount();
  });

  it("multiple resizes during thinking do not corrupt layout", async () => {
    const { stdin, lastFrame, unmount, mockProc, stdout } = await setupApp();

    // Send message to enter thinking
    stdin.write("Resize stress");
    await tick();
    stdin.write("\r");
    await tick(100);

    let frame = lastFrame()!;
    expect(frame).toContain("SPINNER");

    // Rapid fire resizes
    resizeTerminal(stdout as unknown as EventEmitter, 20);
    await tick(10);
    resizeTerminal(stdout as unknown as EventEmitter, 50);
    await tick(10);
    resizeTerminal(stdout as unknown as EventEmitter, 15);
    await tick(10);
    resizeTerminal(stdout as unknown as EventEmitter, 30);
    await tick();

    // Layout should settle to the latest resize (30 rows)
    frame = lastFrame()!;
    // All layout regions still present
    expect(frame).toContain("Papierklammer");
    expect(frame).toContain("Codex:");
    // Spinner still active
    expect(frame).toContain("SPINNER");
    expect(frame).toContain("thinking...");
    // User message still visible
    expect(frame).toContain("Resize stress");

    // Response still completes
    respond(mockProc, { id: 1, result: { thread: { id: "thr_stress" } } });
    await tick();
    respond(mockProc, {
      id: 2,
      result: { turn: { id: "turn_1", status: "inProgress", items: [], error: null } },
    });
    await tick();
    respond(mockProc, {
      method: "item/agentMessage/delta",
      params: {
        threadId: "thr_stress",
        turnId: "turn_1",
        itemId: "item_1",
        delta: "Still works",
      },
    });
    await tick();
    respond(mockProc, {
      method: "turn/completed",
      params: {
        threadId: "thr_stress",
        turn: { id: "turn_1", status: "completed", items: [], error: null },
      },
    });
    await tick();

    frame = lastFrame()!;
    expect(frame).toContain("Still works");
    expect(frame).not.toContain("SPINNER");
    expect(frame).not.toContain("thinking...");

    unmount();
  });

  it("resize to very small terminal during thinking still renders without crash", async () => {
    const { stdin, lastFrame, unmount, mockProc, stdout } = await setupApp();

    // Enter thinking state
    stdin.write("Small resize");
    await tick();
    stdin.write("\r");
    await tick(100);

    let frame = lastFrame()!;
    expect(frame).toContain("SPINNER");

    // Resize to very small terminal (edge case)
    resizeTerminal(stdout as unknown as EventEmitter, 6, 40);
    await tick();

    // Should not crash — layout should still render
    frame = lastFrame()!;
    // At minimum the app should still render (not throw/crash)
    expect(frame).toBeDefined();
    expect(frame.length).toBeGreaterThan(0);

    // Complete the response
    respond(mockProc, { id: 1, result: { thread: { id: "thr_small" } } });
    await tick();
    respond(mockProc, {
      id: 2,
      result: { turn: { id: "turn_1", status: "inProgress", items: [], error: null } },
    });
    await tick();
    respond(mockProc, {
      method: "item/agentMessage/delta",
      params: {
        threadId: "thr_small",
        turnId: "turn_1",
        itemId: "item_1",
        delta: "OK",
      },
    });
    await tick();
    respond(mockProc, {
      method: "turn/completed",
      params: {
        threadId: "thr_small",
        turn: { id: "turn_1", status: "completed", items: [], error: null },
      },
    });
    await tick();

    frame = lastFrame()!;
    expect(frame).toBeDefined();

    unmount();
  });
});
