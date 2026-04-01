import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import type { Db } from "@papierklammer/db";
import {
  dispatchIntents,
  executionLeases,
  heartbeatRuns,
  issues,
} from "@papierklammer/db";
import { eventLogService } from "./event-log.js";

/**
 * Active run statuses — runs still considered "in-flight".
 */
const ACTIVE_RUN_STATUSES = ["queued", "running"];

/**
 * Active lease states — leases still considered "active".
 */
const ACTIVE_LEASE_STATES = ["granted", "renewed"];

/**
 * Terminal issue statuses — issues that should not have queued intents.
 */
const TERMINAL_ISSUE_STATUSES = ["done", "cancelled"];

/**
 * Result returned by `reconcile()` with counts of each correction type.
 */
export interface ReconcileResult {
  orphanedRunsClosed: number;
  staleIntentsRejected: number;
  ghostProjectionsCorrected: number;
}

/**
 * Reconciliation service.
 *
 * Lightweight periodic jobs that fix drift between run/lease/intent state
 * and issue projections. Runs all reconciliation checks for a given company.
 *
 * Corrections performed:
 * (a) Close orphaned active runs (status=running but no active lease and no live process)
 * (b) Invalidate stale intents (queued intents for closed/reassigned issues)
 * (c) Clear ghost in_progress projections (issue projected as in_progress but no active run or lease)
 * (d) Compare run state vs issue state for mismatches
 *
 * Each correction emits a reconciliation event to control_plane_events.
 * Updates lastReconciledAt on reconciled issues.
 *
 * Factory function following the project's service pattern.
 */
