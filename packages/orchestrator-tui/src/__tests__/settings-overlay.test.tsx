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

// ── VAL-TUI-CTRL-006: Settings overlay displays current configuration ──

describe("VAL-TUI-CTRL-006: Settings overlay displays current configuration", () => {
  it("pressing 's' opens settings overlay with correct values", async () => {
    const mockFetch = createMockFetch();

    const { stdin, lastFrame, unmount } = render(
      <App
        url="http://localhost:3100"
        apiKey="test-key"
        companyId="test-company"
        model="o4-mini"
        fetchFn={mockFetch}
        pollInterval={60000}
      />,
    );

    await tick();

    // Switch focus to sidebar so 's' is not captured by input
    stdin.write("\t");
    await tick();

    // Press 's' to open settings
    stdin.write("s");
    await tick();

    const frame = lastFrame()!;
    // Overlay should be visible with settings title
    expect(frame).toContain("Settings");
    // Should show current model
    expect(frame).toContain("Model");
    expect(frame).toContain("o4-mini");
    // Should show current reasoning effort (default: high)
    expect(frame).toContain("Reasoning Effort");
    expect(frame).toContain("high");
    // Should show current fast mode (default: off)
    expect(frame).toContain("Fast Mode");
    expect(frame).toContain("OFF");

    unmount();
  });

  it("pressing 's' again closes settings overlay", async () => {
    const mockFetch = createMockFetch();

    const { stdin, lastFrame, unmount } = render(
      <App
        url="http://localhost:3100"
        apiKey="test-key"
        companyId="test-company"
        model="o4-mini"
        fetchFn={mockFetch}
        pollInterval={60000}
      />,
    );

    await tick();

    // Switch focus to sidebar so 's' is not captured by input
    stdin.write("\t");
    await tick();

    // Open settings
    stdin.write("s");
    await tick();

    let frame = lastFrame()!;
    expect(frame).toContain("Settings");

    // Close with 's'
    stdin.write("s");
    await tick();

    frame = lastFrame()!;
    // Settings overlay should be gone
    expect(frame).not.toContain("Reasoning Effort");
    // Chat area should be visible again (status bar always shows these)
    expect(frame).toContain("Codex:");

    unmount();
  });

  it("Escape closes settings overlay", async () => {
    const mockFetch = createMockFetch();

    const { stdin, lastFrame, unmount } = render(
      <App
        url="http://localhost:3100"
        apiKey="test-key"
        companyId="test-company"
        model="o4-mini"
        fetchFn={mockFetch}
        pollInterval={60000}
      />,
    );

    await tick();

    // Switch focus to sidebar so 's' is not captured by input
    stdin.write("\t");
    await tick();

    // Open settings
    stdin.write("s");
    await tick();

    let frame = lastFrame()!;
    expect(frame).toContain("Settings");

    // Close with Escape
    stdin.write("\x1b");
    await tick();

    frame = lastFrame()!;
    // Settings should be closed
    expect(frame).not.toContain("Reasoning Effort");

    unmount();
  });

  it("'s' does not open settings when input is focused", async () => {
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

    // Default focus is input; ensure we're back on input
    stdin.write("\t"); // sidebar
    await tick();
    stdin.write("\t"); // input
    await tick();

    // Press 's' while input is focused — should type 's', not open overlay
    stdin.write("s");
    await tick();

    const frame = lastFrame()!;
    // Settings overlay should NOT be shown
    expect(frame).not.toContain("Reasoning Effort");

    unmount();
  });

  it("settings overlay shows default model when no model is provided", async () => {
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

    // Open settings
    stdin.write("s");
    await tick();

    const frame = lastFrame()!;
    expect(frame).toContain("Settings");
    expect(frame).toContain("default");

    unmount();
  });

  it("settings overlay reflects changed reasoning effort and fast mode", async () => {
    const mockFetch = createMockFetch();

    const { stdin, lastFrame, unmount } = render(
      <App
        url="http://localhost:3100"
        apiKey="test-key"
        companyId="test-company"
        model="o4-mini"
        fetchFn={mockFetch}
        pollInterval={60000}
      />,
    );

    await tick();

    // Switch focus to sidebar so shortcuts work
    stdin.write("\t");
    await tick();

    // Change reasoning effort: high → low
    stdin.write("r");
    await tick();

    // Enable fast mode
    stdin.write("f");
    await tick();

    // Open settings overlay
    stdin.write("s");
    await tick();

    const frame = lastFrame()!;
    expect(frame).toContain("Settings");
    expect(frame).toContain("low");
    expect(frame).toContain("ON");

    unmount();
  });

  it("'r' and 'f' work inside settings overlay for live adjustment", async () => {
    const mockFetch = createMockFetch();

    const { stdin, lastFrame, unmount } = render(
      <App
        url="http://localhost:3100"
        apiKey="test-key"
        companyId="test-company"
        model="o4-mini"
        fetchFn={mockFetch}
        pollInterval={60000}
      />,
    );

    await tick();

    // Switch focus to sidebar
    stdin.write("\t");
    await tick();

    // Open settings overlay
    stdin.write("s");
    await tick();

    let frame = lastFrame()!;
    expect(frame).toContain("Settings");
    expect(frame).toContain("high");
    expect(frame).toContain("OFF");

    // Press 'r' to cycle reasoning effort while settings is open
    stdin.write("r");
    await tick();

    frame = lastFrame()!;
    // Overlay should now show "low" (high → low)
    expect(frame).toContain("low");

    // Press 'f' to toggle fast mode while settings is open
    stdin.write("f");
    await tick();

    frame = lastFrame()!;
    // Overlay should now show fast mode ON
    expect(frame).toContain("ON");

    unmount();
  });

  it("'s' does not open settings when help overlay is visible", async () => {
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

    // Press 's' while help is open — should NOT open settings
    stdin.write("s");
    await tick();

    frame = lastFrame()!;
    // Still help overlay, not settings
    expect(frame).toContain("Keyboard Shortcuts");
    expect(frame).not.toContain("Reasoning Effort");

    unmount();
  });
});

