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
  { agentId: "a2", name: "Dev-1", status: "running", activeRunCount: 1, queuedIntentCount: 0 },
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

// ── VAL-TUI-CROSS-001: End-to-end chat flow ────────────────────────

describe("End-to-end chat flow (VAL-TUI-CROSS-001)", () => {
  it("full flow: render → type message → streaming → finalized message", async () => {
    const mockProc = createMockProcess();
    const mockSpawn = vi.fn().mockReturnValue(mockProc);
    const mockFetch = createMockFetch();

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

    // 1. Full-screen renders with all 5 regions
    await tick();
    let frame = lastFrame()!;
    expect(frame).toContain("Papierklammer");
    expect(frame).toContain("Agents");
    expect(frame).toContain("Chat");
    expect(frame).toContain("Codex:");

    // 2. Codex subprocess is spawned
    expect(mockSpawn).toHaveBeenCalledWith("codex", ["app-server"], {
      stdio: ["pipe", "pipe", "inherit"],
    });

    // 3. Codex initializes
    respond(mockProc, { id: 0, result: { userAgent: "codex/0.117.0" } });
    await tick();

    frame = lastFrame()!;
    expect(frame).toContain("Codex: connected");

    // Wait for API data to load
    await tick(100);
    frame = lastFrame()!;
    expect(frame).toContain("Connected");
    expect(frame).toContain("CEO");
    expect(frame).toContain("Dev-1");

    // 4. Tab to input and type a message
    stdin.write("\t"); // sidebar
    await tick();
    stdin.write("\t"); // input
    await tick();
    stdin.write("What agents are running?");
    await tick();
    stdin.write("\r"); // Enter
    await tick(100);

    // 5. Message appears in chat
    frame = lastFrame()!;
    expect(frame).toContain("You:");
    expect(frame).toContain("What agents are running?");
    // Should show thinking state
    expect(frame).toContain("thinking...");

    // 6. Respond to thread/start
    respond(mockProc, { id: 1, result: { thread: { id: "thr_e2e_test" } } });
    await tick();

    // 7. Respond to turn/start
    respond(mockProc, {
      id: 2,
      result: { turn: { id: "turn_1", status: "inProgress", items: [], error: null } },
    });
    await tick();

    // 8. Stream delta events — streaming text appears
    respond(mockProc, {
      method: "item/agentMessage/delta",
      params: { threadId: "thr_e2e_test", turnId: "turn_1", itemId: "item_1", delta: "Agent Dev-1" },
    });
    await tick();

    frame = lastFrame()!;
    expect(frame).toContain("Agent Dev-1");
    // Should show streaming cursor
    expect(frame).toContain("▌");

    // More streaming
    respond(mockProc, {
      method: "item/agentMessage/delta",
      params: { threadId: "thr_e2e_test", turnId: "turn_1", itemId: "item_1", delta: " is currently running." },
    });
    await tick();

    frame = lastFrame()!;
    expect(frame).toContain("Agent Dev-1 is currently running.");

    // 9. Turn completed — message finalized
    respond(mockProc, {
      method: "turn/completed",
      params: {
        threadId: "thr_e2e_test",
        turn: { id: "turn_1", status: "completed", items: [], error: null },
      },
    });
    await tick();

    frame = lastFrame()!;
    // Finalized message in history
    expect(frame).toContain("Orchestrator:");
    expect(frame).toContain("Agent Dev-1 is currently running.");
    // Streaming cursor should be gone
    expect(frame).not.toContain("▌");
    // Should not show thinking anymore
    expect(frame).not.toContain("thinking...");

    unmount();
  });

  it("multi-turn conversation uses same thread", async () => {
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

    // Tab to input
    stdin.write("\t");
    await tick();
    stdin.write("\t");
    await tick();

    // === First message ===
    stdin.write("First question");
    await tick();
    stdin.write("\r");
    await tick(100);

    // Respond thread/start
    respond(mockProc, { id: 1, result: { thread: { id: "thr_multi" } } });
    await tick();

    // Respond turn/start
    respond(mockProc, {
      id: 2,
      result: { turn: { id: "turn_1", status: "inProgress", items: [], error: null } },
    });
    await tick();

    // Stream and complete
    respond(mockProc, {
      method: "item/agentMessage/delta",
      params: { threadId: "thr_multi", turnId: "turn_1", itemId: "item_1", delta: "Answer 1" },
    });
    await tick();
    respond(mockProc, {
      method: "turn/completed",
      params: { threadId: "thr_multi", turn: { id: "turn_1", status: "completed", items: [], error: null } },
    });
    await tick();

    // === Second message (same thread) ===
    stdin.write("Second question");
    await tick();
    stdin.write("\r");
    await tick(100);

    // Respond turn/start (no thread/start — same thread)
    respond(mockProc, {
      id: 3,
      result: { turn: { id: "turn_2", status: "inProgress", items: [], error: null } },
    });
    await tick();

    // Stream and complete
    respond(mockProc, {
      method: "item/agentMessage/delta",
      params: { threadId: "thr_multi", turnId: "turn_2", itemId: "item_2", delta: "Answer 2" },
    });
    await tick();
    respond(mockProc, {
      method: "turn/completed",
      params: { threadId: "thr_multi", turn: { id: "turn_2", status: "completed", items: [], error: null } },
    });
    await tick();

    // Verify both messages in chat
    const frame = lastFrame()!;
    expect(frame).toContain("First question");
    expect(frame).toContain("Answer 1");
    expect(frame).toContain("Second question");
    expect(frame).toContain("Answer 2");

    // Verify the wire messages: only one thread/start, two turn/starts
    const threadStarts = sentMessages.filter((m: any) => m.method === "thread/start");
    const turnStarts = sentMessages.filter((m: any) => m.method === "turn/start");
    expect(threadStarts).toHaveLength(1);
    expect(turnStarts).toHaveLength(2);

    // Both turn/starts should use the same threadId
    const t1 = turnStarts[0] as { params: { threadId: string } };
    const t2 = turnStarts[1] as { params: { threadId: string } };
    expect(t1.params.threadId).toBe("thr_multi");
    expect(t2.params.threadId).toBe("thr_multi");

    unmount();
  });

  it("keeps the TUI alive and surfaces a Codex error when send fails", async () => {
    const mockProc = createMockProcess();
    const mockSpawn = vi.fn().mockReturnValue(mockProc);
    const mockFetch = createMockFetch();

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
    respond(mockProc, { id: 0, result: { userAgent: "codex/0.117.0" } });
    await tick(100);

    stdin.write("Why did the send fail?");
    await tick();
    stdin.write("\r");
    await tick(100);

    respond(mockProc, {
      id: 1,
      error: { code: -32000, message: "thread/start failed in test" },
    });
    await tick(100);

    const frame = lastFrame()!;
    expect(frame).toContain("You:");
    expect(frame).toContain("Why did the send fail?");
    expect(frame).toContain("Error: thread/start failed: thread/start failed in test");
    expect(frame).not.toContain("thinking...");

    unmount();
  });

  it("command execution blocks appear in chat during streaming", async () => {
    const mockProc = createMockProcess();
    const mockSpawn = vi.fn().mockReturnValue(mockProc);
    const mockFetch = createMockFetch();

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

    // Tab to input, type message
    stdin.write("\t");
    await tick();
    stdin.write("\t");
    await tick();
    stdin.write("Check system health");
    await tick();
    stdin.write("\r");
    await tick(100);

    // Respond to thread/start + turn/start
    respond(mockProc, { id: 1, result: { thread: { id: "thr_cmd" } } });
    await tick();
    respond(mockProc, {
      id: 2,
      result: { turn: { id: "turn_1", status: "inProgress", items: [], error: null } },
    });
    await tick();

    // Stream text delta
    respond(mockProc, {
      method: "item/agentMessage/delta",
      params: { threadId: "thr_cmd", turnId: "turn_1", itemId: "item_1", delta: "Checking health..." },
    });
    await tick();

    // Command execution completed
    respond(mockProc, {
      method: "item/completed",
      params: {
        item: {
          type: "commandExecution",
          id: "cmd_1",
          command: "curl http://localhost:3100/api/health",
          aggregatedOutput: '{"status":"ok"}',
          cwd: "/tmp",
          exitCode: 0,
          status: "completed",
        },
        threadId: "thr_cmd",
        turnId: "turn_1",
      },
    });
    await tick();

    const frame = lastFrame()!;
    expect(frame).toContain("$ curl http://localhost:3100/api/health");
    expect(frame).toContain('{"status":"ok"}');

    unmount();
  });
});

