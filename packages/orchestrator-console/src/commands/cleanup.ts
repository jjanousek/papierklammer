import type { OrchestratorClient } from "../client.js";

interface CleanupRunsResponse {
  cancelled: number;
}

interface CleanupIntentsResponse {
  rejected: number;
}

export async function cleanupCommand(
  client: OrchestratorClient,
  companyId: string,
  log: (msg: string) => void = console.log,
): Promise<void> {
  const qs = `companyId=${encodeURIComponent(companyId)}`;

  const runsResult = await client.delete<CleanupRunsResponse>(
    `/api/orchestrator/stale/runs?${qs}`,
  );

  const intentsResult = await client.delete<CleanupIntentsResponse>(
    `/api/orchestrator/stale/intents?${qs}`,
  );

  log("Stale cleanup complete.");
  log(`  Stale runs cancelled: ${runsResult.cancelled}`);
  log(`  Stale intents rejected: ${intentsResult.rejected}`);
}
