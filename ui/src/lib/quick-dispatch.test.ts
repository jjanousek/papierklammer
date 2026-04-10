import { describe, expect, it } from "vitest";
import type { Agent } from "@papierklammer/shared";
import { buildQuickDispatchDraft } from "./quick-dispatch";

function makeAgent(input: Partial<Agent> & Pick<Agent, "id" | "name" | "role" | "status">): Agent {
  return {
    companyId: "company-1",
    urlKey: input.name.toLowerCase().replace(/\s+/g, "-"),
    title: null,
    icon: null,
    adapterType: "codex_local",
    adapterConfig: {},
    runtimeConfig: {},
    budgetMonthlyCents: 0,
    spentMonthlyCents: 0,
    pauseReason: null,
    pausedAt: null,
    reportsTo: null,
    capabilities: null,
    permissions: { canCreateAgents: false },
    lastHeartbeatAt: null,
    metadata: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...input,
  };
}

describe("buildQuickDispatchDraft", () => {
  const agents: Agent[] = [
    makeAgent({ id: "a-ceo", name: "CEO", role: "ceo", status: "idle" }),
    makeAgent({ id: "a-cto", name: "CTO", role: "cto", status: "idle" }),
    makeAgent({ id: "a-researcher", name: "Weather Researcher", role: "researcher", status: "idle" }),
  ];

  it("infers an assignee from an agent name and strips the dispatch prefix from the title", () => {
    const draft = buildQuickDispatchDraft("have CTO review all active blockers for this week", agents);
    expect(draft.assigneeAgentId).toBe("a-cto");
    expect(draft.assigneeLabel).toBe("CTO");
    expect(draft.title).toBe("Review all active blockers for this week");
  });

  it("infers an assignee from a role token when the command mentions the role", () => {
    const draft = buildQuickDispatchDraft("assign researcher gather Hong Kong rainfall evidence", agents);
    expect(draft.assigneeAgentId).toBe("a-researcher");
    expect(draft.title).toBe("Gather Hong Kong rainfall evidence");
  });

  it("falls back to an unassigned issue when no agent match is found", () => {
    const draft = buildQuickDispatchDraft("document the current dashboard command bar behavior", agents);
    expect(draft.assigneeAgentId).toBeNull();
    expect(draft.assigneeLabel).toBeNull();
    expect(draft.title).toBe("Document the current dashboard command bar behavior");
  });
});
