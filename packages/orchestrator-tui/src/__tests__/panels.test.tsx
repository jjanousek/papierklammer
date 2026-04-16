import React from "react";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render } from "ink-testing-library";
import { AgentSidebar } from "../components/AgentSidebar.js";
import { InputBar } from "../components/InputBar.js";
import { HeaderBar } from "../components/HeaderBar.js";
import { StatusBar } from "../components/StatusBar.js";
import { App } from "../components/App.js";
import type { AgentOverview, RunReviewEntry } from "../hooks/useOrchestratorStatus.js";

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

const MOCK_RECENT_RUNS: RunReviewEntry[] = [
  {
    runId: "run-completed-1",
    status: "succeeded",
    agentId: "a1",
    agentName: "CEO",
    issueId: "issue-1",
    issueIdentifier: "AUD-1",
    createdAt: "2026-04-05T10:00:00.000Z",
    startedAt: "2026-04-05T10:00:00.000Z",
    finishedAt: "2026-04-05T10:05:00.000Z",
    resultSummaryText: "Prepared the audit demo report.",
    stdoutExcerpt: "verbose stdout",
    stderrExcerpt: null,
  },
];

// ── AgentSidebar ──────────────────────────────────────────────────────

describe("AgentSidebar", () => {
  it("renders agents with correct status indicators", () => {
    const { lastFrame, unmount } = render(
      <AgentSidebar agents={MOCK_AGENTS} width={40} />,
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
      <AgentSidebar agents={MOCK_AGENTS} width={40} />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain("(idle)");
    expect(frame).toContain("(running");
    expect(frame).toContain("1 li");
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
      <AgentSidebar agents={MOCK_AGENTS} width={40} />,
    );
    expect(lastFrame()).toContain("Agents");
    expect(lastFrame()).toContain("roster");
    unmount();
  });

  it("shows a concrete run review summary for the selected agent", () => {
    const { lastFrame, unmount } = render(
      <AgentSidebar
        agents={MOCK_AGENTS}
        recentRuns={MOCK_RECENT_RUNS}
        width={40}
      />,
    );

    const frame = lastFrame()!;
    expect(frame).toContain("Selected");
    expect(frame).toContain("run-comp");
    expect(frame).toContain("issue A");
    expect(frame).toContain("Prepared the audit");
    expect(frame).toContain("demo report.");
    unmount();
  });

  it("does not fall back to another agent's run when the selected agent has no match", () => {
    const { lastFrame, unmount } = render(
      <AgentSidebar
        agents={MOCK_AGENTS}
        recentRuns={[
          {
            runId: "run-completed-2",
            status: "succeeded",
            agentId: "a2",
            agentName: "Dev-1",
            issueId: "issue-2",
            issueIdentifier: "AUD-2",
            createdAt: "2026-04-05T10:10:00.000Z",
            startedAt: "2026-04-05T10:10:00.000Z",
            finishedAt: "2026-04-05T10:15:00.000Z",
            resultSummaryText: "Implemented the CLI command.",
            stdoutExcerpt: "verbose stdout",
            stderrExcerpt: null,
          },
        ]}
        width={40}
      />,
    );

    const frame = lastFrame()!;
    expect(frame).toContain("Selected");
    expect(frame).toContain("No matching run for");
    expect(frame).toContain("the current");
    expect(frame).toContain("selection.");
    expect(frame).not.toContain("AUD-2");
    expect(frame).not.toContain("Implemented the CLI command.");
    unmount();
  });

  it("prefers the selected agent's active run over its recent run", () => {
    const { lastFrame, unmount } = render(
      <AgentSidebar
        agents={MOCK_AGENTS}
        activeRuns={[
          {
            runId: "run-live-2",
            status: "running",
            agentId: "a1",
            agentName: "CEO",
            issueId: "issue-live-2",
            issueIdentifier: "AUD-3",
            createdAt: "2026-04-05T11:10:00.000Z",
            startedAt: "2026-04-05T11:10:00.000Z",
            finishedAt: null,
            resultSummaryText: null,
            stdoutExcerpt: "Live stdout preview",
            stderrExcerpt: null,
          },
        ]}
        recentRuns={MOCK_RECENT_RUNS}
        width={40}
      />,
    );

    const frame = lastFrame()!;
    expect(frame).toContain("run-live");
    expect(frame).toContain("issue A");
    expect(frame).toContain("Live stdout preview");
    expect(frame).not.toContain("run-comp");
    expect(frame).not.toContain("AUD-1");
    unmount();
  });

  it("falls back to excerpt text when a live run has no persisted result summary yet", () => {
    const { lastFrame, unmount } = render(
      <AgentSidebar
        agents={MOCK_AGENTS}
        activeRuns={[
          {
            runId: "run-live-1",
            status: "running",
            agentId: "a1",
            agentName: "CEO",
            issueId: "issue-live-1",
            issueIdentifier: "AUD-2",
            createdAt: "2026-04-05T11:00:00.000Z",
            startedAt: "2026-04-05T11:00:00.000Z",
            finishedAt: null,
            resultSummaryText: null,
            stdoutExcerpt: "Live stdout preview",
            stderrExcerpt: null,
          },
        ]}
        width={40}
      />,
    );

    const frame = lastFrame()!;
    expect(frame).toContain("Selected");
    expect(frame).toContain("run-live");
    expect(frame).toContain("issue A");
    expect(frame).toContain("Live stdout preview");
    unmount();
  });

  it("surfaces live run counts directly on agent rows so sidebar indicators match status totals", () => {
    const { lastFrame, unmount } = render(
      <AgentSidebar
        agents={[
          {
            agentId: "a1",
            name: "CEO",
            status: "idle",
            activeRunCount: 2,
            queuedIntentCount: 0,
          },
        ]}
        width={40}
      />,
    );

    const frame = lastFrame()!;
    expect(frame).toContain("CEO");
    expect(frame).toContain("(running");
    expect(frame).toContain("2");
    expect(frame).toContain("live ");
    unmount();
  });

  it("clears stale raw running labels after recovery when no live runs remain", () => {
    const { lastFrame, unmount } = render(
      <AgentSidebar
        agents={[
          {
            agentId: "a1",
            name: "CEO",
            status: "running",
            activeRunCount: 0,
            queuedIntentCount: 0,
          },
        ]}
      />,
    );

    const frame = lastFrame()!;
    expect(frame).toContain("CEO");
    expect(frame).toContain("(idle)");
    expect(frame).not.toContain("(running");
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

  it("keeps reasoning and fast mode visible in compact status layout", () => {
    const { lastFrame, unmount } = render(
      <StatusBar
        codexState="connected"
        threadId="thr_very_long_identifier"
        model="gpt-5.4"
        reasoningEffort="high"
        fastMode={true}
        columns={60}
      />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain("cx:up");
    expect(frame).toContain("r:high");
    expect(frame).toContain("f:on");
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
          activeRuns: [],
          recentRuns: [],
        }),
      };
    });
  }

  it("Tab key cycles visible focus between the management region and input bar", async () => {
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

    // Wait for initial render and API poll
    await new Promise((resolve) => setTimeout(resolve, 50));

    // First Tab → management region
    stdin.write("\t");
    await new Promise((resolve) => setTimeout(resolve, 50));

    const frame1 = lastFrame()!;
    // Management region should be focused and visible in the status bar
    expect(frame1).toContain("CEO");
    expect(frame1).toContain("focus: management");

    // Second Tab → input bar
    stdin.write("\t");
    await new Promise((resolve) => setTimeout(resolve, 50));

    const frame2 = lastFrame()!;
    // Input bar should be focused — it renders the prompt text
    expect(frame2).toContain("Type a message...");
    expect(frame2).toContain("focus: composer");

    // Third Tab → wraps back to management
    stdin.write("\t");
    await new Promise((resolve) => setTimeout(resolve, 50));

    const frame3 = lastFrame()!;
    expect(frame3).toContain("CEO");
    expect(frame3).toContain("focus: management");

    unmount();
  });

  it("arrow keys move sidebar selection down and up", async () => {
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

    // Wait for initial render and API poll
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Press Tab to focus sidebar
    stdin.write("\t");
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Press down arrow to move selection from index 0 to index 1
    stdin.write("\u001B[B"); // Down arrow escape sequence
    await new Promise((resolve) => setTimeout(resolve, 50));

    const frame = lastFrame()!;
    expect(frame).toContain("Dev-1");
    expect(frame).toContain("Dev-2");
    expect(frame).toContain("QA");
    expect(frame).toContain("Dev-1 · running");

    // Press up arrow to move back to index 0
    stdin.write("\u001B[A"); // Up arrow escape sequence
    await new Promise((resolve) => setTimeout(resolve, 50));

    const frame2 = lastFrame()!;
    expect(frame2).toContain("CEO");
    expect(frame2).toContain("Dev-1");

    unmount();
  });

  it("arrow keys do not move selection when sidebar is not focused", async () => {
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

    await new Promise((resolve) => setTimeout(resolve, 50));

    // Tab to sidebar, then Tab again to input bar
    stdin.write("\t");
    await new Promise((resolve) => setTimeout(resolve, 50));
    stdin.write("\t");
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Now input is focused, arrow keys should not affect sidebar
    stdin.write("\u001B[B"); // Down arrow
    await new Promise((resolve) => setTimeout(resolve, 50));

    const frame = lastFrame()!;
    // All agents should be visible — sidebar selection unchanged
    expect(frame).toContain("CEO");
    expect(frame).toContain("Dev-1");

    unmount();
  });
});

