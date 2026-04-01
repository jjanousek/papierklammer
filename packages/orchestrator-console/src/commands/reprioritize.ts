import type { OrchestratorClient } from "../client.js";

interface ReprioritizeResponse {
  id: string;
  priority: string;
  [key: string]: unknown;
}

export async function reprioritizeCommand(
  client: OrchestratorClient,
  issueId: string,
  priority: string,
  log: (msg: string) => void = console.log,
): Promise<void> {
  const updated = await client.patch<ReprioritizeResponse>(
    `/api/orchestrator/issues/${encodeURIComponent(issueId)}/priority`,
    { priority },
  );

  log(`Issue ${updated.id} priority updated to: ${updated.priority}`);
}
