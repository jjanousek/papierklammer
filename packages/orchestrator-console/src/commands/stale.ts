import type { OrchestratorClient } from "../client.js";

interface StaleRun {
  runId: string;
  agentName?: string;
  issueTitle?: string;
  startedAt?: string;
}

interface StaleIntent {
  id: string;
  intentType: string;
  issueId: string;
  createdAt?: string;
}

interface StaleLease {
  id: string;
  issueId: string;
  agentId: string;
  expiresAt?: string;
}

interface StaleResponse {
  staleRuns: StaleRun[];
  staleIntents: StaleIntent[];
  orphanedLeases: StaleLease[];
}

export async function staleCommand(
  client: OrchestratorClient,
  companyId: string,
  log: (msg: string) => void = console.log,
): Promise<void> {
  const data = await client.get<StaleResponse>(
    `/api/orchestrator/stale?companyId=${encodeURIComponent(companyId)}`,
  );

  log("=== Stale Items ===");
  log("");

  log(`Stale Runs (${data.staleRuns.length}):`);
  if (data.staleRuns.length === 0) {
    log("  None");
  } else {
    for (const run of data.staleRuns) {
      log(`  - ${run.runId}${run.agentName ? ` (${run.agentName})` : ""}${run.issueTitle ? ` — ${run.issueTitle}` : ""}`);
    }
  }

  log("");
  log(`Stale Intents (${data.staleIntents.length}):`);
  if (data.staleIntents.length === 0) {
    log("  None");
  } else {
    for (const intent of data.staleIntents) {
      log(`  - ${intent.id} [${intent.intentType}] issue=${intent.issueId}`);
    }
  }

  log("");
  log(`Orphaned Leases (${data.orphanedLeases.length}):`);
  if (data.orphanedLeases.length === 0) {
    log("  None");
  } else {
    for (const lease of data.orphanedLeases) {
      log(`  - ${lease.id} issue=${lease.issueId} agent=${lease.agentId}`);
    }
  }
}
