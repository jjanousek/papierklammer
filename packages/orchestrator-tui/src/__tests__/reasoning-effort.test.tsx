import React from "react";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render } from "ink-testing-library";
import { EventEmitter, PassThrough } from "node:stream";
import { App } from "../components/App.js";
import type { AgentOverview } from "../hooks/useOrchestratorStatus.js";

// Suppress alternate screen buffer escape codes during tests
beforeEach(() => {
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

const tick = (ms = 50) => new Promise((r) => setTimeout(r, ms));

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

const MOCK_AGENTS: AgentOverview[] = [
  { agentId: "a1", name: "CEO", status: "idle", activeRunCount: 0, queuedIntentCount: 0 },
];

function createMockFetch(agents: AgentOverview[] = MOCK_AGENTS) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      agents,
      totalActiveRuns: agents.reduce((s, a) => s + a.activeRunCount, 0),
      totalQueuedIntents: 0,
      totalActiveLeases: 0,
    }),
  });
}

// ── VAL-TUI-CTRL-001: Reasoning effort in Codex protocol ───────────

describe("VAL-TUI-CTRL-001: Reasoning effort in Codex protocol", () => {
  it("ThreadStartParams type includes modelReasoningEffort field", async () => {
    // This is a compile-time check — if the type doesn't have the field,
    // this file won't compile. We verify it's passed on the wire below.
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

    const { stdin, unmount } = render(
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

    // Initialize
    respond(mockProc, { id: 0, result: { userAgent: "codex/0.117.0" } });
    await tick();

    // Send a message — default reasoning effort is "high"
    stdin.write("Hello");
    await tick();
    stdin.write("\r");
    await tick(100);

    // Respond to thread/start
    respond(mockProc, { id: 1, result: { thread: { id: "thr_reason" } } });
    await tick();

    // Find thread/start message on the wire
    const threadStart = sentMessages.find(
      (m: any) => m.method === "thread/start",
    ) as { method: string; params: Record<string, unknown> } | undefined;

    expect(threadStart).toBeDefined();
    expect(threadStart!.params.modelReasoningEffort).toBe("high");

    unmount();
  });

  it("turn/start call includes modelReasoningEffort param", async () => {
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

    const { stdin, unmount } = render(
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

    // Initialize
    respond(mockProc, { id: 0, result: { userAgent: "codex/0.117.0" } });
    await tick();

    // Send a message
    stdin.write("Hello");
    await tick();
    stdin.write("\r");
    await tick(100);

    // Respond to thread/start
    respond(mockProc, { id: 1, result: { thread: { id: "thr_turn" } } });
    await tick();

    // Respond to turn/start
    respond(mockProc, {
      id: 2,
      result: { turn: { id: "turn_1", status: "inProgress", items: [], error: null } },
    });
    await tick();

    // Find turn/start message on the wire
    const turnStart = sentMessages.find(
      (m: any) => m.method === "turn/start",
    ) as { method: string; params: Record<string, unknown> } | undefined;

    expect(turnStart).toBeDefined();
    expect(turnStart!.params.modelReasoningEffort).toBe("high");
    expect(turnStart!.params.effort).toBe("high");
    expect(turnStart!.params.summary).toBe("detailed");

    unmount();
  });
});

// ── VAL-TUI-CTRL-002: Reasoning effort keyboard toggle ─────────────

describe("VAL-TUI-CTRL-002: Reasoning effort keyboard toggle", () => {
  it("pressing 'r' cycles reasoning effort through low → medium → high → low", async () => {
    const mockFetch = createMockFetch();

    const { stdin, lastFrame, unmount } = render(
      <App
        url="http://localhost:3100"
        apiKey="test-key"
        companyId="test-company"
        fetchFn={mockFetch}
        pollInterval={60000}
      />,
    );

    await tick();

    // Default is "high"
    let frame = lastFrame()!;
    expect(frame).toContain("reasoning: high");

    // Switch focus to sidebar so 'r' is not captured by input
    stdin.write("\t");
    await tick();

    // Press 'r' to cycle: high → low
    stdin.write("r");
    await tick();

    frame = lastFrame()!;
    expect(frame).toContain("reasoning: low");

    // Press 'r' again: low → medium
    stdin.write("r");
    await tick();

    frame = lastFrame()!;
    expect(frame).toContain("reasoning: medium");

    // Press 'r' again: medium → high
    stdin.write("r");
    await tick();

    frame = lastFrame()!;
    expect(frame).toContain("reasoning: high");

    // Press 'r' again: high → low (full cycle)
    stdin.write("r");
    await tick();

    frame = lastFrame()!;
    expect(frame).toContain("reasoning: low");

    unmount();
  });

  it("StatusBar shows current reasoning level", async () => {
    const mockFetch = createMockFetch();

    const { lastFrame, unmount } = render(
      <App
        url="http://localhost:3100"
        apiKey="test-key"
        companyId="test-company"
        fetchFn={mockFetch}
        pollInterval={60000}
      />,
    );

    await tick();

    const frame = lastFrame()!;
    expect(frame).toContain("reasoning: high");

    unmount();
  });

  it("'r' does not cycle when input is focused", async () => {
    const mockFetch = createMockFetch();

    const { stdin, lastFrame, unmount } = render(
      <App
        url="http://localhost:3100"
        apiKey="test-key"
        companyId="test-company"
        fetchFn={mockFetch}
        pollInterval={60000}
      />,
    );

    await tick();

    // Default is "high"
    let frame = lastFrame()!;
    expect(frame).toContain("reasoning: high");

    // Focus input by tabbing to it (Tab toggles sidebar↔input; default is input)
    // The default focus is "input", so pressing 'r' while typing should type 'r' not cycle
    // Let's focus sidebar first, then back to input
    stdin.write("\t"); // sidebar
    await tick();
    stdin.write("\t"); // input
    await tick();

    // Now typing 'r' in the input should NOT cycle reasoning effort
    stdin.write("r");
    await tick();

    frame = lastFrame()!;
    // Should still say "high" because input was focused
    expect(frame).toContain("reasoning: high");

    unmount();
  });
});

// ── VAL-TUI-CTRL-003: Reasoning effort applies to next turn ────────

describe("VAL-TUI-CTRL-003: Reasoning effort applies to next turn", () => {
  it("changed reasoning effort is used in the next turn/start call", async () => {
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

    const { stdin, unmount } = render(
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

    // Initialize
    respond(mockProc, { id: 0, result: { userAgent: "codex/0.117.0" } });
    await tick();

    // Send first message — default "high"
    stdin.write("First message");
    await tick();
    stdin.write("\r");
    await tick(100);

    // Respond to thread/start
    respond(mockProc, { id: 1, result: { thread: { id: "thr_effort" } } });
    await tick();

    // Respond to turn/start
    respond(mockProc, {
      id: 2,
      result: { turn: { id: "turn_1", status: "inProgress", items: [], error: null } },
    });
    await tick();

    // Complete the turn
    respond(mockProc, {
      method: "turn/completed",
      params: { threadId: "thr_effort", turn: { id: "turn_1", status: "completed", items: [], error: null } },
    });
    await tick();

    // Switch focus to sidebar so 'r' shortcut is not captured by input
    stdin.write("\t");
    await tick();

    // Change reasoning effort to "low" (high → low)
    stdin.write("r");
    await tick();

    // Switch back to input
    stdin.write("\t");
    await tick();

    // Send second message — now should be "low"
    stdin.write("Second message");
    await tick();
    stdin.write("\r");
    await tick(100);

    // Respond to turn/start (no thread/start — same thread)
    respond(mockProc, {
      id: 3,
      result: { turn: { id: "turn_2", status: "inProgress", items: [], error: null } },
    });
    await tick();

    // Check wire messages
    const turnStarts = sentMessages.filter((m: any) => m.method === "turn/start");
    expect(turnStarts).toHaveLength(2);

    const t1 = turnStarts[0] as { params: { modelReasoningEffort?: string } };
    const t2 = turnStarts[1] as {
      params: { modelReasoningEffort?: string; effort?: string; summary?: string };
    };

    expect(t1.params.modelReasoningEffort).toBe("high");
    expect(t2.params.modelReasoningEffort).toBe("low");
    expect(t2.params.effort).toBe("low");
    expect(t2.params.summary).toBe("detailed");

    unmount();
  });
});

// ── VAL-TUI-CTRL-007: Controls persist across messages ──────────────

describe("VAL-TUI-CTRL-007: Reasoning effort persists across messages", () => {
  it("reasoning effort setting persists across multiple message exchanges within a session", async () => {
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

    const { stdin, lastFrame, unmount } = render(
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

    // Initialize
    respond(mockProc, { id: 0, result: { userAgent: "codex/0.117.0" } });
    await tick();

    // Switch focus to sidebar so 'r' shortcut works
    stdin.write("\t");
    await tick();

    // Change reasoning to "low" (high → low)
    stdin.write("r");
    await tick();

    let frame = lastFrame()!;
    expect(frame).toContain("reasoning: low");

    // Change to "medium" (low → medium)
    stdin.write("r");
    await tick();

    frame = lastFrame()!;
    expect(frame).toContain("reasoning: medium");

    // Switch back to input to send a message
    stdin.write("\t");
    await tick();

    // Send first message — should use "medium"
    stdin.write("First");
    await tick();
    stdin.write("\r");
    await tick(100);

    // Respond to thread/start
    respond(mockProc, { id: 1, result: { thread: { id: "thr_persist" } } });
    await tick();
    // Respond to turn/start
    respond(mockProc, {
      id: 2,
      result: { turn: { id: "turn_1", status: "inProgress", items: [], error: null } },
    });
    await tick();

    // Complete the turn
    respond(mockProc, {
      method: "turn/completed",
      params: { threadId: "thr_persist", turn: { id: "turn_1", status: "completed", items: [], error: null } },
    });
    await tick();

    // Verify reasoning still shows "medium" in status bar
    frame = lastFrame()!;
    expect(frame).toContain("reasoning: medium");

    // Send second message — should still use "medium"
    stdin.write("Second");
    await tick();
    stdin.write("\r");
    await tick(100);

    // Respond to turn/start
    respond(mockProc, {
      id: 3,
      result: { turn: { id: "turn_2", status: "inProgress", items: [], error: null } },
    });
    await tick();

    // Verify both turn/start calls used "medium"
    const turnStarts = sentMessages.filter((m: any) => m.method === "turn/start");
    expect(turnStarts).toHaveLength(2);

    const t1 = turnStarts[0] as {
      params: { modelReasoningEffort?: string; effort?: string; summary?: string };
    };
    const t2 = turnStarts[1] as {
      params: { modelReasoningEffort?: string; effort?: string; summary?: string };
    };

    expect(t1.params.modelReasoningEffort).toBe("medium");
    expect(t2.params.modelReasoningEffort).toBe("medium");
    expect(t1.params.effort).toBe("medium");
    expect(t2.params.effort).toBe("medium");
    expect(t1.params.summary).toBe("detailed");
    expect(t2.params.summary).toBe("detailed");

    // StatusBar still shows "medium"
    frame = lastFrame()!;
    expect(frame).toContain("reasoning: medium");

    unmount();
  });
});
