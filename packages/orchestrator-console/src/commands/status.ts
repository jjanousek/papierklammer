import type { OrchestratorClient } from "../client.js";

interface AgentOverview {
  agentId: string;
  name: string;
  status: string;
  activeRunCount: number;
  queuedIntentCount: number;
}

interface StatusResponse {
  agents: AgentOverview[];
  totalActiveRuns: number;
  totalQueuedIntents: number;
  totalActiveLeases: number;
}

export async function statusCommand(
  client: OrchestratorClient,
  companyId: string,
  log: (msg: string) => void = console.log,
): Promise<void> {
  const data = await client.get<StatusResponse>(
    `/api/orchestrator/status?companyId=${encodeURIComponent(companyId)}`,
  );

  log("=== System Status ===");
  log("");

  if (data.agents.length === 0) {
    log("No agents found.");
  } else {
    // Header
    log(
      padRight("Agent", 30) +
        padRight("Status", 15) +
        padRight("Active Runs", 15) +
        padRight("Queued Intents", 15),
    );
    log("-".repeat(75));

    for (const agent of data.agents) {
      log(
        padRight(agent.name || agent.agentId, 30) +
          padRight(agent.status, 15) +
          padRight(String(agent.activeRunCount), 15) +
          padRight(String(agent.queuedIntentCount), 15),
      );
    }
  }

  log("");
  log(`Total active runs: ${data.totalActiveRuns}`);
  log(`Total queued intents: ${data.totalQueuedIntents}`);
  log(`Total active leases: ${data.totalActiveLeases}`);
}

function padRight(str: string, len: number): string {
  return str.length >= len ? str : str + " ".repeat(len - str.length);
}
