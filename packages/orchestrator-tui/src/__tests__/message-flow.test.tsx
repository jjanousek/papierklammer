import React from "react";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render } from "ink-testing-library";
import { EventEmitter, PassThrough } from "node:stream";
import { App } from "../components/App.js";
import type { AgentOverview } from "../hooks/useOrchestratorStatus.js";

vi.mock("../components/AnimatedGlyph.js", () => ({
  AnimatedGlyph: () => React.createElement("ink-text", null, "SPINNER"),
}));

// Suppress alternate screen buffer escape codes during tests
beforeEach(() => {
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

const tick = (ms = 50) => new Promise((r) => setTimeout(r, ms));

async function waitForFrame(
  lastFrame: () => string | undefined,
  predicate: (frame: string) => boolean,
  timeoutMs = 1000,
): Promise<string> {
  const start = Date.now();
  let frame = lastFrame() ?? "";

  while (!predicate(frame)) {
    if (Date.now() - start >= timeoutMs) {
      throw new Error(`Timed out waiting for frame.\nLast frame:\n${frame}`);
    }
    await tick(20);
    frame = lastFrame() ?? "";
  }

  return frame;
}

function stabilizeTerminal(stdout: NodeJS.WriteStream | EventEmitter): void {
  const stream = stdout as NodeJS.WriteStream & EventEmitter;
  Object.defineProperty(stream, "columns", {
    value: 120,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(stream, "rows", {
    value: 24,
    writable: true,
    configurable: true,
  });
  stream.emit("resize");
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

const MOCK_AGENTS: AgentOverview[] = [
  { agentId: "a1", name: "CEO", status: "idle", activeRunCount: 0, queuedIntentCount: 0 },
];

function createMockFetch() {
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
        agents: MOCK_AGENTS,
        totalActiveRuns: 0,
        totalQueuedIntents: 0,
        totalActiveLeases: 0,
      }),
    };
  });
}

function countOccurrences(frame: string, value: string): number {
  return frame.split(value).length - 1;
}

/** Helper: initialize codex, tab to input */
async function setupApp(options?: { enableCodex?: boolean }) {
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
      enableCodex={options?.enableCodex ?? true}
    />,
  );

  stabilizeTerminal(result.stdout as unknown as NodeJS.WriteStream | EventEmitter);
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

/** Helper: send a message and complete the turn */
async function sendAndComplete(
  stdin: { write: (data: string) => void },
  mockProc: ReturnType<typeof createMockProcess>,
  text: string,
  threadId: string,
  turnId: string,
  responseId: number,
  answer: string,
  isFirstMessage: boolean,
) {
  stdin.write(text);
  await tick();
  stdin.write("\r");
  await tick(100);

  if (isFirstMessage) {
    // Respond to thread/start
    respond(mockProc, { id: responseId, result: { thread: { id: threadId } } });
    await tick();
    // Respond to turn/start
    respond(mockProc, {
      id: responseId + 1,
      result: { turn: { id: turnId, status: "inProgress", items: [], error: null } },
    });
  } else {
    // Respond to turn/start only (same thread)
    respond(mockProc, {
      id: responseId,
      result: { turn: { id: turnId, status: "inProgress", items: [], error: null } },
    });
  }
  await tick();

  // Stream delta
  respond(mockProc, {
    method: "item/agentMessage/delta",
    params: { threadId, turnId, itemId: `item_${turnId}`, delta: answer },
  });
  await tick();

  // Complete turn
  respond(mockProc, {
    method: "turn/completed",
    params: { threadId, turn: { id: turnId, status: "completed", items: [], error: null } },
  });
  await tick();
}

// ── VAL-TUI-STAB-004: Multiple messages don't break layout ─────────

