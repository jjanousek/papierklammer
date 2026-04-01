import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  OrchestratorClient,
  AuthenticationError,
  ApiError,
} from "../client.js";
import { statusCommand } from "../commands/status.js";
import { staleCommand } from "../commands/stale.js";
import { createIssueCommand } from "../commands/create-issue.js";
import { reprioritizeCommand } from "../commands/reprioritize.js";
import { unblockCommand } from "../commands/unblock.js";
import { cleanupCommand } from "../commands/cleanup.js";
import { nudgeCommand } from "../commands/nudge.js";

// Helper to create a mock client
function createMockClient() {
  return {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  } as unknown as OrchestratorClient & {
    get: ReturnType<typeof vi.fn>;
    post: ReturnType<typeof vi.fn>;
    patch: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
}

function captureOutput(): { lines: string[]; log: (msg: string) => void } {
  const lines: string[] = [];
  return { lines, log: (msg: string) => lines.push(msg) };
}

describe("status command", () => {
  it("prints agent overview table", async () => {
    const client = createMockClient();
    client.get.mockResolvedValue({
      agents: [
        {
          agentId: "a1",
          name: "Agent Alpha",
          status: "idle",
          activeRunCount: 2,
          queuedIntentCount: 1,
        },
        {
          agentId: "a2",
          name: "Agent Beta",
          status: "busy",
          activeRunCount: 5,
          queuedIntentCount: 3,
        },
      ],
      totalActiveRuns: 7,
      totalQueuedIntents: 4,
      totalActiveLeases: 2,
    });

    const { lines, log } = captureOutput();
    await statusCommand(client, "company-1", log);

    expect(client.get).toHaveBeenCalledWith(
      "/api/orchestrator/status?companyId=company-1",
    );

    const output = lines.join("\n");
    expect(output).toContain("System Status");
    expect(output).toContain("Agent Alpha");
    expect(output).toContain("Agent Beta");
    expect(output).toContain("idle");
    expect(output).toContain("busy");
    expect(output).toContain("Total active runs: 7");
    expect(output).toContain("Total queued intents: 4");
    expect(output).toContain("Total active leases: 2");
  });

  it("handles empty agents list", async () => {
    const client = createMockClient();
    client.get.mockResolvedValue({
      agents: [],
      totalActiveRuns: 0,
      totalQueuedIntents: 0,
      totalActiveLeases: 0,
    });

    const { lines, log } = captureOutput();
    await statusCommand(client, "company-1", log);

    const output = lines.join("\n");
    expect(output).toContain("No agents found");
  });

  it("propagates auth errors", async () => {
    const client = createMockClient();
    client.get.mockRejectedValue(
      new AuthenticationError("Auth failed"),
    );

    await expect(
      statusCommand(client, "company-1"),
    ).rejects.toThrow(AuthenticationError);
  });
});

describe("stale command", () => {
  it("prints stale items lists", async () => {
    const client = createMockClient();
    client.get.mockResolvedValue({
      staleRuns: [
        { runId: "r1", agentName: "Alpha", issueTitle: "Fix bug" },
      ],
      staleIntents: [
        { id: "i1", intentType: "timer_hint", issueId: "iss1" },
      ],
      orphanedLeases: [
        { id: "l1", issueId: "iss2", agentId: "a1" },
      ],
    });

    const { lines, log } = captureOutput();
    await staleCommand(client, "company-1", log);

    const output = lines.join("\n");
    expect(output).toContain("Stale Items");
    expect(output).toContain("Stale Runs (1)");
    expect(output).toContain("r1");
    expect(output).toContain("Alpha");
    expect(output).toContain("Stale Intents (1)");
    expect(output).toContain("timer_hint");
    expect(output).toContain("Orphaned Leases (1)");
    expect(output).toContain("l1");
  });

  it("shows none when no stale items", async () => {
    const client = createMockClient();
    client.get.mockResolvedValue({
      staleRuns: [],
      staleIntents: [],
      orphanedLeases: [],
    });

    const { lines, log } = captureOutput();
    await staleCommand(client, "company-1", log);

    const output = lines.join("\n");
    expect(output).toContain("Stale Runs (0)");
    expect(output).toContain("None");
  });
});

describe("create-issue command", () => {
  it("creates issue with title", async () => {
    const client = createMockClient();
    client.post.mockResolvedValue({
      id: "new-issue-1",
      title: "New task",
      status: "todo",
    });

    const { lines, log } = captureOutput();
    await createIssueCommand(
      client,
      { companyId: "c1", title: "New task" },
      log,
    );

    expect(client.post).toHaveBeenCalledWith("/api/orchestrator/issues", {
      companyId: "c1",
      title: "New task",
    });

    const output = lines.join("\n");
    expect(output).toContain("Issue created: new-issue-1");
    expect(output).toContain("Title: New task");
    expect(output).toContain("Status: todo");
  });

  it("sends assignee and project when provided", async () => {
    const client = createMockClient();
    client.post.mockResolvedValue({
      id: "new-issue-2",
      title: "Task",
      status: "todo",
    });

    const { lines, log } = captureOutput();
    await createIssueCommand(
      client,
      {
        companyId: "c1",
        title: "Task",
        assignee: "agent-1",
        project: "proj-1",
        priority: "high",
      },
      log,
    );

    expect(client.post).toHaveBeenCalledWith("/api/orchestrator/issues", {
      companyId: "c1",
      title: "Task",
      assigneeAgentId: "agent-1",
      projectId: "proj-1",
      priority: "high",
    });
  });

  it("propagates API errors", async () => {
    const client = createMockClient();
    client.post.mockRejectedValue(
      new ApiError(400, "Title required"),
    );

    await expect(
      createIssueCommand(client, { companyId: "c1", title: "" }),
    ).rejects.toThrow(ApiError);
  });
});

describe("reprioritize command", () => {
  it("updates issue priority", async () => {
    const client = createMockClient();
    client.patch.mockResolvedValue({
      id: "issue-1",
      priority: "high",
    });

    const { lines, log } = captureOutput();
    await reprioritizeCommand(client, "issue-1", "high", log);

    expect(client.patch).toHaveBeenCalledWith(
      "/api/orchestrator/issues/issue-1/priority",
      { priority: "high" },
    );

    const output = lines.join("\n");
    expect(output).toContain("issue-1");
    expect(output).toContain("high");
  });
});

describe("unblock command", () => {
  it("unblocks issue and shows result", async () => {
    const client = createMockClient();
    client.post.mockResolvedValue({
      issue: { id: "issue-1", title: "Stuck task" },
      leaseReleased: true,
      rejectedIntents: 2,
    });

    const { lines, log } = captureOutput();
    await unblockCommand(client, "issue-1", log);

    expect(client.post).toHaveBeenCalledWith(
      "/api/orchestrator/issues/issue-1/unblock",
    );

    const output = lines.join("\n");
    expect(output).toContain("issue-1 unblocked");
    expect(output).toContain("Lease released: yes");
    expect(output).toContain("Rejected intents: 2");
  });

  it("shows lease not released when none existed", async () => {
    const client = createMockClient();
    client.post.mockResolvedValue({
      issue: { id: "issue-2" },
      leaseReleased: false,
      rejectedIntents: 0,
    });

    const { lines, log } = captureOutput();
    await unblockCommand(client, "issue-2", log);

    const output = lines.join("\n");
    expect(output).toContain("Lease released: no");
  });
});

describe("cleanup command", () => {
  it("calls both cleanup endpoints and prints counts", async () => {
    const client = createMockClient();
    client.delete
      .mockResolvedValueOnce({ cancelled: 3 })
      .mockResolvedValueOnce({ rejected: 5 });

    const { lines, log } = captureOutput();
    await cleanupCommand(client, "company-1", log);

    expect(client.delete).toHaveBeenCalledTimes(2);
    expect(client.delete).toHaveBeenCalledWith(
      "/api/orchestrator/stale/runs?companyId=company-1",
    );
    expect(client.delete).toHaveBeenCalledWith(
      "/api/orchestrator/stale/intents?companyId=company-1",
    );

    const output = lines.join("\n");
    expect(output).toContain("Stale runs cancelled: 3");
    expect(output).toContain("Stale intents rejected: 5");
  });

  it("handles zero cleanup counts", async () => {
    const client = createMockClient();
    client.delete
      .mockResolvedValueOnce({ cancelled: 0 })
      .mockResolvedValueOnce({ rejected: 0 });

    const { lines, log } = captureOutput();
    await cleanupCommand(client, "company-1", log);

    const output = lines.join("\n");
    expect(output).toContain("Stale runs cancelled: 0");
    expect(output).toContain("Stale intents rejected: 0");
  });
});

describe("nudge command", () => {
  it("nudges agent and shows intent info", async () => {
    const client = createMockClient();
    client.post.mockResolvedValue({
      id: "intent-1",
      intentType: "manager_escalation",
      targetAgentId: "agent-1",
    });

    const { lines, log } = captureOutput();
    await nudgeCommand(client, "agent-1", log);

    expect(client.post).toHaveBeenCalledWith(
      "/api/orchestrator/agents/agent-1/nudge",
    );

    const output = lines.join("\n");
    expect(output).toContain("Nudge sent to agent agent-1");
    expect(output).toContain("Intent created: intent-1");
    expect(output).toContain("manager_escalation");
  });
});

describe("error handling in commands", () => {
  it("status command propagates 401 auth error", async () => {
    const client = createMockClient();
    client.get.mockRejectedValue(
      new AuthenticationError("Auth failed"),
    );

    await expect(
      statusCommand(client, "company-1"),
    ).rejects.toThrow("Auth failed");
  });

  it("cleanup command propagates API error", async () => {
    const client = createMockClient();
    client.delete.mockRejectedValue(
      new ApiError(500, "Internal server error"),
    );

    await expect(
      cleanupCommand(client, "company-1"),
    ).rejects.toThrow("Internal server error");
  });

  it("nudge command propagates not-found error", async () => {
    const client = createMockClient();
    client.post.mockRejectedValue(
      new ApiError(404, "Agent not found"),
    );

    await expect(
      nudgeCommand(client, "bad-agent"),
    ).rejects.toThrow("Agent not found");
  });
});
