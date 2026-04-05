import type { AgentOverview } from "../hooks/useOrchestratorStatus.js";

export function getAgentOverviewDisplayStatus(
  agent: Pick<AgentOverview, "status" | "activeRunCount">,
): string {
  if (agent.activeRunCount > 0) {
    return "running";
  }
  if (agent.status === "running") {
    return "idle";
  }
  return agent.status;
}
