import React from "react";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render } from "ink-testing-library";
import { EventEmitter, PassThrough } from "node:stream";
import { App } from "../components/App.js";
import { HelpOverlay } from "../components/HelpOverlay.js";
import { AgentSidebar } from "../components/AgentSidebar.js";
import { HeaderBar } from "../components/HeaderBar.js";
import type { AgentOverview } from "../hooks/useOrchestratorStatus.js";

// Suppress alternate screen buffer escape codes during tests
beforeEach(() => {
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

const tick = (ms = 50) => new Promise((r) => setTimeout(r, ms));

function createMockFetch(agents: AgentOverview[] = []) {
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

function createFailingFetch(errorMessage = "Network error") {
  return vi.fn().mockRejectedValue(new Error(errorMessage));
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

// ── VAL-TUI-031: API connection error displayed gracefully ──────────

describe("API connection error handling (VAL-TUI-031)", () => {
  it("shows Connecting instead of Disconnected before the first successful poll resolves", () => {
    const pendingFetch: typeof globalThis.fetch = vi.fn(() => new Promise<Response>(() => {})) as typeof globalThis.fetch;

    const { lastFrame, unmount } = render(
      <App
        url="http://localhost:3100"
        apiKey=""
        companyId="test-company"
        fetchFn={pendingFetch}
        pollInterval={60000}
      />,
    );

    const frame = lastFrame()!;
    expect(frame).toContain("Connecting");
    expect(frame).not.toContain("Disconnected");
    unmount();
  });

  it("shows Disconnected in header when API fails", async () => {
    const mockFetch = createFailingFetch("Connection refused");

    const { lastFrame, unmount } = render(
      <App
        url="http://localhost:3100"
        apiKey=""
        companyId="test-company"
        fetchFn={mockFetch}
        pollInterval={60000}
      />,
    );

    await tick();

    const frame = lastFrame()!;
    expect(frame).toContain("Disconnected");
    unmount();
  });

  it("shows error message in header when API fails", async () => {
    const mockFetch = createFailingFetch("Connection refused");

    const { lastFrame, unmount } = render(
      <App
        url="http://localhost:3100"
        apiKey=""
        companyId="test-company"
        fetchFn={mockFetch}
        pollInterval={60000}
      />,
    );

    await tick();

    const frame = lastFrame()!;
    expect(frame).toContain("Connection refused");
    unmount();
  });

  it("shows Disconnected in sidebar when API fails", async () => {
    const mockFetch = createFailingFetch("Connection refused");

    const { lastFrame, unmount } = render(
      <App
        url="http://localhost:3100"
        apiKey=""
        companyId="test-company"
        fetchFn={mockFetch}
        pollInterval={60000}
      />,
    );

    await tick();

    const frame = lastFrame()!;
    // The sidebar should show "Disconnected" text (red)
    // Check for the pattern — sidebar includes "Agents" header and "Disconnected"
    expect(frame).toContain("Agents");
    // Multiple "Disconnected" — one in header, one in sidebar
    const disconnectedCount = (frame.match(/Disconnected/g) ?? []).length;
    expect(disconnectedCount).toBeGreaterThanOrEqual(2);
    unmount();
  });

  it("app does not crash when API is unreachable", async () => {
    const mockFetch = createFailingFetch("fetch failed");

    const { lastFrame, unmount } = render(
      <App
        url="http://localhost:3100"
        apiKey=""
        companyId="test-company"
        fetchFn={mockFetch}
        pollInterval={60000}
      />,
    );

    await tick();

    // App should still render with all regions
    const frame = lastFrame()!;
    expect(frame).toContain("Papierklammer");
    expect(frame).toContain("Agents");
    expect(frame).toContain("Chat");
    expect(frame).toContain("Codex:");
    unmount();
  });

  it("HeaderBar shows error alongside Disconnected", () => {
    const { lastFrame, unmount } = render(
      <HeaderBar connected={false} totalAgents={0} totalActiveRuns={0} error="HTTP 500" />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain("Disconnected");
    expect(frame).toContain("HTTP 500");
    unmount();
  });

  it("HeaderBar does not show error when connected", () => {
    const { lastFrame, unmount } = render(
      <HeaderBar connected={true} totalAgents={3} totalActiveRuns={1} error={null} />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain("Connected");
    expect(frame).toContain("3 agents");
    expect(frame).toContain("1 active run");
    unmount();
  });

  it("AgentSidebar shows Disconnected with error", () => {
    const { lastFrame, unmount } = render(
      <AgentSidebar agents={[]} connected={false} error="Network error" />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain("Disconnected");
    expect(frame).toContain("Network error");
    unmount();
  });

  it("AgentSidebar shows agents when connected", () => {
    const agents: AgentOverview[] = [
      { agentId: "a1", name: "Dev-1", status: "idle", activeRunCount: 0, queuedIntentCount: 0 },
    ];
    const { lastFrame, unmount } = render(
      <AgentSidebar agents={agents} connected={true} />,
    );
    const frame = lastFrame()!;
    expect(frame).not.toContain("Disconnected");
    expect(frame).toContain("Dev-1");
    unmount();
  });

  it("recovers from error when API becomes available", async () => {
    let callCount = 0;
    const mockFetch = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount <= 1) {
        return Promise.reject(new Error("Connection refused"));
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({
          agents: [{ agentId: "a1", name: "Dev-1", status: "idle", activeRunCount: 0, queuedIntentCount: 0 }],
          totalActiveRuns: 0,
          totalQueuedIntents: 0,
          totalActiveLeases: 0,
        }),
      });
    });

    const { lastFrame, unmount } = render(
      <App
        url="http://localhost:3100"
        apiKey=""
        companyId="test-company"
        fetchFn={mockFetch}
        pollInterval={100}
      />,
    );

    // First poll fails
    await tick();
    let frame = lastFrame()!;
    expect(frame).toContain("Disconnected");

    // Second poll succeeds after interval
    await tick(200);
    frame = lastFrame()!;
    expect(frame).toContain("Connected");
    expect(frame).toContain("Dev-1");

    unmount();
  });
});

// ── VAL-TUI-033: Help overlay toggles with ? key ────────────────────

describe("Help overlay (VAL-TUI-033)", () => {
  it("HelpOverlay renders keyboard shortcuts when visible", () => {
    const { lastFrame, unmount } = render(
      <HelpOverlay visible={true} onDismiss={() => {}} />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain("Keyboard Shortcuts");
    expect(frame).toContain("Tab");
    expect(frame).toContain("Enter");
    expect(frame).toContain("Ctrl+C");
    expect(frame).toContain("?");
    unmount();
  });

  it("HelpOverlay renders nothing when not visible", () => {
    const { lastFrame, unmount } = render(
      <HelpOverlay visible={false} onDismiss={() => {}} />,
    );
    const frame = lastFrame()!;
    expect(frame).not.toContain("Keyboard Shortcuts");
    unmount();
  });

  it("HelpOverlay calls onDismiss when Escape is pressed", async () => {
    const onDismiss = vi.fn();
    const { stdin, unmount } = render(
      <HelpOverlay visible={true} onDismiss={onDismiss} />,
    );

    // Press Escape
    stdin.write("\x1b");
    await tick();

    expect(onDismiss).toHaveBeenCalled();
    unmount();
  });

  it("HelpOverlay calls onDismiss when ? is pressed", async () => {
    const onDismiss = vi.fn();
    const { stdin, unmount } = render(
      <HelpOverlay visible={true} onDismiss={onDismiss} />,
    );

    stdin.write("?");
    await tick();

    expect(onDismiss).toHaveBeenCalled();
    unmount();
  });

  it("pressing ? in App shows help overlay when sidebar focused", async () => {
    const mockFetch = createMockFetch();

    const { stdin, lastFrame, unmount } = render(
      <App
        url="http://localhost:3100"
        apiKey=""
        companyId="test-company"
        fetchFn={mockFetch}
        pollInterval={60000}
      />,
    );

    await tick();

    // Tab to sidebar (first focusable)
    stdin.write("\t");
    await tick();

    // Press ? to toggle help
    stdin.write("?");
    await tick();

    const frame = lastFrame()!;
    expect(frame).toContain("Keyboard Shortcuts");
    unmount();
  });

  it("pressing ? again dismisses help overlay", async () => {
    const mockFetch = createMockFetch();

    const { stdin, lastFrame, unmount } = render(
      <App
        url="http://localhost:3100"
        apiKey=""
        companyId="test-company"
        fetchFn={mockFetch}
        pollInterval={60000}
      />,
    );

    await tick();

    // Tab to sidebar
    stdin.write("\t");
    await tick();

    // Show help
    stdin.write("?");
    await tick();
    expect(lastFrame()!).toContain("Keyboard Shortcuts");

    // Dismiss with ?
    stdin.write("?");
    await tick();
    expect(lastFrame()!).not.toContain("Keyboard Shortcuts");

    unmount();
  });

  it("Escape key dismisses help overlay in App", async () => {
    const mockFetch = createMockFetch();

    const { stdin, lastFrame, unmount } = render(
      <App
        url="http://localhost:3100"
        apiKey=""
        companyId="test-company"
        fetchFn={mockFetch}
        pollInterval={60000}
      />,
    );

    await tick();

    // Tab to sidebar
    stdin.write("\t");
    await tick();

    // Show help
    stdin.write("?");
    await tick();
    expect(lastFrame()!).toContain("Keyboard Shortcuts");

    // Dismiss with Escape
    stdin.write("\x1b");
    await tick();
    expect(lastFrame()!).not.toContain("Keyboard Shortcuts");

    unmount();
  });

  it("help overlay shows all documented shortcuts", () => {
    const { lastFrame, unmount } = render(
      <HelpOverlay visible={true} onDismiss={() => {}} />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain("Switch regions");
    expect(frame).toContain("Send message");
    expect(frame).toContain("Exit");
    expect(frame).toContain("Scroll agents");
    expect(frame).toContain("Toggle this help overlay");
    unmount();
  });
});

// ── VAL-TUI-034: Graceful shutdown terminates Codex subprocess ──────

describe("Graceful shutdown (VAL-TUI-034)", () => {
  it("Ctrl+C sends SIGTERM to Codex subprocess via destroy", async () => {
    const mockProc = createMockProcess();
    const mockSpawn = vi.fn().mockReturnValue(mockProc);
    const mockFetch = createMockFetch();

    const { stdin, unmount } = render(
      <App
        url="http://localhost:3100"
        apiKey=""
        companyId="test-company"
        fetchFn={mockFetch}
        pollInterval={60000}
        spawnFn={mockSpawn}
        enableCodex={true}
      />,
    );

    // Wait for Codex to be spawned and initialized
    await tick();

    // Respond to initialize
    respond(mockProc, { id: 0, result: { userAgent: "codex/0.117.0" } });
    await tick();

    // Press Ctrl+C
    stdin.write("\x03");
    await tick(100);

    // The process should have received SIGTERM via destroy()
    expect(mockProc.kill).toHaveBeenCalledWith("SIGTERM");

    unmount();
  });

  it("terminal is restored after Ctrl+C", async () => {
    const stdoutWriteMock = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const mockFetch = createMockFetch();

    const { stdin, unmount } = render(
      <App
        url="http://localhost:3100"
        apiKey=""
        companyId="test-company"
        fetchFn={mockFetch}
        pollInterval={60000}
      />,
    );

    await tick();

    // Press Ctrl+C
    stdin.write("\x03");
    await tick(100);

    unmount();

    // Check that terminal restore sequence was emitted
    const calls = stdoutWriteMock.mock.calls.map((call: unknown[]) => call[0]);
    expect(calls).toContain("\x1b[?1049l");
  });
});

// ── VAL-TUI-030: Codex crash shows error and auto-restarts ─────────

describe("Codex crash auto-restart (VAL-TUI-030)", () => {
  it("shows Codex disconnected when subprocess crashes", async () => {
    const mockProc = createMockProcess();
    const mockSpawn = vi.fn().mockReturnValue(mockProc);
    const mockFetch = createMockFetch();

    const { lastFrame, unmount } = render(
      <App
        url="http://localhost:3100"
        apiKey=""
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

    let frame = lastFrame()!;
    expect(frame).toContain("Codex: connected");

    // Simulate subprocess crash
    mockProc.emit("exit", 1, null);
    await tick();

    frame = lastFrame()!;
    expect(frame).toContain("Codex: disconnected");

    unmount();
  });

  it("auto-restarts Codex subprocess after crash", async () => {
    const proc1 = createMockProcess();
    const proc2 = createMockProcess();
    let spawnCount = 0;
    const mockSpawn = vi.fn().mockImplementation(() => {
      spawnCount++;
      return spawnCount === 1 ? proc1 : proc2;
    });
    const mockFetch = createMockFetch();

    // Use a short reconnect delay for testing. The useCodex hook passes
    // reconnectDelayMs through to CodexClient, which defaults to 3000ms.
    // We can't control that from App props directly, but the CodexClient
    // default is used. So we'll wait for the reconnect delay.

    const { lastFrame, unmount } = render(
      <App
        url="http://localhost:3100"
        apiKey=""
        companyId="test-company"
        fetchFn={mockFetch}
        pollInterval={60000}
        spawnFn={mockSpawn}
        enableCodex={true}
      />,
    );

    await tick();

    // Initialize first process
    respond(proc1, { id: 0, result: { userAgent: "codex/0.117.0" } });
    await tick();

    // Crash the first subprocess
    proc1.emit("exit", 1, null);
    await tick();

    expect(lastFrame()!).toContain("Codex: disconnected");

    // Wait for the reconnect delay (3000ms default) + some buffer
    await tick(3500);

    // A second spawn should have happened
    expect(mockSpawn).toHaveBeenCalledTimes(2);

    // Initialize the second process — note: nextId is NOT reset on reconnect
    // The first initialize used id 0, the "initialized" notification was sent,
    // so the second initialize uses id 1
    respond(proc2, { id: 1, result: { userAgent: "codex/0.117.0" } });
    await tick(200);

    expect(lastFrame()!).toContain("Codex: connected");

    unmount();
  });
});