describe("VAL-TUI-STAB-004: Multiple messages don't break layout", () => {
  it("sending 3+ sequential messages maintains stable layout without stuck state", async () => {
    const { stdin, lastFrame, unmount, mockProc, sentMessages } = await setupApp();

    // === Message 1 ===
    await sendAndComplete(stdin, mockProc, "First", "thr_multi3", "turn_1", 1, "Reply 1", true);

    await waitForFrame(
      lastFrame,
      (current) =>
        current.includes("First") &&
        current.includes("Reply 1") &&
        !current.includes("thinking..."),
    );

    // === Message 2 ===
    await sendAndComplete(stdin, mockProc, "Second", "thr_multi3", "turn_2", 3, "Reply 2", false);

    await waitForFrame(
      lastFrame,
      (current) =>
        current.includes("Second") &&
        current.includes("Reply 2") &&
        !current.includes("thinking..."),
    );

    // === Message 3 ===
    await sendAndComplete(stdin, mockProc, "Third", "thr_multi3", "turn_3", 4, "Reply 3", false);

    await waitForFrame(
      lastFrame,
      (current) =>
        current.includes("Reply 3") &&
        !current.includes("thinking..."),
    );

    // Verify only one thread/start was sent, three turn/starts
    const threadStarts = sentMessages.filter((m: any) => m.method === "thread/start");
    const turnStarts = sentMessages.filter((m: any) => m.method === "turn/start");
    expect(threadStarts).toHaveLength(1);
    expect(turnStarts).toHaveLength(3);

    // All turn/starts use the same threadId
    for (const ts of turnStarts) {
      expect((ts as any).params.threadId).toBe("thr_multi3");
    }

    unmount();
  });
});

// ── VAL-TUI-STAB-005: Second message uses existing threadId ────────

describe("VAL-TUI-STAB-005: Second message works without getting stuck", () => {
  it("second message reuses threadId via ref (not stale closure)", async () => {
    const { stdin, lastFrame, unmount, mockProc, sentMessages } = await setupApp();

    // === First message ===
    stdin.write("Hello");
    await tick();
    stdin.write("\r");
    await tick(100);

    // Respond to thread/start
    respond(mockProc, { id: 1, result: { thread: { id: "thr_ref_test" } } });
    await tick();

    // Respond to turn/start
    respond(mockProc, {
      id: 2,
      result: { turn: { id: "turn_1", status: "inProgress", items: [], error: null } },
    });
    await tick();

    // Stream and complete
    respond(mockProc, {
      method: "item/agentMessage/delta",
      params: { threadId: "thr_ref_test", turnId: "turn_1", itemId: "item_1", delta: "Hi" },
    });
    await tick();
    respond(mockProc, {
      method: "turn/completed",
      params: { threadId: "thr_ref_test", turn: { id: "turn_1", status: "completed", items: [], error: null } },
    });
    await tick();

    // Verify first turn complete, input re-enabled
    await waitForFrame(lastFrame, (current) => !current.includes("thinking..."));

    // === Second message — should NOT create a new thread ===
    stdin.write("Follow up");
    await tick();
    stdin.write("\r");
    await tick(100);

    // Should show thinking state
    await waitForFrame(lastFrame, (current) => current.includes("thinking..."));

    // Respond to turn/start (no thread/start expected)
    respond(mockProc, {
      id: 3,
      result: { turn: { id: "turn_2", status: "inProgress", items: [], error: null } },
    });
    await tick();

    // Stream and complete second turn
    respond(mockProc, {
      method: "item/agentMessage/delta",
      params: { threadId: "thr_ref_test", turnId: "turn_2", itemId: "item_2", delta: "Follow up reply" },
    });
    await tick();
    respond(mockProc, {
      method: "turn/completed",
      params: { threadId: "thr_ref_test", turn: { id: "turn_2", status: "completed", items: [], error: null } },
    });
    await tick();

    await waitForFrame(
      lastFrame,
      (current) =>
        current.includes("Follow up") &&
        current.includes("Follow up reply") &&
        !current.includes("thinking..."),
    );

    // Verify wire: only 1 thread/start, 2 turn/starts with same threadId
    const threadStarts = sentMessages.filter((m: any) => m.method === "thread/start");
    const turnStarts = sentMessages.filter((m: any) => m.method === "turn/start");
    expect(threadStarts).toHaveLength(1);
    expect(turnStarts).toHaveLength(2);
    expect((turnStarts[0] as any).params.threadId).toBe("thr_ref_test");
    expect((turnStarts[1] as any).params.threadId).toBe("thr_ref_test");

    unmount();
  });

  it("isThinking resets properly between turns", async () => {
    const { stdin, lastFrame, unmount, mockProc } = await setupApp();

    // First message
    stdin.write("msg1");
    await tick();
    stdin.write("\r");
    await tick(100);

    expect(lastFrame()!).toContain("thinking...");

    // Complete first turn
    respond(mockProc, { id: 1, result: { thread: { id: "thr_reset" } } });
    await tick();
    respond(mockProc, {
      id: 2,
      result: { turn: { id: "turn_1", status: "inProgress", items: [], error: null } },
    });
    await tick();
    respond(mockProc, {
      method: "item/agentMessage/delta",
      params: { threadId: "thr_reset", turnId: "turn_1", itemId: "item_1", delta: "done" },
    });
    await tick();
    respond(mockProc, {
      method: "turn/completed",
      params: { threadId: "thr_reset", turn: { id: "turn_1", status: "completed", items: [], error: null } },
    });
    await tick();

    // Verify thinking is false between turns
    await waitForFrame(
      lastFrame,
      (current) =>
        !current.includes("thinking...") &&
        !current.includes("Waiting for response"),
    );

    // Second message — input should be enabled
    stdin.write("msg2");
    await tick();
    stdin.write("\r");
    await tick(100);

    // Should enter thinking again
    await waitForFrame(lastFrame, (current) => current.includes("thinking..."));

    unmount();
  });
});

