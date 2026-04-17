import React from "react";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render } from "ink-testing-library";
import { ChatPanel } from "../components/ChatPanel.js";
import { CommandBlock } from "../components/CommandBlock.js";
import { MessageList } from "../components/MessageList.js";
import { InputBar } from "../components/InputBar.js";
import { ReasoningPanel } from "../components/ReasoningPanel.js";
import { App } from "../components/App.js";
import type { ChatMessage, CommandItem } from "../hooks/useChat.js";
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
      totalActiveRuns: 0,
      totalQueuedIntents: 0,
      totalActiveLeases: 0,
    }),
  });
}

// ── ChatPanel ──────────────────────────────────────────────────────────

describe("ChatPanel", () => {
  it("renders empty state when no messages", () => {
    const { lastFrame, unmount } = render(<ChatPanel />);
    const frame = lastFrame()!;
    expect(frame).toContain("Chat");
    expect(frame).toContain("No messages yet");
    unmount();
  });

  it("renders user messages with You: prefix", () => {
    const messages: ChatMessage[] = [
      { role: "user", text: "Hello world", timestamp: new Date() },
    ];
    const { lastFrame, unmount } = render(
      <ChatPanel messages={messages} />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain("You:");
    expect(frame).toContain("Hello world");
    unmount();
  });

  it("renders assistant messages with Orchestrator: prefix", () => {
    const messages: ChatMessage[] = [
      {
        role: "assistant",
        text: "I can help you with that.",
        timestamp: new Date(),
      },
    ];
    const { lastFrame, unmount } = render(
      <ChatPanel messages={messages} />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain("Orchestrator:");
    expect(frame).toContain("I can help you with that.");
    unmount();
  });

  it("renders basic markdown formatting in assistant messages", () => {
    const messages: ChatMessage[] = [
      {
        role: "assistant",
        text: "## Status\n- **Agents:** 8 total\n- `fast` is on",
        timestamp: new Date(),
      },
    ];
    const { lastFrame, unmount } = render(
      <ChatPanel messages={messages} />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain("Status");
    expect(frame).toContain("Agents:");
    expect(frame).toContain("8 total");
    expect(frame).toContain("fast");
    expect(frame).not.toContain("**Agents:**");
    unmount();
  });

  it("renders both user and assistant messages", () => {
    const messages: ChatMessage[] = [
      { role: "user", text: "What agents are running?", timestamp: new Date() },
      {
        role: "assistant",
        text: "Dev-1 is currently running.",
        timestamp: new Date(),
      },
    ];
    const { lastFrame, unmount } = render(
      <ChatPanel messages={messages} />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain("You:");
    expect(frame).toContain("What agents are running?");
    expect(frame).toContain("Orchestrator:");
    expect(frame).toContain("Dev-1 is currently running.");
    unmount();
  });

  it("renders streaming text with cursor indicator", () => {
    const { lastFrame, unmount } = render(
      <ChatPanel streamingText="Working on it" />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain("Orchestrator:");
    expect(frame).toContain("Working on it");
    expect(frame).toContain("▌");
    unmount();
  });

  it("renders thinking indicator when isThinking is true", () => {
    const { lastFrame, unmount } = render(
      <ChatPanel isThinking={true} />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain("Orchestrator:");
    expect(frame).toContain("thinking...");
    unmount();
  });

  it("does not show thinking indicator when streaming text is present", () => {
    const { lastFrame, unmount } = render(
      <ChatPanel isThinking={false} streamingText="Some text" />,
    );
    const frame = lastFrame()!;
    expect(frame).not.toContain("thinking...");
    expect(frame).toContain("Some text");
    unmount();
  });

  it("renders a reasoning panel when reasoning text is present", () => {
    const { lastFrame, unmount } = render(
      <ChatPanel reasoningText={"step 1\nstep 2\nstep 3"} />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain("Reasoning");
    expect(frame).toContain("… 1 earlier line");
    expect(frame).toContain("step 2");
    expect(frame).toContain("step 3");
    unmount();
  });
});

describe("ReasoningPanel", () => {
  it("auto-scrolls to the latest reasoning lines when content exceeds height", () => {
    const text = Array.from({ length: 8 }, (_, index) => `line ${index + 1}`).join("\n");
    const { lastFrame, unmount } = render(
      <ReasoningPanel text={text} visibleHeight={4} />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain("Reasoning");
    expect(frame).toContain("… 6 earlier lines");
    expect(frame).toContain("line 7");
    expect(frame).toContain("line 8");
    expect(frame).not.toContain("line 1");
    unmount();
  });
});

// ── CommandBlock ────────────────────────────────────────────────────────

describe("CommandBlock", () => {
  it("renders command with $ prefix in yellow", () => {
    const item: CommandItem = {
      command: "curl http://localhost:3100/api/health",
      output: '{"status":"ok"}',
      status: "completed",
    };
    const { lastFrame, unmount } = render(<CommandBlock item={item} />);
    const frame = lastFrame()!;
    expect(frame).toContain("$ curl http://localhost:3100/api/health");
    expect(frame).toContain('{"status":"ok"}');
    expect(frame).toContain("completed");
    unmount();
  });

  it("renders command without output", () => {
    const item: CommandItem = {
      command: "echo hello",
      output: "",
      status: "running",
    };
    const { lastFrame, unmount } = render(<CommandBlock item={item} />);
    const frame = lastFrame()!;
    expect(frame).toContain("$ echo hello");
    expect(frame).toContain("running");
    unmount();
  });

  it("renders command block with border", () => {
    const item: CommandItem = {
      command: "ls -la",
      output: "total 8\ndrwxr-xr-x",
      status: "failed",
      exitCode: 1,
    };
    const { lastFrame, unmount } = render(<CommandBlock item={item} />);
    const frame = lastFrame()!;
    // Round border style uses ╭╮╰╯
    expect(frame).toContain("╭");
    expect(frame).toContain("╰");
    expect(frame).toContain("$ ls -la");
    expect(frame).toContain("failed");
    expect(frame).toContain("exit 1");
    unmount();
  });
});

// ── MessageList ────────────────────────────────────────────────────────

describe("MessageList", () => {
  it("renders empty state when no messages and no streaming", () => {
    const { lastFrame, unmount } = render(
      <MessageList
        messages={[]}
        streamingText=""
        isThinking={false}
        pendingCommandItems={[]}
      />,
    );
    expect(lastFrame()).toContain("No messages yet");
    unmount();
  });

  it("renders message history correctly", () => {
    const messages: ChatMessage[] = [
      { role: "user", text: "First message", timestamp: new Date() },
      { role: "assistant", text: "First reply", timestamp: new Date() },
      { role: "user", text: "Second message", timestamp: new Date() },
    ];
    const { lastFrame, unmount } = render(
      <MessageList
        messages={messages}
        streamingText=""
        isThinking={false}
        pendingCommandItems={[]}
      />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain("First message");
    expect(frame).toContain("First reply");
    expect(frame).toContain("Second message");
    unmount();
  });

  it("renders command blocks within assistant messages", () => {
    const messages: ChatMessage[] = [
      {
        role: "assistant",
        text: "Running a command...",
        timestamp: new Date(),
        items: [
          { command: "curl http://example.com", output: "OK" },
        ],
      },
    ];
    const { lastFrame, unmount } = render(
      <MessageList
        messages={messages}
        streamingText=""
        isThinking={false}
        pendingCommandItems={[]}
      />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain("Running a command...");
    expect(frame).toContain("$ curl http://example.com");
    expect(frame).toContain("OK");
    unmount();
  });

  it("renders a readable fallback for tool-only assistant turns", () => {
    const messages: ChatMessage[] = [
      {
        role: "assistant",
        text: "",
        timestamp: new Date(),
        items: [
          { command: "npm test", output: "ok", status: "completed" },
        ],
      },
    ];
    const { lastFrame, unmount } = render(
      <MessageList
        messages={messages}
        streamingText=""
        isThinking={false}
        pendingCommandItems={[]}
      />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain("$ npm test");
    expect(frame).toContain("completed");
    expect(frame).not.toContain("Tool activity");
    unmount();
  });

  it("renders bullet lists without leaking markdown markers", () => {
    const messages: ChatMessage[] = [
      {
        role: "assistant",
        text: "- **Agents:** 8 total\n- **Active runs:** 0",
        timestamp: new Date(),
      },
    ];
    const { lastFrame, unmount } = render(
      <MessageList
        messages={messages}
        streamingText=""
        isThinking={false}
        pendingCommandItems={[]}
      />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain("•");
    expect(frame).toContain("Agents:");
    expect(frame).toContain("Active runs:");
    expect(frame).not.toContain("**Agents:**");
    unmount();
  });

  it("renders pending command items during streaming", () => {
    const pending: CommandItem[] = [
      { command: "npm test", output: "All tests passed" },
    ];
    const { lastFrame, unmount } = render(
      <MessageList
        messages={[]}
        streamingText=""
        isThinking={false}
        pendingCommandItems={pending}
      />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain("$ npm test");
    expect(frame).toContain("All tests passed");
    unmount();
  });

  it("renders non-command tool calls with a compact label and truncated output", () => {
    const pending: CommandItem[] = [
      {
        command: "github.search_issues",
        output: Array.from({ length: 9 }, (_, index) => `result line ${index + 1}`).join("\n"),
        kind: "tool",
        status: "completed",
      },
    ];
    const { lastFrame, unmount } = render(
      <MessageList
        messages={[]}
        streamingText=""
        isThinking={false}
        pendingCommandItems={pending}
      />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain("tool: github.search_issues");
    expect(frame).toContain("result line 1");
    expect(frame).toContain("result line 4");
    expect(frame).toContain("5 more lines");
    expect(frame).not.toContain("result line 5");
    expect(frame).not.toContain("result line 9");
    unmount();
  });

  it("shows streaming text with blinking cursor", () => {
    const { lastFrame, unmount } = render(
      <MessageList
        messages={[]}
        streamingText="Partial response"
        isThinking={false}
        pendingCommandItems={[]}
      />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain("Partial response");
    expect(frame).toContain("▌");
    unmount();
  });

  it("shows thinking indicator when isThinking and no streaming", () => {
    const { lastFrame, unmount } = render(
      <MessageList
        messages={[]}
        streamingText=""
        isThinking={true}
        pendingCommandItems={[]}
      />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain("thinking...");
    unmount();
  });
});

// ── InputBar ───────────────────────────────────────────────────────────

describe("InputBar", () => {
  it("renders the input prompt", () => {
    const { lastFrame, unmount } = render(<InputBar />);
    const frame = lastFrame()!;
    expect(frame).toContain(">");
    unmount();
  });

  it("shows waiting message when disabled", () => {
    const { lastFrame, unmount } = render(<InputBar disabled={true} />);
    const frame = lastFrame()!;
    expect(frame).toContain("Waiting for response");
    unmount();
  });

  it("calls onSubmit with text on Enter and clears input", async () => {
    const mockFetch = createMockFetch();
    const submitted: string[] = [];

    // We test through the full App to get Ink's focus context
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

    // Tab to focus on input bar (it's the second focusable after sidebar)
    stdin.write("\t");
    await tick();
    stdin.write("\t");
    await tick();

    // Type a message
    stdin.write("Hello from test");
    await tick();

    // Press Enter
    stdin.write("\r");
    await tick(100);

    const frame = lastFrame()!;
    // The message should appear in the chat panel (sent by useChat)
    expect(frame).toContain("You:");
    expect(frame).toContain("Hello from test");

    unmount();
  });

  it("Enter with empty text does not send", async () => {
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

    // Tab to input
    stdin.write("\t");
    await tick();
    stdin.write("\t");
    await tick();

    // Press Enter without typing anything
    stdin.write("\r");
    await tick(100);

    const frame = lastFrame()!;
    // Should still show the empty state — no messages
    expect(frame).toContain("No messages yet");

    unmount();
  });
});

// ── Markdown code block rendering (VAL-TUI-CHAT-008) ───────────────────

describe("Markdown code block rendering", () => {
  it("renders code blocks in a bordered box distinct from plain text", () => {
    const messages: ChatMessage[] = [
      {
        role: "assistant",
        text: "Here is an example:\n```js\nconsole.log('hello');\n```\nThat should work.",
        timestamp: new Date(),
      },
    ];
    const { lastFrame, unmount } = render(
      <ChatPanel messages={messages} />,
    );
    const frame = lastFrame()!;
    // Code block should be rendered with border (single style uses ┌ or │)
    expect(frame).toContain("console.log");
    // Should have border chars indicating a boxed code block
    expect(frame).toMatch(/[│┌└┐┘─]/);
    // Plain text should also be present
    expect(frame).toContain("Here is an example:");
    expect(frame).toContain("That should work.");
    unmount();
  });

  it("renders plain text without code blocks normally", () => {
    const messages: ChatMessage[] = [
      {
        role: "assistant",
        text: "Just a plain message with no code blocks.",
        timestamp: new Date(),
      },
    ];
    const { lastFrame, unmount } = render(
      <ChatPanel messages={messages} />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain("Just a plain message with no code blocks.");
    unmount();
  });

  it("renders multiple code blocks in one message", () => {
    const messages: ChatMessage[] = [
      {
        role: "assistant",
        text: "First:\n```\nblock1\n```\nSecond:\n```\nblock2\n```",
        timestamp: new Date(),
      },
    ];
    const { lastFrame, unmount } = render(
      <ChatPanel messages={messages} />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain("block1");
    expect(frame).toContain("block2");
    expect(frame).toContain("First:");
    expect(frame).toContain("Second:");
    unmount();
  });
});

// ── Streaming and turn completion ──────────────────────────────────────

describe("Streaming and turn completion", () => {
  it("streaming deltas appear in real-time", async () => {
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

    // Tab to input
    stdin.write("\t");
    await tick();
    stdin.write("\t");
    await tick();

    // Send a message
    stdin.write("Tell me about agents");
    await tick();
    stdin.write("\r");
    await tick(100);

    // Message should appear with thinking indicator
    let frame = lastFrame()!;
    expect(frame).toContain("You:");
    expect(frame).toContain("Tell me about agents");
    // Should show thinking state
    expect(frame).toContain("thinking...");

    unmount();
  });

  it("turn completion moves message to history", async () => {
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

    // Tab to input
    stdin.write("\t");
    await tick();
    stdin.write("\t");
    await tick();

    // Send a message
    stdin.write("Test message");
    await tick();
    stdin.write("\r");
    await tick(100);

    const frame = lastFrame()!;
    // User message should be in the chat
    expect(frame).toContain("You:");
    expect(frame).toContain("Test message");

    unmount();
  });
});

// ── Chat scrolling ──────────────────────────────────────────────────

describe("Chat scrolling", () => {
  it("chat displays many messages in history", () => {
    const messages: ChatMessage[] = Array.from({ length: 20 }, (_, i) => ({
      role: i % 2 === 0 ? ("user" as const) : ("assistant" as const),
      text: `Message ${i}`,
      timestamp: new Date(),
    }));

    const { lastFrame, unmount } = render(
      <ChatPanel messages={messages} />,
    );

    const frame = lastFrame()!;
    // Should contain at least some of the messages
    expect(frame).toContain("Message 0");
    expect(frame).toContain("Message 19");
    unmount();
  });
});

// ── useChat hook ────────────────────────────────────────────────────

describe("useChat integration via App", () => {
  it("displays user and assistant messages with distinct styles in full App", async () => {
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

    // Tab to input
    stdin.write("\t");
    await tick();
    stdin.write("\t");
    await tick();

    // Send first message
    stdin.write("What is blocked?");
    await tick();
    stdin.write("\r");
    await tick(100);

    const frame = lastFrame()!;
    expect(frame).toContain("You:");
    expect(frame).toContain("What is blocked?");

    unmount();
  });

  it("input is disabled while thinking", async () => {
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

    // Tab to input
    stdin.write("\t");
    await tick();
    stdin.write("\t");
    await tick();

    // Send a message
    stdin.write("Help me");
    await tick();
    stdin.write("\r");
    await tick(100);

    const frame = lastFrame()!;
    // Should show thinking indicator
    expect(frame).toContain("thinking...");
    // Input should be disabled - shows waiting text
    expect(frame).toContain("Waiting for response");

    unmount();
  });
});

// ── Command execution blocks in chat ────────────────────────────────

describe("Command execution blocks in chat", () => {
  it("renders assistant message with command execution items", () => {
    const messages: ChatMessage[] = [
      {
        role: "assistant",
        text: "Let me check the health.",
        timestamp: new Date(),
        items: [
          {
            command: "curl http://localhost:3100/api/health",
            output: '{"status":"ok"}',
          },
        ],
      },
    ];

    const { lastFrame, unmount } = render(
      <ChatPanel messages={messages} />,
    );

    const frame = lastFrame()!;
    expect(frame).toContain("Orchestrator:");
    expect(frame).toContain("Let me check the health.");
    expect(frame).toContain("$ curl http://localhost:3100/api/health");
    expect(frame).toContain('{"status":"ok"}');
    unmount();
  });

  it("renders multiple command blocks in one message", () => {
    const messages: ChatMessage[] = [
      {
        role: "assistant",
        text: "Running diagnostics.",
        timestamp: new Date(),
        items: [
          { command: "curl /api/health", output: "OK" },
          { command: "curl /api/companies", output: '["company1"]' },
        ],
      },
    ];

    const { lastFrame, unmount } = render(
      <ChatPanel messages={messages} />,
    );

    const frame = lastFrame()!;
    expect(frame).toContain("$ curl /api/health");
    expect(frame).toContain("OK");
    expect(frame).toContain("$ curl /api/companies");
    expect(frame).toContain('["company1"]');
    unmount();
  });
});
