import type { OrchestratorClient } from "../client.js";

interface NudgeResponse {
  id: string;
  intentType: string;
  targetAgentId: string;
  [key: string]: unknown;
}

export async function nudgeCommand(
  client: OrchestratorClient,
  agentId: string,
  log: (msg: string) => void = console.log,
): Promise<void> {
  const intent = await client.post<NudgeResponse>(
    `/api/orchestrator/agents/${encodeURIComponent(agentId)}/nudge`,
  );

  log(`Nudge sent to agent ${intent.targetAgentId}.`);
  log(`  Intent created: ${intent.id} [${intent.intentType}]`);
}
