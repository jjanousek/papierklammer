import type { OrchestratorClient } from "../client.js";

interface UnblockResponse {
  issue: { id: string; title?: string; [key: string]: unknown };
  leaseReleased: boolean;
  rejectedIntents: number;
}

export async function unblockCommand(
  client: OrchestratorClient,
  issueId: string,
  log: (msg: string) => void = console.log,
): Promise<void> {
  const result = await client.post<UnblockResponse>(
    `/api/orchestrator/issues/${encodeURIComponent(issueId)}/unblock`,
  );

  log(`Issue ${result.issue.id} unblocked.`);
  log(`  Lease released: ${result.leaseReleased ? "yes" : "no"}`);
  log(`  Rejected intents: ${result.rejectedIntents}`);
}