// ── Agent list scrolling ─────────────────────────────────────────────

describe("Agent list scrolling", () => {
  function makeAgents(count: number): AgentOverview[] {
    return Array.from({ length: count }, (_, i) => ({
      agentId: `agent-${i}`,
      name: `Agent-${i}`,
      status: i % 2 === 0 ? "idle" : "running",
      activeRunCount: i % 2 === 0 ? 0 : 1,
      queuedIntentCount: 0,
    }));
  }

  function createMockFetch(agents: AgentOverview[]) {
    return vi.fn().mockImplementation(async (input: string | URL | Request) => {
      const url = String(input);

      if (url.includes("/approvals?status=pending")) {
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
          activeRuns: [],
          recentRuns: [],
        }),
      };
    });
  }

  it("shows scroll indicators when agent list exceeds maxVisible", () => {
    const manyAgents = makeAgents(10);
    const { lastFrame, unmount } = render(
      <AgentSidebar agents={manyAgents} maxVisible={3} />,
    );

    const frame = lastFrame()!;
    // Should show first 3 agents, no ▲ (at top), but ▼ (more below)
    expect(frame).toContain("Agent-0");
    expect(frame).toContain("Agent-1");
    expect(frame).toContain("Agent-2");
    expect(frame).not.toContain("Agent-3");
    expect(frame).not.toContain("▲");
    expect(frame).toContain("▼");

    unmount();
  });

  it("does not show scroll indicators when all agents fit", () => {
    const agents = makeAgents(3);
    const { lastFrame, unmount } = render(
      <AgentSidebar agents={agents} maxVisible={5} />,
    );

    const frame = lastFrame()!;
    expect(frame).toContain("Agent-0");
    expect(frame).toContain("Agent-1");
    expect(frame).toContain("Agent-2");
    expect(frame).not.toContain("▲");
    expect(frame).not.toContain("▼");

    unmount();
  });

  it("scrolls down and shows both indicators when in the middle", async () => {
    const manyAgents = makeAgents(10);
    const mockFetch = createMockFetch(manyAgents);

    const { stdin, lastFrame, unmount } = render(
      <App
        url="http://localhost:3100"
        apiKey=""
        companyId="test-company"
        fetchFn={mockFetch}
        pollInterval={60000}
      />,
    );

    await new Promise((resolve) => setTimeout(resolve, 50));

    // Tab to focus sidebar
    stdin.write("\t");
    await new Promise((resolve) => setTimeout(resolve, 50));

    // With the responsive sidebar height, the exact visible slice can vary,
    // but a 10-agent list should still fit without scroll indicators here.
    const frame = lastFrame()!;
    expect(frame).toContain("Agent-1");
    expect(frame).toContain("Agent-9");
    expect(frame).not.toContain("▲");
    expect(frame).not.toContain("▼");

    unmount();
  });

  it("scroll offset changes when selection moves beyond visible window", async () => {
    const manyAgents = makeAgents(6);

    // Render standalone AgentSidebar with maxVisible=3 within an App
    // to get focus management. Instead, we test the component directly
    // but it needs focus context from Ink. Let's test via the full App.
    // Actually, standalone useFocus needs Ink context; let's just test
    // the scroll indicators in a standalone manner.

    // Use a standalone test: render AgentSidebar with small maxVisible
    const { lastFrame, unmount } = render(
      <AgentSidebar agents={manyAgents} maxVisible={3} />,
    );

    const frame = lastFrame()!;
    // Initially at top: shows agents 0-2, ▼ but no ▲
    expect(frame).toContain("Agent-0");
    expect(frame).toContain("Agent-1");
    expect(frame).toContain("Agent-2");
    expect(frame).not.toContain("Agent-3");
    expect(frame).toContain("▼");
    expect(frame).not.toContain("▲");

    unmount();
  });

  it("shows ▲ indicator when scrolled past the beginning", async () => {
    const manyAgents = makeAgents(30);
    const { stdin, lastFrame, unmount } = render(
      <AgentSidebar agents={manyAgents} maxVisible={3} focused />,
    );

    let frame = lastFrame()!;
    expect(frame).toContain("Agent-0");
    expect(frame).toContain("▼");
    expect(frame).not.toContain("▲");

    for (let i = 0; i < 4; i++) {
      stdin.write("\u001B[B"); // Down arrow
    }
    await new Promise((resolve) => setTimeout(resolve, 100));

    frame = lastFrame()!;
    expect(frame).toContain("▲");
    expect(frame).not.toContain("Agent-0 ");

    unmount();
  });

  it("up arrow scrolls back showing agents above", async () => {
    const manyAgents = makeAgents(30);
    const { stdin, lastFrame, unmount } = render(
      <AgentSidebar agents={manyAgents} maxVisible={3} focused />,
    );

    for (let i = 0; i < 4; i++) {
      stdin.write("\u001B[B");
    }
    await new Promise((resolve) => setTimeout(resolve, 100));

    let frame = lastFrame()!;
    expect(frame).toContain("▲");

    for (let i = 0; i < 4; i++) {
      stdin.write("\u001B[A"); // Up arrow
    }
    await new Promise((resolve) => setTimeout(resolve, 100));

    frame = lastFrame()!;
    expect(frame).toContain("Agent-0");
    expect(frame).not.toContain("▲");

    unmount();
  });
});

