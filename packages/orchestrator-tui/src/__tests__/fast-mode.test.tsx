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
  return vi.fn().mockImplementation(async (input: string | URL | Request) => {
    const url = String(input);

    if (url.includes("/approvals?status=pending")) {
      return {
        ok: true,
        json: async () => [],
      };
    }

    if (url.includes("/api/companies/") && url.includes("/issues")) {
      return {
        ok: true,
        json: async () => [],
      };
    }

    return {
      ok: true,
      json: async () => ({
        agents,
        totalActiveRuns: agents.reduce((s, a) => s + a.activeRunCount, 0),
        totalQueuedIntents: 0,
        totalActiveLeases: 0,
      }),
    };
  });
}

// ── VAL-TUI-CTRL-004: Fast mode toggle ─────────────────────────────

describe("VAL-TUI-CTRL-004: Fast mode toggle", () => {
  it("pressing 'f' toggles fast mode on/off", async () => {
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

    // Default is on
    let frame = lastFrame()!;
    expect(frame).toContain("fast: ON");

    // Switch focus to sidebar so 'f' is not captured by input
    stdin.write("\t");
    await tick();

    // Press 'f' to toggle off
    stdin.write("f");
    await tick();

    frame = lastFrame()!;
    expect(frame).toContain("fast: OFF");
    expect(frame).not.toContain("2×");

    // Press 'f' again to toggle back on
    stdin.write("f");
    await tick();

    frame = lastFrame()!;
    expect(frame).toContain("fast: ON");
    expect(frame).toContain("2×");

    unmount();
  });

  it("StatusBar shows fast mode status", async () => {
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
    expect(frame).toContain("fast: ON");

    unmount();
  });

  it("'f' does not toggle when input is focused", async () => {
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

    // Default is on
    let frame = lastFrame()!;
    expect(frame).toContain("fast: ON");

    // Focus input by tabbing (default is input, Tab → sidebar, Tab → input)
    stdin.write("\t"); // sidebar
    await tick();
    stdin.write("\t"); // input
    await tick();

    // Now typing 'f' in the input should NOT toggle fast mode
    stdin.write("f");
    await tick();

    frame = lastFrame()!;
    // Should still say "ON" because input was focused
    expect(frame).toContain("fast: ON");

    unmount();
  });

  it("'f' does not toggle when help overlay is visible", async () => {
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

    // Switch focus to sidebar
    stdin.write("\t");
    await tick();

    // Open help overlay
    stdin.write("?");
    await tick();

    let frame = lastFrame()!;
    expect(frame).toContain("Keyboard Shortcuts");

    // Press 'f' while help is open — should NOT toggle
    stdin.write("f");
    await tick();

    // Close help
    stdin.write("?");
    await tick();

    frame = lastFrame()!;
    expect(frame).toContain("fast: ON");

    unmount();
  });
});

// ── VAL-TUI-CTRL-005: Fast mode passed to Codex ────────────────────

describe("VAL-TUI-CTRL-005: Fast mode passed to Codex", () => {
  it("thread/start includes serviceTier when fast mode is enabled", async () => {
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
    stdin.write("Hello fast");
    await tick();
    stdin.write("\r");
    await tick(100);

    // Respond to thread/start
    respond(mockProc, { id: 1, result: { thread: { id: "thr_fast" } } });
    await tick();

    // Find thread/start message on the wire
    const threadStart = sentMessages.find(
      (m: any) => m.method === "thread/start",
    ) as { method: string; params: Record<string, unknown> } | undefined;

    expect(threadStart).toBeDefined();
    expect(threadStart!.params.serviceTier).toBe("fast");

    unmount();
  });

  it("turn/start includes serviceTier when fast mode is enabled", async () => {
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

    // Switch focus to sidebar so 'f' shortcut works
    stdin.write("\t");
    await tick();

    // Disable fast mode
    stdin.write("f");
    await tick();

    // Switch back to input
    stdin.write("\t");
    await tick();

    // Send a message
    stdin.write("Hello fast");
    await tick();
    stdin.write("\r");
    await tick(100);

    // Respond to thread/start
    respond(mockProc, { id: 1, result: { thread: { id: "thr_fast_turn" } } });
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
    expect(turnStart!.params.serviceTier).toBeUndefined();

    unmount();
  });

  it("thread/start omits serviceTier after fast mode is toggled off", async () => {
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

    // Switch focus to sidebar and disable fast mode from its default-on state
    stdin.write("\t");
    await tick();
    stdin.write("f");
    await tick();
    stdin.write("\t");
    await tick();

    // Send a message
    stdin.write("Hello normal");
    await tick();
    stdin.write("\r");
    await tick(100);

    // Respond to thread/start
    respond(mockProc, { id: 1, result: { thread: { id: "thr_normal" } } });
    await tick();

    // Find thread/start message on the wire
    const threadStart = sentMessages.find(
      (m: any) => m.method === "thread/start",
    ) as { method: string; params: Record<string, unknown> } | undefined;

    expect(threadStart).toBeDefined();
    expect(threadStart!.params.serviceTier).toBeUndefined();

    unmount();
  });
});

// ── Fast mode persists across messages (part of VAL-TUI-CTRL-007) ──

describe("VAL-TUI-CTRL-007: Fast mode persists across messages", () => {
  it("fast mode setting persists across multiple message exchanges", async () => {
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

    // Switch focus to sidebar so 'f' shortcut works
    stdin.write("\t");
    await tick();

    // Disable fast mode
    stdin.write("f");
    await tick();

    let frame = lastFrame()!;
    expect(frame).toContain("fast: OFF");

    // Switch back to input
    stdin.write("\t");
    await tick();

    // Send first message — should have serviceTier
    stdin.write("First");
    await tick();
    stdin.write("\r");
    await tick(100);

    // Respond to thread/start
    respond(mockProc, { id: 1, result: { thread: { id: "thr_persist_fast" } } });
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
      params: { threadId: "thr_persist_fast", turn: { id: "turn_1", status: "completed", items: [], error: null } },
    });
    await tick();

    // Verify fast mode still shows OFF in status bar
    frame = lastFrame()!;
    expect(frame).toContain("fast: OFF");

    // Send second message — should still have serviceTier
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

    // Verify both turn/start calls omit fast service tier after disabling it
    const turnStarts = sentMessages.filter((m: any) => m.method === "turn/start");
    expect(turnStarts).toHaveLength(2);

    const t1 = turnStarts[0] as { params: { serviceTier?: string } };
    const t2 = turnStarts[1] as { params: { serviceTier?: string } };

    expect(t1.params.serviceTier).toBeUndefined();
    expect(t2.params.serviceTier).toBeUndefined();

    // StatusBar still shows fast: OFF
    frame = lastFrame()!;
    expect(frame).toContain("fast: OFF");

    unmount();
  });
});
