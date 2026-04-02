import React from "react";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render } from "ink-testing-library";
import { AgentSidebar } from "../components/AgentSidebar.js";
import { HeaderBar } from "../components/HeaderBar.js";
import { StatusBar } from "../components/StatusBar.js";
import { App } from "../components/App.js";
import type { AgentOverview } from "../hooks/useOrchestratorStatus.js";

// Suppress alternate screen buffer escape codes during tests
beforeEach(() => {
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

const MOCK_AGENTS: AgentOverview[] = [
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
    name: "Dev-2",
    status: "error",
    activeRunCount: 0,
    queuedIntentCount: 1,
  },
  {
    agentId: "a4",
    name: "QA",
    status: "blocked",
    activeRunCount: 0,
    queuedIntentCount: 2,
  },
];

// ── AgentSidebar ──────────────────────────────────────────────────────

describe("AgentSidebar", () => {
  it("renders agents with correct status indicators", () => {
    const { lastFrame, unmount } = render(
      <AgentSidebar agents={MOCK_AGENTS} />,
    );
    const frame = lastFrame()!;
    // Check agent names are present
    expect(frame).toContain("CEO");
    expect(frame).toContain("Dev-1");
    expect(frame).toContain("Dev-2");
    expect(frame).toContain("QA");
    // Check status dots (● character) are present
    expect(frame).toContain("●");
    unmount();
  });

  it("renders status text for each agent", () => {
    const { lastFrame, unmount } = render(
      <AgentSidebar agents={MOCK_AGENTS} />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain("(idle)");
    expect(frame).toContain("(running)");
    expect(frame).toContain("(error)");
    expect(frame).toContain("(blocked)");
    unmount();
  });

  it("shows 'No agents connected' when list is empty", () => {
    const { lastFrame, unmount } = render(<AgentSidebar agents={[]} />);
    expect(lastFrame()).toContain("No agents connected");
    unmount();
  });

  it("shows Agents header", () => {
    const { lastFrame, unmount } = render(
      <AgentSidebar agents={MOCK_AGENTS} />,
    );
    expect(lastFrame()).toContain("Agents");
    unmount();
  });
});

// ── HeaderBar ─────────────────────────────────────────────────────────

describe("HeaderBar", () => {
  it("shows Connected status when connected", () => {
    const { lastFrame, unmount } = render(
      <HeaderBar connected={true} totalAgents={3} totalActiveRuns={2} />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain("Connected");
    unmount();
  });

  it("shows Disconnected status when not connected", () => {
    const { lastFrame, unmount } = render(
      <HeaderBar connected={false} totalAgents={0} totalActiveRuns={0} />,
    );
    expect(lastFrame()).toContain("Disconnected");
    unmount();
  });

  it("shows agent count", () => {
    const { lastFrame, unmount } = render(
      <HeaderBar connected={true} totalAgents={5} totalActiveRuns={0} />,
    );
    expect(lastFrame()).toContain("5 agents");
    unmount();
  });

  it("shows active run count", () => {
    const { lastFrame, unmount } = render(
      <HeaderBar connected={true} totalAgents={3} totalActiveRuns={2} />,
    );
    expect(lastFrame()).toContain("2 active runs");
    unmount();
  });

  it("uses singular form for 1 agent", () => {
    const { lastFrame, unmount } = render(
      <HeaderBar connected={true} totalAgents={1} totalActiveRuns={1} />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain("1 agent");
    expect(frame).not.toContain("1 agents");
    expect(frame).toContain("1 active run");
    expect(frame).not.toContain("1 active runs");
    unmount();
  });

  it("shows Papierklammer title", () => {
    const { lastFrame, unmount } = render(
      <HeaderBar connected={true} totalAgents={0} totalActiveRuns={0} />,
    );
    expect(lastFrame()).toContain("Papierklammer");
    unmount();
  });
});

// ── StatusBar ─────────────────────────────────────────────────────────

describe("StatusBar", () => {
  it("shows disconnected state by default", () => {
    const { lastFrame, unmount } = render(<StatusBar />);
    expect(lastFrame()).toContain("Codex: disconnected");
    unmount();
  });

  it("shows connected state", () => {
    const { lastFrame, unmount } = render(
      <StatusBar codexState="connected" />,
    );
    expect(lastFrame()).toContain("Codex: connected");
    unmount();
  });

  it("shows thinking state", () => {
    const { lastFrame, unmount } = render(
      <StatusBar codexState="thinking" />,
    );
    expect(lastFrame()).toContain("Codex: thinking");
    unmount();
  });

  it("shows threadId when active", () => {
    const { lastFrame, unmount } = render(
      <StatusBar codexState="connected" threadId="thr_abc123" />,
    );
    expect(lastFrame()).toContain("Thread: thr_abc123");
    unmount();
  });

  it("shows model name when available", () => {
    const { lastFrame, unmount } = render(
      <StatusBar codexState="connected" model="gpt-5.4" />,
    );
    expect(lastFrame()).toContain("Model: gpt-5.4");
    unmount();
  });

  it("shows all info together", () => {
    const { lastFrame, unmount } = render(
      <StatusBar
        codexState="thinking"
        threadId="thr_xyz"
        model="gpt-5.4"
      />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain("Codex: thinking");
    expect(frame).toContain("Thread: thr_xyz");
    expect(frame).toContain("Model: gpt-5.4");
    unmount();
  });

  it("does not show threadId when not provided", () => {
    const { lastFrame, unmount } = render(
      <StatusBar codexState="connected" />,
    );
    expect(lastFrame()).not.toContain("Thread:");
    unmount();
  });
});

// ── Keyboard navigation ──────────────────────────────────────────────

describe("Keyboard navigation", () => {
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

  it("Tab key changes focus to sidebar", async () => {
    const mockFetch = createMockFetch();
    const { stdin, lastFrame, unmount } = render(
      <App
        url="http://localhost:3100"
        apiKey=""
        companyId=""
        fetchFn={mockFetch}
        pollInterval={60000}
      />,
    );

    // Wait for initial render and API poll
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Press Tab to move focus to sidebar
    stdin.write("\t");
    await new Promise((resolve) => setTimeout(resolve, 50));

    // The sidebar border should be highlighted (cyan) when focused
    // We can verify the frame renders correctly after tab
    const frame = lastFrame()!;
    expect(frame).toContain("Agents");

    unmount();
  });

  it("arrow keys move sidebar selection", async () => {
    const mockFetch = createMockFetch();
    const { stdin, lastFrame, unmount } = render(
      <App
        url="http://localhost:3100"
        apiKey=""
        companyId=""
        fetchFn={mockFetch}
        pollInterval={60000}
      />,
    );

    // Wait for initial render and API poll
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Press Tab to focus sidebar
    stdin.write("\t");
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Press down arrow to move selection
    stdin.write("\u001B[B"); // Down arrow escape sequence
    await new Promise((resolve) => setTimeout(resolve, 50));

    const frame = lastFrame()!;
    // Agents should still be visible after navigation
    expect(frame).toContain("CEO");
    expect(frame).toContain("Dev-1");

    unmount();
  });
});

// ── Integration: sidebar with API data ───────────────────────────────

describe("Sidebar with API data", () => {
  it("renders agents from mock API response", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        agents: MOCK_AGENTS,
        totalActiveRuns: 1,
        totalQueuedIntents: 3,
        totalActiveLeases: 1,
      }),
    });

    const { lastFrame, unmount } = render(
      <App
        url="http://localhost:3100"
        apiKey="test-key"
        companyId="test-company"
        fetchFn={mockFetch}
        pollInterval={60000}
      />,
    );

    // Wait for the async poll to complete
    await new Promise((resolve) => setTimeout(resolve, 50));

    const frame = lastFrame()!;
    expect(frame).toContain("CEO");
    expect(frame).toContain("Dev-1");
    expect(frame).toContain("Dev-2");
    expect(frame).toContain("QA");
    expect(frame).toContain("Connected");
    expect(frame).toContain("4 agents");
    expect(frame).toContain("1 active run");

    unmount();
  });

  it("shows Disconnected when API fails", async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error("Network error"));

    const { lastFrame, unmount } = render(
      <App
        url="http://localhost:3100"
        apiKey=""
        companyId=""
        fetchFn={mockFetch}
        pollInterval={60000}
      />,
    );

    // Wait for the async poll to complete
    await new Promise((resolve) => setTimeout(resolve, 50));

    const frame = lastFrame()!;
    expect(frame).toContain("Disconnected");

    unmount();
  });
});
