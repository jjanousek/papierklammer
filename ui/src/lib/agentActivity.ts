import type { Agent } from "@papierklammer/shared";
import type { LiveRunForIssue } from "../api/heartbeats";

export function hasDashboardLiveRun(run?: LiveRunForIssue | null): boolean {
  return run?.status === "running" || run?.status === "queued";
}

export function getDashboardAgentDisplayStatus(
  agent: Pick<Agent, "status">,
  run?: LiveRunForIssue | null,
): string {
  if (run?.status === "queued") {
    return "queued";
  }
  if (run?.status === "running") {
    return "running";
  }
  if (agent.status === "running") {
    return "idle";
  }
  return agent.status;
}

export function isDashboardAgentCountedActive(
  _agent: Pick<Agent, "status">,
  run?: LiveRunForIssue | null,
): boolean {
  return hasDashboardLiveRun(run);
}

export function dashboardActivityPriority(
  agent: Pick<Agent, "status">,
  run?: LiveRunForIssue | null,
): number {
  const displayStatus = getDashboardAgentDisplayStatus(agent, run);
  if (displayStatus === "queued" || displayStatus === "running" || displayStatus === "active") return 0;
  if (displayStatus === "paused" || displayStatus === "pending_approval") return 1;
  return 2;
}
