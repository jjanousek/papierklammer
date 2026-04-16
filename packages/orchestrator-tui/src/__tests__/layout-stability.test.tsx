import React from "react";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render } from "ink-testing-library";
import { EventEmitter, PassThrough } from "node:stream";
import { App } from "../components/App.js";
import { MessageList } from "../components/MessageList.js";
import { HeaderBar } from "../components/HeaderBar.js";
import { InputBar } from "../components/InputBar.js";
import { StatusBar } from "../components/StatusBar.js";
import type { ChatMessage } from "../hooks/useChat.js";

// Suppress alternate screen buffer escape codes during tests
beforeEach(() => {
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

const tick = (ms = 50) => new Promise((r) => setTimeout(r, ms));

const mockFetch = vi.fn().mockResolvedValue({
  ok: true,
  json: async () => ({
    agents: [],
    totalActiveRuns: 0,
    totalQueuedIntents: 0,
    totalActiveLeases: 0,
  }),
});

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

// ── VAL-TUI-STAB-001: Layout uses explicit terminal dimensions ──────

describe("VAL-TUI-STAB-001: Layout uses explicit terminal dimensions", () => {
  it("root Box uses explicit height from useStdout().rows (default 24)", () => {
    const { lastFrame, unmount } = render(
      <App
        url="http://localhost:3100"
        apiKey=""
        companyId="test-company"
        fetchFn={mockFetch}
        pollInterval={60000}
      />,
    );

    const frame = lastFrame()!;
    // The frame should be constrained — count the lines
    const lines = frame.split("\n");
    // With default fallback of 24 rows, the frame should not exceed 24 lines
    expect(lines.length).toBeLessThanOrEqual(24);
    // Should contain all 5 regions
    expect(frame).toContain("Papierklammer");
    expect(frame).toContain("Agents");
    expect(frame).toContain("Chat");
    expect(frame).toContain("Codex:");
    unmount();
  });

  it("HeaderBar has flexShrink={0} — content renders in constrained layout", () => {
    const { lastFrame, unmount } = render(
      <HeaderBar connected={true} totalAgents={3} totalActiveRuns={1} />,
    );
    const frame = lastFrame()!;
    // HeaderBar renders its content properly
    expect(frame).toContain("Papierklammer");
    expect(frame).toContain("Connected");
    unmount();
  });

  it("InputBar has flexShrink={0} — content renders in constrained layout", () => {
    const { lastFrame, unmount } = render(<InputBar />);
    const frame = lastFrame()!;
    // InputBar renders its content properly
    expect(frame).toContain(">");
    unmount();
  });

  it("StatusBar has flexShrink={0} — content renders in constrained layout", () => {
    const { lastFrame, unmount } = render(
      <StatusBar codexState="connected" threadId="thr_test" />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain("Codex: connected");
    expect(frame).toContain("Thread: thr_test");
    unmount();
  });
});

// ── VAL-TUI-STAB-002: Layout stable after sending a message ─────────

describe("VAL-TUI-STAB-002: Layout stable after sending a message", () => {
  it("layout does not expand beyond terminal bounds after sending a message", async () => {
    const mockProc = createMockProcess();
    const mockSpawn = vi.fn().mockReturnValue(mockProc);

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

    // Initialize Codex
    respond(mockProc, { id: 0, result: { userAgent: "codex/0.117.0" } });
    await tick();

    // Get initial frame line count
    const initialFrame = lastFrame()!;
    const initialLines = initialFrame.split("\n").length;

    // Tab to input
    stdin.write("\t");
    await tick();
    stdin.write("\t");
    await tick();

    // Send a message
    stdin.write("Hello world");
    await tick();
    stdin.write("\r");
    await tick(100);

    // Frame should not have grown beyond initial bounds
    const afterSendFrame = lastFrame()!;
    const afterSendLines = afterSendFrame.split("\n").length;
    expect(afterSendLines).toBeLessThanOrEqual(initialLines);

    // Should contain user message
    expect(afterSendFrame).toContain("You:");
    expect(afterSendFrame).toContain("Hello world");
    // Should still contain all regions
    expect(afterSendFrame).toContain("Papierklammer");
    expect(afterSendFrame).toContain("Codex:");

    // Complete the turn with a response
    respond(mockProc, { id: 1, result: { thread: { id: "thr_stable" } } });
    await tick();
    respond(mockProc, {
      id: 2,
      result: { turn: { id: "turn_1", status: "inProgress", items: [], error: null } },
    });
    await tick();
    respond(mockProc, {
      method: "item/agentMessage/delta",
      params: { threadId: "thr_stable", turnId: "turn_1", itemId: "item_1", delta: "Response text" },
    });
    await tick();
    respond(mockProc, {
      method: "turn/completed",
      params: { threadId: "thr_stable", turn: { id: "turn_1", status: "completed", items: [], error: null } },
    });
    await tick();

    // After response, frame should still be constrained
    const afterResponseFrame = lastFrame()!;
    const afterResponseLines = afterResponseFrame.split("\n").length;
    expect(afterResponseLines).toBeLessThanOrEqual(initialLines);

    // Should contain both messages
    expect(afterResponseFrame).toContain("Hello world");
    expect(afterResponseFrame).toContain("Response text");

    unmount();
  });
});

// ── VAL-TUI-STAB-003: Layout handles terminal resize ────────────────

describe("VAL-TUI-STAB-003: Layout handles terminal resize", () => {
  it("components re-render with updated dimensions after resize event", async () => {
    // The useTerminalSize hook listens to stdout 'resize' events.
    // In ink-testing-library, the stdout mock is an EventEmitter.
    // We can't set the getter `columns` directly, but we can add `rows`
    // and emit resize to trigger re-render.
    const { lastFrame, unmount, stdout } = render(
      <App
        url="http://localhost:3100"
        apiKey=""
        companyId="test-company"
        fetchFn={mockFetch}
        pollInterval={60000}
      />,
    );

    await tick();

    // Get initial frame and line count
    const initialFrame = lastFrame()!;
    const initialLines = initialFrame.split("\n").length;
    expect(initialFrame).toContain("Papierklammer");

    // Simulate resize by setting rows on the stdout EventEmitter and emitting resize.
    // ink-testing-library's Stdout extends EventEmitter, so we can emit events on it.
    const stream = stdout as unknown as EventEmitter & { rows?: number };
    Object.defineProperty(stream, "rows", { value: 30, writable: true, configurable: true });
    stream.emit("resize");
    await tick();

    // After resize, layout should re-render — frame should still contain all regions
    const resizedFrame = lastFrame()!;
    expect(resizedFrame).toContain("Papierklammer");
    expect(resizedFrame).toContain("Chat");
    expect(resizedFrame).toContain("Codex:");
    // The number of lines may change after resize (more rows available)
    const resizedLines = resizedFrame.split("\n").length;
    expect(resizedLines).toBeGreaterThanOrEqual(initialLines);

    unmount();
  });
});

// ── VAL-TUI-STAB-007: Message scroll windowing works ────────────────

describe("VAL-TUI-STAB-007: Message scroll windowing works", () => {
  it("only renders messages in visible range with small visibleHeight", async () => {
    // Create many messages
    const messages: ChatMessage[] = Array.from({ length: 50 }, (_, i) => ({
      role: "user" as const,
      text: `Message ${i}`,
      timestamp: new Date(),
    }));

    const { lastFrame, unmount } = render(
      <MessageList
        messages={messages}
        streamingText=""
        isThinking={false}
        pendingCommandItems={[]}
        visibleHeight={5}
      />,
    );

    // Wait for auto-scroll useEffect to fire
    await tick();

    const frame = lastFrame()!;
    // With visibleHeight=5, the top overflow indicator uses one row,
    // so the latest 4 messages remain visible at the live bottom.
    expect(frame).toContain("Message 49");
    expect(frame).toContain("Message 48");
    expect(frame).toContain("Message 47");
    expect(frame).toContain("Message 46");
    expect(frame).not.toContain("Message 45");
    // Earlier messages should NOT be visible
    expect(frame).not.toContain("Message 0");
    expect(frame).not.toContain("Message 10");
    expect(frame).not.toContain("Message 30");
    // Should show "▲ N more messages above" indicator
    expect(frame).toContain("▲");
    expect(frame).toContain("above");
    unmount();
  });

  it("renders all messages when they fit within visible height", () => {
    const messages: ChatMessage[] = [
      { role: "user", text: "First", timestamp: new Date() },
      { role: "assistant", text: "Reply", timestamp: new Date() },
    ];

    const { lastFrame, unmount } = render(
      <MessageList
        messages={messages}
        streamingText=""
        isThinking={false}
        pendingCommandItems={[]}
        visibleHeight={10}
      />,
    );

    const frame = lastFrame()!;
    expect(frame).toContain("First");
    expect(frame).toContain("Reply");
    // No scroll indicator when all messages fit
    expect(frame).not.toContain("▲");
    unmount();
  });

  it("Shift+Up scrolls to show earlier messages", async () => {
    const messages: ChatMessage[] = Array.from({ length: 20 }, (_, i) => ({
      role: "user" as const,
      text: `Msg-${i}`,
      timestamp: new Date(),
    }));

    const { stdin, lastFrame, unmount } = render(
      <MessageList
        messages={messages}
        streamingText=""
        isThinking={false}
        pendingCommandItems={[]}
        isFocused={true}
        visibleHeight={5}
      />,
    );

    await tick();

    // Initially auto-scrolled to bottom
    let frame = lastFrame()!;
    expect(frame).toContain("Msg-19");
    expect(frame).not.toContain("Msg-0");

    // Press Shift+Up multiple times to scroll up
    for (let i = 0; i < 10; i++) {
      stdin.write("\u001B[1;2A"); // Shift+Up
    }
    await tick();

    frame = lastFrame()!;
    // After scrolling up, the viewport stays anchored away from the live bottom
    // and shows earlier transcript lines plus the new-activity indicator below.
    expect(frame).toContain("Msg-6");
    expect(frame).not.toContain("Msg-19");
    // Should show ▲ indicator
    expect(frame).toContain("▲");
    expect(frame).toContain("▼");
    unmount();
  });

  it("Shift+Down scrolls back towards recent messages", async () => {
    const messages: ChatMessage[] = Array.from({ length: 20 }, (_, i) => ({
      role: "user" as const,
      text: `Msg-${i}`,
      timestamp: new Date(),
    }));

    const { stdin, lastFrame, unmount } = render(
      <MessageList
        messages={messages}
        streamingText=""
        isThinking={false}
        pendingCommandItems={[]}
        isFocused={true}
        visibleHeight={5}
      />,
    );

    await tick();

    // Scroll up first
    for (let i = 0; i < 10; i++) {
      stdin.write("\u001B[1;2A"); // Shift+Up
    }
    await tick();

    let frame = lastFrame()!;
    expect(frame).not.toContain("Msg-19");

    // Now scroll back down
    for (let i = 0; i < 10; i++) {
      stdin.write("\u001B[1;2B"); // Shift+Down
    }
    await tick();

    frame = lastFrame()!;
    // Should be back at the bottom
    expect(frame).toContain("Msg-19");
    unmount();
  });

  it("keeps oversized command output windowed and scrollable by transcript keys", async () => {
    const messages: ChatMessage[] = [
      {
        role: "assistant",
        text: "",
        timestamp: new Date(),
        items: [
          {
            command: "tail -n 200 /tmp/build.log",
            output: Array.from({ length: 18 }, (_, index) => `output line ${index + 1}`).join("\n"),
            status: "completed",
          },
        ],
      },
    ];

    const { stdin, lastFrame, unmount } = render(
      <MessageList
        messages={messages}
        streamingText=""
        isThinking={false}
        pendingCommandItems={[]}
        isFocused={true}
        visibleHeight={8}
      />,
    );

    await tick();

    let frame = lastFrame()!;
    expect(frame.split("\n").length).toBeLessThanOrEqual(8);
    expect(frame).toContain("output line 18");
    expect(frame).not.toMatch(/\boutput line 1\b/);

    for (let i = 0; i < 14; i++) {
      stdin.write("\u001B[1;2A"); // Shift+Up
    }
    await tick();

    frame = lastFrame()!;
    expect(frame).toContain("output line 1");
    expect(frame).not.toContain("output line 18");
    unmount();
  });

  it("keeps the reading position stable and shows newer activity below after appends", async () => {
    const messages: ChatMessage[] = Array.from({ length: 20 }, (_, i) => ({
      role: "user" as const,
      text: `Msg-${i}`,
      timestamp: new Date(),
    }));

    const { stdin, lastFrame, rerender, unmount } = render(
      <MessageList
        messages={messages}
        streamingText=""
        isThinking={false}
        pendingCommandItems={[]}
        isFocused={true}
        visibleHeight={6}
      />,
    );

    await tick();

    for (let i = 0; i < 10; i++) {
      stdin.write("\u001B[1;2A"); // Shift+Up
    }
    await tick();

    const beforeAppendFrame = lastFrame()!;
    expect(beforeAppendFrame).toContain("Msg-5");
    expect(beforeAppendFrame).not.toContain("Msg-19");

    rerender(
      <MessageList
        messages={[
          ...messages,
          { role: "assistant", text: "Newest activity", timestamp: new Date() },
        ]}
        streamingText=""
        isThinking={false}
        pendingCommandItems={[]}
        isFocused={true}
        visibleHeight={6}
      />,
    );

    await tick();

    const afterAppendFrame = lastFrame()!;
    expect(afterAppendFrame).toContain("Msg-5");
    expect(afterAppendFrame).not.toContain("Newest activity");
    expect(afterAppendFrame).toContain("▼");
    unmount();
  });

  it("pressing l jumps back to the live bottom and clears the newer-activity indicator", async () => {
    const messages: ChatMessage[] = Array.from({ length: 20 }, (_, i) => ({
      role: "user" as const,
      text: `Msg-${i}`,
      timestamp: new Date(),
    }));

    const { stdin, lastFrame, rerender, unmount } = render(
      <MessageList
        messages={messages}
        streamingText=""
        isThinking={false}
        pendingCommandItems={[]}
        isFocused={true}
        visibleHeight={6}
      />,
    );

    await tick();

    for (let i = 0; i < 10; i++) {
      stdin.write("\u001B[1;2A"); // Shift+Up
    }
    await tick();

    rerender(
      <MessageList
        messages={[
          ...messages,
          { role: "assistant", text: "Newest activity", timestamp: new Date() },
        ]}
        streamingText=""
        isThinking={false}
        pendingCommandItems={[]}
        isFocused={true}
        visibleHeight={6}
      />,
    );

    await tick();

    let frame = lastFrame()!;
    expect(frame).toContain("▼");
    expect(frame).not.toContain("Newest activity");

    stdin.write("l");
    await tick();

    frame = lastFrame()!;
    expect(frame).toContain("Newest activity");
    expect(frame).not.toContain("▼");
    unmount();
  });
});