// ── VAL-TUI-STAB-006: Error during send resets thinking state ──────

describe("VAL-TUI-STAB-006: Error during send resets thinking state", () => {
  it("failed thread/start resets isThinking and shows error message", async () => {
    const { stdin, lastFrame, unmount, mockProc } = await setupApp();

    // Send a message
    stdin.write("Will fail");
    await tick();
    stdin.write("\r");
    await tick(100);

    // Fail the thread/start
    respond(mockProc, {
      id: 1,
      error: { code: -32000, message: "Server unavailable" },
    });
    await tick(100);

    const frame = await waitForFrame(
      lastFrame,
      (current) =>
        current.includes("Error:") &&
        current.includes("Server unavailable") &&
        !current.includes("thinking..."),
    );

    // Error message should appear in chat
    expect(frame).toContain("Error:");
    expect(frame).toContain("Server unavailable");

    // isThinking should be reset (no thinking indicator)
    expect(frame).not.toContain("thinking...");
    expect(frame).not.toContain("Waiting for response");

    unmount();
  });

  it("failed turn/start resets isThinking and shows error message", async () => {
    const { stdin, lastFrame, unmount, mockProc } = await setupApp();

    // First send — thread created successfully
    stdin.write("First");
    await tick();
    stdin.write("\r");
    await tick(100);

    respond(mockProc, { id: 1, result: { thread: { id: "thr_err" } } });
    await tick();

    // turn/start fails
    respond(mockProc, {
      id: 2,
      error: { code: -32000, message: "Turn failed" },
    });
    await tick(100);

    const frame = await waitForFrame(
      lastFrame,
      (current) =>
        current.includes("Error:") &&
        current.includes("Turn failed") &&
        !current.includes("thinking..."),
    );
    expect(frame).toContain("Error:");
    expect(frame).toContain("Turn failed");
    expect(frame).not.toContain("thinking...");

    unmount();
  });

  it("input is re-enabled after send failure so user can retry", async () => {
    const { stdin, lastFrame, unmount, mockProc } = await setupApp();

    // Send and fail
    stdin.write("Will fail");
    await tick();
    stdin.write("\r");
    await tick(100);

    respond(mockProc, {
      id: 1,
      error: { code: -32000, message: "Boom" },
    });
    await tick(100);

    // Verify the error surfaced to the operator
    await waitForFrame(
      lastFrame,
      (current) => current.includes("Error:") && current.includes("Boom"),
    );

    // User can type again (input not disabled)
    stdin.write("Retry message");
    await tick();
    await waitForFrame(lastFrame, (current) => current.includes("Retry message"));

    unmount();
  });

  it("send after error recovery works end-to-end", async () => {
    const { stdin, lastFrame, unmount, mockProc } = await setupApp();

    // First send fails
    stdin.write("Fails");
    await tick();
    stdin.write("\r");
    await tick(100);

    respond(mockProc, {
      id: 1,
      error: { code: -32000, message: "Not ready" },
    });
    await tick(100);

    await waitForFrame(
      lastFrame,
      (current) => current.includes("Error:") && !current.includes("thinking..."),
    );

    // Second send succeeds
    stdin.write("Works now");
    await tick();
    stdin.write("\r");
    await tick(100);

    // New thread created (previous failed before thread was established)
    respond(mockProc, { id: 2, result: { thread: { id: "thr_recovery" } } });
    await tick();
    respond(mockProc, {
      id: 3,
      result: { turn: { id: "turn_1", status: "inProgress", items: [], error: null } },
    });
    await tick();

    respond(mockProc, {
      method: "item/agentMessage/delta",
      params: { threadId: "thr_recovery", turnId: "turn_1", itemId: "item_1", delta: "All good!" },
    });
    await tick();
    respond(mockProc, {
      method: "turn/completed",
      params: { threadId: "thr_recovery", turn: { id: "turn_1", status: "completed", items: [], error: null } },
    });
    await tick();

    await waitForFrame(
      lastFrame,
      (current) =>
        current.includes("Works now") &&
        current.includes("All good!") &&
        !current.includes("thinking..."),
    );

    unmount();
  });

  it("failed turn completion surfaces an error and leaves the input ready for retry", async () => {
    const { stdin, lastFrame, unmount, mockProc } = await setupApp();

    stdin.write("Create onboarding work");
    await tick();
    stdin.write("\r");
    await tick(100);

    respond(mockProc, { id: 1, result: { thread: { id: "thr_failed_turn" } } });
    await tick();
    respond(mockProc, {
      id: 2,
      result: {
        turn: { id: "turn_failed", status: "inProgress", items: [], error: null },
      },
    });
    await tick();

    respond(mockProc, {
      method: "turn/completed",
      params: {
        threadId: "thr_failed_turn",
        turn: {
          id: "turn_failed",
          status: "failed",
          items: [],
          error: {
            message: "Issue creation failed",
            additionalDetails: "POST /api/orchestrator/issues returned HTTP 500",
          },
        },
      },
    });
    await tick(100);

    await waitForFrame(
      lastFrame,
      (current) =>
        current.includes("Create onboarding work") &&
        current.includes("Error: Issue creation failed"),
    );

    stdin.write("Retry the request");
    await tick();
    await waitForFrame(lastFrame, (current) => current.includes("Retry the request"));

    unmount();
  });

  it("mid-turn Codex disconnect surfaces one visible error, clears waiting state, and keeps retry in the same session", async () => {
    const { stdin, lastFrame, unmount, mockProc } = await setupApp();

    stdin.write("Recover after restart");
    await tick();
    stdin.write("\r");
    await tick(100);

    respond(mockProc, { id: 1, result: { thread: { id: "thr_disconnect_recovery" } } });
    await tick();
    respond(mockProc, {
      id: 2,
      result: {
        turn: { id: "turn_disconnect_recovery", status: "inProgress", items: [], error: null },
      },
    });
    await tick(100);

    await waitForFrame(lastFrame, (current) => current.includes("Waiting for response..."));

    mockProc.emit("exit", 1, null);
    await tick(150);

    const failureFrame = await waitForFrame(
      lastFrame,
      (current) =>
        current.includes("Error: Codex connection lost while waiting for a response.")
        && !current.includes("Waiting for response..."),
    );

    expect(countOccurrences(failureFrame, "Recover after restart")).toBe(1);
    expect(
      countOccurrences(
        failureFrame,
        "Error: Codex connection lost while waiting for a response.",
      ),
    ).toBe(1);

    stdin.write("Retry right away");
    await tick();
    await waitForFrame(lastFrame, (current) => current.includes("Retry right away"));

    unmount();
  });
});
