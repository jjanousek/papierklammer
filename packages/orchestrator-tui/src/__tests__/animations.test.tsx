import React from "react";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render } from "ink-testing-library";
import { MessageList } from "../components/MessageList.js";
import { InputBar } from "../components/InputBar.js";
import { AgentSidebar } from "../components/AgentSidebar.js";
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

// ── VAL-TUI-ANIM-001: Animated thinking spinner during response ──────

describe("VAL-TUI-ANIM-001: Animated thinking spinner during response", () => {
  it("shows Spinner component in MessageList when isThinking and no streaming text", () => {
    const { lastFrame, unmount } = render(
      <MessageList
        messages={[]}
        streamingText=""
        isThinking={true}
        pendingCommandItems={[]}
        isFocused={false}
      />,
    );
    const frame = lastFrame()!;
    // Spinner should render (mocked as "SPINNER")
    expect(frame).toContain("SPINNER");
    // Should still show "thinking..." text
    expect(frame).toContain("thinking...");
    // Should NOT contain the old static character pattern
    expect(frame).not.toContain("⠋ thinking");
    unmount();
  });

  it("shows Spinner component in InputBar when disabled", () => {
    const { lastFrame, unmount } = render(
      <InputBar disabled={true} />,
    );
    const frame = lastFrame()!;
    // Spinner should render (mocked as "SPINNER")
    expect(frame).toContain("SPINNER");
    // Should still show "Waiting for response..." text
    expect(frame).toContain("Waiting for response...");
    // Should NOT contain the old static character pattern
    expect(frame).not.toContain("⠋ Waiting");
    unmount();
  });

  it("does not show Spinner in MessageList when not thinking", () => {
    const { lastFrame, unmount } = render(
      <MessageList
        messages={[{ role: "user", text: "Hello", timestamp: new Date() }]}
        streamingText=""
        isThinking={false}
        pendingCommandItems={[]}
        isFocused={false}
      />,
    );
    const frame = lastFrame()!;
    expect(frame).not.toContain("SPINNER");
    expect(frame).not.toContain("thinking...");
    unmount();
  });

  it("does not show Spinner in InputBar when not disabled", () => {
    const { lastFrame, unmount } = render(
      <InputBar disabled={false} focused={true} />,
    );
    const frame = lastFrame()!;
    expect(frame).not.toContain("SPINNER");
    expect(frame).not.toContain("Waiting for response...");
    unmount();
  });
});

// ── VAL-TUI-ANIM-002: Agent running animation in sidebar ─────────────

describe("VAL-TUI-ANIM-002: Agent running animation in sidebar", () => {
  const agents: AgentOverview[] = [
    {
      agentId: "a1",
      name: "CEO",
      status: "idle",
      activeRunCount: 0,
      queuedIntentCount: 0,
    },
    {
      agentId: "a2",
      name: "Dev-1",
      status: "running",
      activeRunCount: 1,
      queuedIntentCount: 0,
    },
    {
      agentId: "a3",
      name: "QA",
      status: "error",
      activeRunCount: 0,
      queuedIntentCount: 0,
    },
  ];

  it("shows Spinner for running agents", () => {
    const { lastFrame, unmount } = render(
      <AgentSidebar agents={agents} />,
    );
    const frame = lastFrame()!;
    // Dev-1 is running — should show spinner
    expect(frame).toContain("SPINNER");
    unmount();
  });

  it("shows static ● indicator for idle agents", () => {
    const { lastFrame, unmount } = render(
      <AgentSidebar agents={[agents[0]!]} />,
    );
    const frame = lastFrame()!;
    // CEO is idle — should show static ● indicator
    expect(frame).toContain("●");
    // Should NOT show spinner for idle agent
    expect(frame).not.toContain("SPINNER");
    unmount();
  });

  it("shows static ● indicator for error agents", () => {
    const { lastFrame, unmount } = render(
      <AgentSidebar agents={[agents[2]!]} />,
    );
    const frame = lastFrame()!;
    // QA is error — should show static ● indicator
    expect(frame).toContain("●");
    expect(frame).not.toContain("SPINNER");
    unmount();
  });

  it("shows mixed indicators: spinner for running, static for others", () => {
    const { lastFrame, unmount } = render(
      <AgentSidebar agents={agents} />,
    );
    const frame = lastFrame()!;
    // Should have both SPINNER (for running) and ● (for idle/error)
    expect(frame).toContain("SPINNER");
    expect(frame).toContain("●");
    unmount();
  });
});

// ── VAL-TUI-ANIM-003: Thinking spinner stops when response completes ─

describe("VAL-TUI-ANIM-003: Thinking spinner stops when response completes", () => {
  it("spinner disappears when isThinking becomes false in MessageList", () => {
    // Render with isThinking=true
    const { lastFrame, rerender, unmount } = render(
      <MessageList
        messages={[]}
        streamingText=""
        isThinking={true}
        pendingCommandItems={[]}
        isFocused={false}
      />,
    );
    expect(lastFrame()).toContain("SPINNER");

    // Simulate turn completion: isThinking=false, message finalized
    rerender(
      <MessageList
        messages={[{ role: "assistant", text: "Hello! How can I help?", timestamp: new Date() }]}
        streamingText=""
        isThinking={false}
        pendingCommandItems={[]}
        isFocused={false}
      />,
    );
    const frame = lastFrame()!;
    expect(frame).not.toContain("SPINNER");
    expect(frame).not.toContain("thinking...");
    expect(frame).toContain("Hello! How can I help?");
    unmount();
  });

  it("InputBar spinner disappears when disabled becomes false", () => {
    const { lastFrame, rerender, unmount } = render(
      <InputBar disabled={true} />,
    );
    expect(lastFrame()).toContain("SPINNER");

    // Simulate turn completion: disabled=false
    rerender(
      <InputBar disabled={false} focused={true} />,
    );
    const frame = lastFrame()!;
    expect(frame).not.toContain("SPINNER");
    expect(frame).not.toContain("Waiting for response...");
    unmount();
  });

  it("App renders initial state without spinner (no thinking in progress)", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        agents: [],
        totalActiveRuns: 0,
        totalQueuedIntents: 0,
        totalActiveLeases: 0,
      }),
    });

    const { lastFrame, unmount } = render(
      <App
        url="http://localhost:3100"
        apiKey=""
        companyId="test-company"
        fetchFn={mockFetch}
        pollInterval={60000}
      />,
    );

    await new Promise((resolve) => setTimeout(resolve, 50));

    // Verify initial state has no spinner
    const frame = lastFrame()!;
    expect(frame).not.toContain("SPINNER");
    expect(frame).not.toContain("thinking...");

    unmount();
  });
});
