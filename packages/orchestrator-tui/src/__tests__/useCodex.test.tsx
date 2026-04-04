import React, { useEffect } from "react";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render } from "ink-testing-library";
import { Box, Text } from "ink";
import { EventEmitter, PassThrough } from "node:stream";
import { useCodex, type ConnectionState } from "../hooks/useCodex.js";
import type { DeltaParams, TurnCompletedParams } from "../codex/types.js";

// ── Test helpers ─────────────────────────────────────────────────────

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

const tick = (ms = 50) => new Promise((r) => setTimeout(r, ms));

// Suppress alternate screen buffer
beforeEach(() => {
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Test component ───────────────────────────────────────────────────

interface TestHarnessProps {
  mockProc: ReturnType<typeof createMockProcess>;
  onState?: (state: ConnectionState) => void;
  onDelta?: (params: DeltaParams) => void;
  onTurnCompleted?: (params: TurnCompletedParams) => void;
  onError?: (error: Error) => void;
  sendOnMount?: string;
  sendImmediately?: string;
  baseInstructions?: string;
}

function TestHarness({
  mockProc,
  onState,
  onDelta,
  onTurnCompleted,
  onError,
  sendOnMount,
  sendImmediately,
  baseInstructions,
}: TestHarnessProps): React.ReactElement {
  const spawnFn = vi.fn().mockReturnValue(mockProc);

  const { connectionState, isConnected, isThinking, threadId, sendMessage } = useCodex({
    spawnFn,
    autoReconnect: false,
    onDelta,
    onTurnCompleted,
    onError,
  });

  useEffect(() => {
    onState?.(connectionState);
  }, [connectionState, onState]);

  useEffect(() => {
    if (sendOnMount && isConnected && !isThinking) {
      void sendMessage(sendOnMount, baseInstructions);
    }
    // Only trigger once when connected
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected]);

  useEffect(() => {
    if (sendImmediately) {
      void sendMessage(sendImmediately, baseInstructions).catch(() => {});
    }
    // Only trigger on first mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Box flexDirection="column">
      <Text>state:{connectionState}</Text>
      <Text>connected:{String(isConnected)}</Text>
      <Text>thinking:{String(isThinking)}</Text>
      <Text>thread:{threadId ?? "none"}</Text>
    </Box>
  );
}

// ── Tests ────────────────────────────────────────────────────────────

describe("useCodex", () => {
  it("starts as disconnected and transitions to connected after initialize", async () => {
    const mockProc = createMockProcess();

    const { lastFrame, unmount } = render(
      <TestHarness mockProc={mockProc} />,
    );

    // Initially disconnected
    expect(lastFrame()).toContain("state:disconnected");

    // Respond to initialize
    await tick();
    respond(mockProc, { id: 0, result: { userAgent: "codex/0.117.0" } });
    await tick();

    expect(lastFrame()).toContain("state:connected");
    expect(lastFrame()).toContain("connected:true");

    unmount();
  });

  it("creates thread and sends message", async () => {
    const mockProc = createMockProcess();
    const deltas: string[] = [];

    const { lastFrame, unmount } = render(
      <TestHarness
        mockProc={mockProc}
        sendOnMount="Hello"
        baseInstructions="You are helpful."
        onDelta={(p) => deltas.push(p.delta)}
      />,
    );

    // Respond to initialize
    await tick();
    respond(mockProc, { id: 0, result: { userAgent: "codex/0.117.0" } });
    await tick(100);

    // Respond to thread/start
    respond(mockProc, { id: 1, result: { thread: { id: "thr_test123" } } });
    await tick(100);

    // Respond to turn/start
    respond(mockProc, {
      id: 2,
      result: { turn: { id: "turn_1", status: "inProgress", items: [], error: null } },
    });
    await tick(100);

    // Should now show thinking and threadId
    expect(lastFrame()).toContain("thinking:true");
    expect(lastFrame()).toContain("thread:thr_test123");

    // Stream a delta
    respond(mockProc, {
      method: "item/agentMessage/delta",
      params: { threadId: "thr_test123", turnId: "turn_1", itemId: "item_1", delta: "Hi there!" },
    });
    await tick();

    expect(deltas).toContain("Hi there!");

    // Turn completed
    respond(mockProc, {
      method: "turn/completed",
      params: { threadId: "thr_test123", turn: { id: "turn_1", status: "completed", items: [], error: null } },
    });
    await tick();

    expect(lastFrame()).toContain("state:connected");
    expect(lastFrame()).toContain("thinking:false");

    unmount();
  });

  it("waits for the initial initialize handshake when sending before startup settles", async () => {
    const mockProc = createMockProcess();
    const sentMessages: unknown[] = [];
    const errors: string[] = [];

    mockProc.stdin.on("data", (chunk: Buffer) => {
      const lines = chunk.toString().split("\n").filter(Boolean);
      for (const line of lines) {
        sentMessages.push(JSON.parse(line));
      }
    });

    const { lastFrame, unmount } = render(
      <TestHarness
        mockProc={mockProc}
        sendImmediately="Hello early"
        baseInstructions="You are helpful."
        onError={(error) => errors.push(error.message)}
      />,
    );

    await tick(100);

    expect(
      sentMessages.filter((message: any) => message.method === "initialize"),
    ).toHaveLength(1);

    respond(mockProc, { id: 0, result: { userAgent: "codex/0.117.0" } });
    await tick(100);

    respond(mockProc, { id: 1, result: { thread: { id: "thr_early" } } });
    await tick(100);

    respond(mockProc, {
      id: 2,
      result: { turn: { id: "turn_early", status: "inProgress", items: [], error: null } },
    });
    await tick(100);

    respond(mockProc, {
      method: "turn/completed",
      params: {
        threadId: "thr_early",
        turn: { id: "turn_early", status: "completed", items: [], error: null },
      },
    });
    await tick(100);

    expect(
      sentMessages.filter((message: any) => message.method === "thread/start"),
    ).toHaveLength(1);
    expect(
      sentMessages.filter((message: any) => message.method === "turn/start"),
    ).toHaveLength(1);
    expect(errors).toEqual([]);
    expect(lastFrame()).toContain("state:connected");
    expect(lastFrame()).toContain("thread:thr_early");

    unmount();
  });

  it("transitions to disconnected on subprocess exit", async () => {
    const mockProc = createMockProcess();
    const states: ConnectionState[] = [];

    const { lastFrame, unmount } = render(
      <TestHarness mockProc={mockProc} onState={(s) => states.push(s)} />,
    );

    // Respond to initialize
    await tick();
    respond(mockProc, { id: 0, result: { userAgent: "codex/0.117.0" } });
    await tick();

    expect(lastFrame()).toContain("state:connected");

    // Simulate process crash
    mockProc.emit("exit", 1, null);
    await tick();

    expect(lastFrame()).toContain("state:disconnected");

    unmount();
  });
});