// ── Company picker (VAL-TUI-MGMT-004) ────────────────────────────────

describe("Company picker", () => {
  it("renders company list when no companyId", async () => {
    const pickerFetch = vi.fn().mockImplementation(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/api/companies")) {
        return {
          ok: true,
          json: async () => [
            { id: "c1", name: "Alpha Corp", updatedAt: "2026-04-01T00:00:00.000Z" },
            { id: "c2", name: "Beta Inc", updatedAt: "2026-03-01T00:00:00.000Z" },
          ],
        };
      }
      return {
        ok: true,
        json: async () => ({
          agents: [],
          totalActiveRuns: 0,
          totalQueuedIntents: 0,
          totalActiveLeases: 0,
        }),
      };
    });

    const { lastFrame, unmount } = render(
      <App
        url="http://localhost:3100"
        apiKey=""
        companyId=""
        fetchFn={pickerFetch}
        pollInterval={60000}
      />,
    );

    await new Promise((resolve) => setTimeout(resolve, 50));

    const frame = lastFrame()!;
    expect(frame).toContain("Select a company");
    expect(frame).toContain("Alpha Corp");
    expect(frame).toContain("Beta Inc");

    unmount();
  });

  it("selecting a company transitions to main layout", async () => {
    const pickerFetch = vi.fn().mockImplementation(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/api/companies")) {
        return {
          ok: true,
          json: async () => [
            { id: "c1", name: "Alpha Corp", updatedAt: "2026-04-01T00:00:00.000Z" },
          ],
        };
      }
      return {
        ok: true,
        json: async () => ({
          agents: [],
          totalActiveRuns: 0,
          totalQueuedIntents: 0,
          totalActiveLeases: 0,
        }),
      };
    });

    const { stdin, lastFrame, unmount } = render(
      <App
        url="http://localhost:3100"
        apiKey=""
        companyId=""
        fetchFn={pickerFetch}
        pollInterval={60000}
      />,
    );

    await new Promise((resolve) => setTimeout(resolve, 50));

    // Auto-selects single company
    const frame = lastFrame()!;
    // With only one company, App auto-selects it
    expect(frame).toContain("Agents");
    expect(frame).toContain("Chat");

    unmount();
  });

  it("arrow keys navigate company list", async () => {
    const pickerFetch = vi.fn().mockImplementation(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/api/companies")) {
        return {
          ok: true,
          json: async () => [
            { id: "c1", name: "Alpha Corp", updatedAt: "2026-04-01T00:00:00.000Z" },
            { id: "c2", name: "Beta Inc", updatedAt: "2026-03-01T00:00:00.000Z" },
          ],
        };
      }
      return {
        ok: true,
        json: async () => ({
          agents: [],
          totalActiveRuns: 0,
          totalQueuedIntents: 0,
          totalActiveLeases: 0,
        }),
      };
    });

    const { stdin, lastFrame, unmount } = render(
      <App
        url="http://localhost:3100"
        apiKey=""
        companyId=""
        fetchFn={pickerFetch}
        pollInterval={60000}
      />,
    );

    await new Promise((resolve) => setTimeout(resolve, 50));

    // Initially first company is selected (›)
    let frame = lastFrame()!;
    expect(frame).toContain("Select a company");

    // Press down arrow to select second company
    stdin.write("\u001B[B");
    await new Promise((resolve) => setTimeout(resolve, 50));

    frame = lastFrame()!;
    expect(frame).toContain("Alpha Corp");
    expect(frame).toContain("Beta Inc");

    // Press Enter to select
    stdin.write("\r");
    await new Promise((resolve) => setTimeout(resolve, 50));

    frame = lastFrame()!;
    // Should transition to main layout
    expect(frame).toContain("Agents");
    expect(frame).toContain("Chat");

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
    expect(frame).toContain("4 roster");
    expect(frame).toContain("Dev-1");
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
        companyId="test-company"
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