// ── VAL-TUI-CROSS-002: Agent status updates during chat ────────────

describe("Agent status updates during chat (VAL-TUI-CROSS-002)", () => {
  it("sidebar updates while chat is active without disruption", async () => {
    const initialAgents: AgentOverview[] = [
      { agentId: "a1", name: "CEO", status: "idle", activeRunCount: 0, queuedIntentCount: 0 },
      { agentId: "a2", name: "Dev-1", status: "idle", activeRunCount: 0, queuedIntentCount: 0 },
    ];

    const updatedAgents: AgentOverview[] = [
      { agentId: "a1", name: "CEO", status: "idle", activeRunCount: 0, queuedIntentCount: 0 },
      { agentId: "a2", name: "Dev-1", status: "running", activeRunCount: 1, queuedIntentCount: 0 },
    ];

    let pollCount = 0;
    const mockFetch = vi.fn().mockImplementation(() => {
      pollCount++;
      const agents = pollCount <= 1 ? initialAgents : updatedAgents;
      return Promise.resolve({
        ok: true,
        json: async () => ({
          agents,
          totalActiveRuns: agents.reduce((s, a) => s + a.activeRunCount, 0),
          totalQueuedIntents: 0,
          totalActiveLeases: 0,
        }),
      });
    });

    const { stdin, lastFrame, unmount } = render(
      <App
        url="http://localhost:3100"
        apiKey="test-key"
        companyId="test-company"
        fetchFn={mockFetch}
        pollInterval={100}
      />,
    );

    // Wait for initial API poll
    await tick();

    let frame = lastFrame()!;
    expect(frame).toContain("CEO");
    expect(frame).toContain("Dev-1");
    // Initially both idle
    expect(frame).toContain("(idle)");

    // Send a chat message
    stdin.write("\t");
    await tick();
    stdin.write("\t");
    await tick();
    stdin.write("Hello orchestrator");
    await tick();
    stdin.write("\r");
    await tick(50);

    frame = lastFrame()!;
    expect(frame).toContain("You:");
    expect(frame).toContain("Hello orchestrator");

    // Wait for the next poll cycle to get updated agents
    await tick(200);

    frame = lastFrame()!;
    // Chat should still be visible and undisrupted
    expect(frame).toContain("You:");
    expect(frame).toContain("Hello orchestrator");

    // Sidebar should have updated status
    expect(frame).toContain("(running)");
    // Agent count should be updated in header
    expect(frame).toContain("1 active run");

    unmount();
  });

  it("sidebar updates do not clear streaming text", async () => {
    const mockProc = createMockProcess();
    const mockSpawn = vi.fn().mockReturnValue(mockProc);

    let pollCount = 0;
    const mockFetch = vi.fn().mockImplementation(() => {
      pollCount++;
      const agents: AgentOverview[] = [
        {
          agentId: "a1",
          name: "Dev-1",
          status: pollCount <= 1 ? "idle" : "running",
          activeRunCount: pollCount <= 1 ? 0 : 1,
          queuedIntentCount: 0,
        },
      ];
      return Promise.resolve({
        ok: true,
        json: async () => ({
          agents,
          totalActiveRuns: agents.reduce((s, a) => s + a.activeRunCount, 0),
          totalQueuedIntents: 0,
          totalActiveLeases: 0,
        }),
      });
    });

    const { stdin, lastFrame, unmount } = render(
      <App
        url="http://localhost:3100"
        apiKey="test-key"
        companyId="test-company"
        fetchFn={mockFetch}
        pollInterval={100}
        spawnFn={mockSpawn}
        enableCodex={true}
      />,
    );

    await tick();

    // Initialize Codex
    respond(mockProc, { id: 0, result: { userAgent: "codex/0.117.0" } });
    await tick();

    // Tab to input, send message
    stdin.write("\t");
    await tick();
    stdin.write("\t");
    await tick();
    stdin.write("Tell me about agents");
    await tick();
    stdin.write("\r");
    await tick(100);

    // Respond to thread/start + turn/start
    respond(mockProc, { id: 1, result: { thread: { id: "thr_stream" } } });
    await tick();
    respond(mockProc, {
      id: 2,
      result: { turn: { id: "turn_1", status: "inProgress", items: [], error: null } },
    });
    await tick();

    // Start streaming
    respond(mockProc, {
      method: "item/agentMessage/delta",
      params: { threadId: "thr_stream", turnId: "turn_1", itemId: "item_1", delta: "Here is my" },
    });
    await tick();

    let frame = lastFrame()!;
    expect(frame).toContain("Here is my");

    // Wait for a sidebar poll to happen during streaming
    await tick(200);

    frame = lastFrame()!;
    // Streaming text should still be visible
    expect(frame).toContain("Here is my");
    // Sidebar should have updated
    expect(frame).toContain("(running)");

    unmount();
  });

  it("API error during active chat doesn't crash the app", async () => {
    let pollCount = 0;
    const mockFetch = vi.fn().mockImplementation(() => {
      pollCount++;
      if (pollCount <= 1) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            agents: MOCK_AGENTS,
            totalActiveRuns: 1,
            totalQueuedIntents: 0,
            totalActiveLeases: 0,
          }),
        });
      }
      // Second poll fails
      return Promise.reject(new Error("Connection lost"));
    });

    const { stdin, lastFrame, unmount } = render(
      <App
        url="http://localhost:3100"
        apiKey="test-key"
        companyId="test-company"
        fetchFn={mockFetch}
        pollInterval={100}
      />,
    );

    await tick();

    // Send a chat message
    stdin.write("\t");
    await tick();
    stdin.write("\t");
    await tick();
    stdin.write("Test message");
    await tick();
    stdin.write("\r");
    await tick(50);

    let frame = lastFrame()!;
    expect(frame).toContain("You:");
    expect(frame).toContain("Test message");

    // Wait for the failing poll
    await tick(200);

    frame = lastFrame()!;
    // App should not crash — chat message still visible
    expect(frame).toContain("Test message");
    // Header should show disconnected
    expect(frame).toContain("Disconnected");
    // Sidebar should show disconnected
    expect(frame).toContain("Connection lost");

    unmount();
  });
});