export function reconcilerService(db: Db) {
  const eventLog = eventLogService(db);

  /**
   * Close orphaned active runs.
   *
   * Finds runs with status in (queued, running) for the company that have
   * no active lease (granted or renewed). These runs are considered orphaned
   * and are marked as failed.
   */
  async function closeOrphanedRuns(companyId: string): Promise<{ closed: number; issueIds: string[] }> {
    // Find all active runs for this company
    const activeRuns = await db
      .select({
        id: heartbeatRuns.id,
        agentId: heartbeatRuns.agentId,
      })
      .from(heartbeatRuns)
      .where(
        and(
          eq(heartbeatRuns.companyId, companyId),
          inArray(heartbeatRuns.status, ACTIVE_RUN_STATUSES),
        ),
      );

    if (activeRuns.length === 0) return { closed: 0, issueIds: [] };

    // For each active run, check if it has an active lease
    const runIds = activeRuns.map((r) => r.id);
    const activeLeasesByRunId = new Set<string>();

    if (runIds.length > 0) {
      const leasesWithRuns = await db
        .select({ runId: executionLeases.runId })
        .from(executionLeases)
        .where(
          and(
            eq(executionLeases.companyId, companyId),
            inArray(executionLeases.state, ACTIVE_LEASE_STATES),
            sql`${executionLeases.runId} IS NOT NULL`,
          ),
        );

      for (const lease of leasesWithRuns) {
        if (lease.runId) activeLeasesByRunId.add(lease.runId);
      }
    }

    // Find runs that have no active lease
    const orphanedRunIds = runIds.filter((id) => !activeLeasesByRunId.has(id));

    if (orphanedRunIds.length === 0) return { closed: 0, issueIds: [] };

    const now = new Date();

    // Mark orphaned runs as failed
    await db
      .update(heartbeatRuns)
      .set({
        status: "failed",
        finishedAt: now,
        error: "Reconciler: orphaned run with no active lease",
        errorCode: "reconciliation_orphaned",
        updatedAt: now,
      })
      .where(
        and(
          inArray(heartbeatRuns.id, orphanedRunIds),
          inArray(heartbeatRuns.status, ACTIVE_RUN_STATUSES),
        ),
      );

    // Find issues referencing these orphaned runs and clear the execution lock
    const affectedIssues = await db
      .select({ id: issues.id })
      .from(issues)
      .where(
        and(
          eq(issues.companyId, companyId),
          inArray(issues.executionRunId, orphanedRunIds),
        ),
      );

    const issueIds = affectedIssues.map((i) => i.id);

    if (issueIds.length > 0) {
      await db
        .update(issues)
        .set({
          executionRunId: null,
          executionLockedAt: null,
          updatedAt: now,
        })
        .where(
          and(
            eq(issues.companyId, companyId),
            inArray(issues.id, issueIds),
          ),
        );
    }

    // Emit reconciliation events for each orphaned run
    for (const runId of orphanedRunIds) {
      await eventLog.emit({
        companyId,
        entityType: "run",
        entityId: runId,
        eventType: "reconciliation_orphaned_run_closed",
        payload: {
          runId,
          reason: "No active lease found for running run",
        },
      });
    }

    return { closed: orphanedRunIds.length, issueIds };
  }

  /**
   * Invalidate stale intents.
   *
   * Finds queued intents for:
   * - Closed or cancelled issues
   * - Issues where the assignee no longer matches the intent's targetAgentId
   *
   * These intents are rejected with a reconciliation reason.
   */
  async function invalidateStaleIntents(companyId: string): Promise<{ rejected: number; issueIds: string[] }> {
    // Find all queued intents for this company
    const queuedIntents = await db
      .select({
        id: dispatchIntents.id,
        issueId: dispatchIntents.issueId,
        targetAgentId: dispatchIntents.targetAgentId,
      })
      .from(dispatchIntents)
      .where(
        and(
          eq(dispatchIntents.companyId, companyId),
          eq(dispatchIntents.status, "queued"),
        ),
      );

    if (queuedIntents.length === 0) return { rejected: 0, issueIds: [] };

    // Fetch the issues for these intents
    const issueIds = [...new Set(queuedIntents.map((i) => i.issueId))];
    const issueRows = await db
      .select({
        id: issues.id,
        status: issues.status,
        assigneeAgentId: issues.assigneeAgentId,
      })
      .from(issues)
      .where(inArray(issues.id, issueIds));

    const issueMap = new Map(issueRows.map((i) => [i.id, i]));

    const intentsToReject: Array<{ id: string; issueId: string; reason: string }> = [];

    for (const intent of queuedIntents) {
      const issue = issueMap.get(intent.issueId);

      if (!issue) {
        // Issue doesn't exist — reject the intent
        intentsToReject.push({
          id: intent.id,
          issueId: intent.issueId,
          reason: "issue not found",
        });
        continue;
      }

      // Check if issue is in a terminal status
      if (TERMINAL_ISSUE_STATUSES.includes(issue.status)) {
        intentsToReject.push({
          id: intent.id,
          issueId: intent.issueId,
          reason: `issue ${issue.status}`,
        });
        continue;
      }

      // Check if assignee has changed (but only if the issue has an assignee)
      if (
        issue.assigneeAgentId &&
        intent.targetAgentId !== issue.assigneeAgentId
      ) {
        intentsToReject.push({
          id: intent.id,
          issueId: intent.issueId,
          reason: "assignee mismatch after reassignment",
        });
        continue;
      }
    }

    if (intentsToReject.length === 0) return { rejected: 0, issueIds: [] };

    const now = new Date();
    const rejectedIntentIds = intentsToReject.map((i) => i.id);

    // Batch reject stale intents
    await db
      .update(dispatchIntents)
      .set({
        status: "rejected",
        resolvedAt: now,
        updatedAt: now,
        sourceEventId: "reconciliation: stale intent",
      })
      .where(
        and(
          inArray(dispatchIntents.id, rejectedIntentIds),
          eq(dispatchIntents.status, "queued"),
        ),
      );

    // Emit reconciliation events
    for (const intent of intentsToReject) {
      await eventLog.emit({
        companyId,
        entityType: "intent",
        entityId: intent.id,
        eventType: "reconciliation_stale_intent_rejected",
        payload: {
          intentId: intent.id,
          issueId: intent.issueId,
          reason: intent.reason,
        },
      });
    }

    const affectedIssueIds = [...new Set(intentsToReject.map((i) => i.issueId))];
    return { rejected: intentsToReject.length, issueIds: affectedIssueIds };
  }

  /**
   * Clear ghost in_progress projections.
   *
   * Finds issues with status='in_progress' that have neither an active run
   * (queued/running) nor an active lease (granted/renewed). These are "ghost"
   * projections — the issue appears busy but nothing is actually working on it.
   *
   * Resets these issues to 'todo' status.
   */
  async function clearGhostProjections(companyId: string): Promise<{ corrected: number; issueIds: string[] }> {
    // Find in_progress issues for this company
    const inProgressIssues = await db
      .select({
        id: issues.id,
        executionRunId: issues.executionRunId,
      })
      .from(issues)
      .where(
        and(
          eq(issues.companyId, companyId),
          eq(issues.status, "in_progress"),
        ),
      );

    if (inProgressIssues.length === 0) return { corrected: 0, issueIds: [] };

    const ghostIssueIds: string[] = [];

    for (const issue of inProgressIssues) {
      // Check for active run
      let hasActiveRun = false;
      if (issue.executionRunId) {
        const [run] = await db
          .select({ id: heartbeatRuns.id })
          .from(heartbeatRuns)
          .where(
            and(
              eq(heartbeatRuns.id, issue.executionRunId),
              inArray(heartbeatRuns.status, ACTIVE_RUN_STATUSES),
            ),
          );
        hasActiveRun = !!run;
      }

      // Check for active lease
      const [activeLease] = await db
        .select({ id: executionLeases.id })
        .from(executionLeases)
        .where(
          and(
            eq(executionLeases.issueId, issue.id),
            inArray(executionLeases.state, ACTIVE_LEASE_STATES),
          ),
        )
        .limit(1);

      const hasActiveLease = !!activeLease;

      // If no active run and no active lease, it's a ghost projection
      if (!hasActiveRun && !hasActiveLease) {
        ghostIssueIds.push(issue.id);
      }
    }

    if (ghostIssueIds.length === 0) return { corrected: 0, issueIds: [] };

    const now = new Date();

    // Reset ghost issues to 'todo'
    await db
      .update(issues)
      .set({
        status: "todo",
        executionRunId: null,
        checkoutRunId: null,
        executionLockedAt: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(issues.companyId, companyId),
          inArray(issues.id, ghostIssueIds),
          eq(issues.status, "in_progress"),
        ),
      );

    // Emit reconciliation events
    for (const issueId of ghostIssueIds) {
      await eventLog.emit({
        companyId,
        entityType: "issue",
        entityId: issueId,
        eventType: "reconciliation_ghost_projection_cleared",
        payload: {
          issueId,
          previousStatus: "in_progress",
          correctedStatus: "todo",
          reason: "No active run or lease found",
        },
      });
    }

    return { corrected: ghostIssueIds.length, issueIds: ghostIssueIds };
  }

  /**
   * Update lastReconciledAt on affected issues.
   */
  async function updateLastReconciledAt(
    companyId: string,
    issueIds: string[],
  ): Promise<void> {
    if (issueIds.length === 0) return;

    const uniqueIds = [...new Set(issueIds)];
    const now = new Date();

    await db
      .update(issues)
      .set({
        lastReconciledAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(issues.companyId, companyId),
          inArray(issues.id, uniqueIds),
        ),
      );
  }

  return {
    /**
     * Run all reconciliation checks for a company.
     *
     * Performs:
     * (a) Close orphaned active runs
     * (b) Invalidate stale intents
     * (c) Clear ghost in_progress projections
     *
     * Each correction emits a reconciliation event to control_plane_events.
     * Updates lastReconciledAt on all affected issues.
     *
     * Returns counts of corrections made.
     */
    async reconcile(companyId: string): Promise<ReconcileResult> {
      // (a) Close orphaned active runs
      const orphanedResult = await closeOrphanedRuns(companyId);

      // (b) Invalidate stale intents
      const staleResult = await invalidateStaleIntents(companyId);

      // (c) Clear ghost in_progress projections
      const ghostResult = await clearGhostProjections(companyId);

      // Collect all affected issue IDs and update lastReconciledAt
      const allIssueIds = [
        ...orphanedResult.issueIds,
        ...staleResult.issueIds,
        ...ghostResult.issueIds,
      ];

      await updateLastReconciledAt(companyId, allIssueIds);

      return {
        orphanedRunsClosed: orphanedResult.closed,
        staleIntentsRejected: staleResult.rejected,
        ghostProjectionsCorrected: ghostResult.corrected,
      };
    },
  };
}