// ── VAL-TUI-CTRL-007: Controls persist across messages (settings overlay) ──

describe("VAL-TUI-CTRL-007: Controls persist across messages (settings overlay verification)", () => {
  it("settings overlay shows persisted values after multiple message exchanges", async () => {
    const mockProc = createMockProcess();
    const mockSpawn = vi.fn().mockReturnValue(mockProc);
    const mockFetch = createMockFetch();

    const { stdin, lastFrame, unmount } = render(
      <App
        url="http://localhost:3100"
        apiKey="test-key"
        companyId="test-company"
        model="o4-mini"
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

    // Switch to sidebar to change settings
    stdin.write("\t");
    await tick();

    // Set reasoning to "low" (high → low)
    stdin.write("r");
    await tick();

    // Enable fast mode
    stdin.write("f");
    await tick();

    // Switch back to input
    stdin.write("\t");
    await tick();

    // Send first message
    stdin.write("First");
    await tick();
    stdin.write("\r");
    await tick(100);

    // Complete first turn
    respond(mockProc, { id: 1, result: { thread: { id: "thr_persist_settings" } } });
    await tick();
    respond(mockProc, {
      id: 2,
      result: { turn: { id: "turn_1", status: "inProgress", items: [], error: null } },
    });
    await tick();
    respond(mockProc, {
      method: "turn/completed",
      params: {
        threadId: "thr_persist_settings",
        turn: { id: "turn_1", status: "completed", items: [], error: null },
      },
    });
    await tick();

    // Send second message
    stdin.write("Second");
    await tick();
    stdin.write("\r");
    await tick(100);

    // Complete second turn
    respond(mockProc, {
      id: 3,
      result: { turn: { id: "turn_2", status: "inProgress", items: [], error: null } },
    });
    await tick();
    respond(mockProc, {
      method: "turn/completed",
      params: {
        threadId: "thr_persist_settings",
        turn: { id: "turn_2", status: "completed", items: [], error: null },
      },
    });
    await tick();

    // Now open settings overlay to verify values persisted
    stdin.write("\t"); // sidebar
    await tick();
    stdin.write("s");
    await tick();

    const frame = lastFrame()!;
    expect(frame).toContain("Settings");
    expect(frame).toContain("low");
    expect(frame).toContain("ON");
    expect(frame).toContain("o4-mini");

    unmount();
  });
});

// ── VAL-TUI-CROSS-002: Settings overlay during thinking ─────────────

describe("VAL-TUI-CROSS-002: Settings overlay during thinking", () => {
  it("opening settings during streaming does not interrupt the stream", async () => {
    const mockProc = createMockProcess();
    const mockSpawn = vi.fn().mockReturnValue(mockProc);
    const mockFetch = createMockFetch();

    const { stdin, lastFrame, unmount } = render(
      <App
        url="http://localhost:3100"
        apiKey="test-key"
        companyId="test-company"
        model="o4-mini"
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

    // Send a message
    stdin.write("Hello streaming");
    await tick();
    stdin.write("\r");
    await tick(100);

    // Start the thread and turn
    respond(mockProc, { id: 1, result: { thread: { id: "thr_settings_stream" } } });
    await tick();
    respond(mockProc, {
      id: 2,
      result: { turn: { id: "turn_1", status: "inProgress", items: [], error: null } },
    });
    await tick();

    // Begin streaming
    respond(mockProc, {
      method: "item/agentMessage/delta",
      params: {
        threadId: "thr_settings_stream",
        turnId: "turn_1",
        itemId: "item_1",
        delta: "Part one",
      },
    });
    await tick();

    let frame = lastFrame()!;
    expect(frame).toContain("Part one");

    // Open settings overlay while streaming
    stdin.write("\t"); // switch to sidebar
    await tick();
    stdin.write("s");
    await tick();

    frame = lastFrame()!;
    expect(frame).toContain("Settings");

    // Continue streaming while settings is open — stream continues in background
    respond(mockProc, {
      method: "item/agentMessage/delta",
      params: {
        threadId: "thr_settings_stream",
        turnId: "turn_1",
        itemId: "item_1",
        delta: " part two",
      },
    });
    await tick();

    // Settings overlay is still showing
    frame = lastFrame()!;
    expect(frame).toContain("Settings");

    // Complete the turn while settings overlay is open
    respond(mockProc, {
      method: "turn/completed",
      params: {
        threadId: "thr_settings_stream",
        turn: { id: "turn_1", status: "completed", items: [], error: null },
      },
    });
    await tick();

    // Close settings overlay
    stdin.write("s");
    await tick();

    frame = lastFrame()!;
    // Settings should be closed
    expect(frame).not.toContain("Reasoning Effort");
    // The accumulated stream content should be visible
    expect(frame).toContain("Part one part two");
    // Turn completed, so no more spinner
    expect(frame).not.toContain("thinking...");

    unmount();
  });

  it("settings overlay shows current model info during streaming", async () => {
    const mockProc = createMockProcess();
    const mockSpawn = vi.fn().mockReturnValue(mockProc);
    const mockFetch = createMockFetch();

    const { stdin, lastFrame, unmount } = render(
      <App
        url="http://localhost:3100"
        apiKey="test-key"
        companyId="test-company"
        model="o4-mini"
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

    // Send message to start streaming
    stdin.write("Hello");
    await tick();
    stdin.write("\r");
    await tick(100);

    // Thread + turn
    respond(mockProc, { id: 1, result: { thread: { id: "thr_settings_info" } } });
    await tick();
    respond(mockProc, {
      id: 2,
      result: { turn: { id: "turn_1", status: "inProgress", items: [], error: null } },
    });
    await tick();

    // Open settings while thinking
    stdin.write("\t"); // sidebar
    await tick();
    stdin.write("s");
    await tick();

    const frame = lastFrame()!;
    expect(frame).toContain("Settings");
    expect(frame).toContain("o4-mini");
    expect(frame).toContain("high");
    expect(frame).toContain("OFF");

    unmount();
  });
});
