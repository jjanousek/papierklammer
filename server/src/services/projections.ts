import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@papierklammer/db";
import {
  executionLeases,
  heartbeatRuns,
  issueDependencies,
  issues,
} from "@papierklammer/db";
import { intentQueueService } from "./intent-queue.js";
import { leaseManagerService } from "./lease-manager.js";
import { dependencyService } from "./dependency.js";

/**
 * Active run statuses considered "running" for projection purposes.
 */
const ACTIVE_RUN_STATUSES = ["queued", "running"];

/**
 * Active lease states considered "active" for projection purposes.
 */
const ACTIVE_LEASE_STATES = ["granted", "renewed"];

/**
 * Projection result for a single issue.
 */
export interface IssueProjection {
  projectedStatus: string;
  activeRunId: string | null;
  activeLeaseId: string | null;
  pickupFailCount: number;
  lastReconciledAt: Date | null;
}

/**
 * Projection Service.
 *
 * Derives issue status from run/lease state rather than relying solely
 * on the raw mutable status field.
 *
 * Projection rules:
 * 1. If issue has an active run with checkout → 'in_progress'
 * 2. If run cancelled without checkout → raw status (e.g., 'todo')
 * 3. If issue.status='done' → 'done' and all active intents/leases invalidated
 *
 * Factory function following the project's service pattern.
 */
export function projectionService(db: Db) {
  const intentQueue = intentQueueService(db);
  const leaseMgr = leaseManagerService(db);
  const deps = dependencyService(db);

  return {
    /**
     * Pure function for computing projected status.
     *
     * Given an issue and its active run/lease state, computes the projected
     * status without side effects.
     *
     * @param issue - The issue row (must include status, pickupFailCount, lastReconciledAt)
     * @param activeRun - The active heartbeat run for this issue, or null
     * @param activeLease - The active execution lease for this issue, or null
     * @param checkoutRunId - The checkoutRunId on the issue (indicates checkout happened)
     * @param hasUnresolvedDeps - Whether the issue has unresolved dependencies (optional)
     */
    projectIssueStatus(
      issue: {
        id: string;
        status: string;
        pickupFailCount: number;
        lastReconciledAt: Date | null;
      },
      activeRun: { id: string; status: string } | null,
      activeLease: { id: string; state: string } | null,
      checkoutRunId: string | null,
      hasUnresolvedDeps = false,
    ): IssueProjection {
      // If issue is done, always project as done
      if (issue.status === "done") {
        return {
          projectedStatus: "done",
          activeRunId: null,
          activeLeaseId: null,
          pickupFailCount: issue.pickupFailCount,
          lastReconciledAt: issue.lastReconciledAt,
        };
      }

      // If issue is cancelled, project as cancelled
      if (issue.status === "cancelled") {
        return {
          projectedStatus: "cancelled",
          activeRunId: null,
          activeLeaseId: null,
          pickupFailCount: issue.pickupFailCount,
          lastReconciledAt: issue.lastReconciledAt,
        };
      }

      // Check if run is truly active
      const runIsActive =
        activeRun != null &&
        ACTIVE_RUN_STATUSES.includes(activeRun.status);

      // Check if lease is truly active
      const leaseIsActive =
        activeLease != null &&
        ACTIVE_LEASE_STATES.includes(activeLease.state);

      // If there's an active run with checkout, project as in_progress
      if (runIsActive && checkoutRunId === activeRun.id) {
        return {
          projectedStatus: "in_progress",
          activeRunId: activeRun.id,
          activeLeaseId: leaseIsActive ? activeLease.id : null,
          pickupFailCount: issue.pickupFailCount,
          lastReconciledAt: issue.lastReconciledAt,
        };
      }

      // If issue has unresolved dependencies, project as blocked_on_dependency
      // (only when there's no active run with checkout already — active work takes precedence)
      if (hasUnresolvedDeps) {
        return {
          projectedStatus: "blocked_on_dependency",
          activeRunId: runIsActive ? activeRun.id : null,
          activeLeaseId: leaseIsActive ? activeLease.id : null,
          pickupFailCount: issue.pickupFailCount,
          lastReconciledAt: issue.lastReconciledAt,
        };
      }

      // If run exists (active or not) but no checkout, or run is cancelled/failed
      // → raw status, but still report active run/lease metadata if they exist
      return {
        projectedStatus: issue.status,
        activeRunId: runIsActive ? activeRun.id : null,
        activeLeaseId: leaseIsActive ? activeLease.id : null,
        pickupFailCount: issue.pickupFailCount,
        lastReconciledAt: issue.lastReconciledAt,
      };
    },

    /**
     * Get the full projection for a single issue.
     *
     * Fetches the issue, its active run, and its active lease from the DB,
     * then computes the projected status.
     */
    async getIssueProjection(issueId: string): Promise<IssueProjection | null> {
      // Fetch the issue
      const [issue] = await db
        .select({
          id: issues.id,
          companyId: issues.companyId,
          status: issues.status,
          executionRunId: issues.executionRunId,
          checkoutRunId: issues.checkoutRunId,
          pickupFailCount: issues.pickupFailCount,
          lastReconciledAt: issues.lastReconciledAt,
        })
        .from(issues)
        .where(eq(issues.id, issueId));

      if (!issue) return null;

      // Fetch active run if there is an executionRunId
      let activeRun: { id: string; status: string } | null = null;
      if (issue.executionRunId) {
        const [run] = await db
          .select({
            id: heartbeatRuns.id,
            status: heartbeatRuns.status,
          })
          .from(heartbeatRuns)
          .where(
            and(
              eq(heartbeatRuns.id, issue.executionRunId),
              inArray(heartbeatRuns.status, ACTIVE_RUN_STATUSES),
            ),
          );
        activeRun = run ?? null;
      }

      // Fetch active lease for the issue
      const activeLease = await leaseMgr.getActiveLease(issueId);

      // Check for unresolved dependencies (VAL-REL-008)
      const hasUnresolvedDeps = await deps.hasUnresolvedDependencies(issueId, issue.companyId);

      return this.projectIssueStatus(
        issue,
        activeRun,
        activeLease
          ? { id: activeLease.id, state: activeLease.state }
          : null,
        issue.checkoutRunId,
        hasUnresolvedDeps,
      );
    },

    /**
     * When an issue transitions to done, reject all queued intents
     * and release all active leases for the issue.
     */
    async invalidateOnDone(
      issueId: string,
      companyId: string,
    ): Promise<{ rejectedIntents: number; releasedLeases: number }> {
      // Reject all queued intents for this issue
      const rejectedIntents = await intentQueue.invalidateForClosedIssue(
        issueId,
        companyId,
      );

      // Release all active leases for this issue
      const activeLeases = await db
        .select({ id: executionLeases.id })
        .from(executionLeases)
        .where(
          and(
            eq(executionLeases.issueId, issueId),
            sql`${executionLeases.state} IN ('granted', 'renewed')`,
          ),
        );

      let releasedLeases = 0;
      for (const lease of activeLeases) {
        try {
          await leaseMgr.releaseLease(lease.id, "issue_done");
          releasedLeases++;
        } catch {
          // Lease may have been concurrently released; ignore
        }
      }

      return { rejectedIntents, releasedLeases };
    },

    /**
     * Batch projection for a list of issue rows.
     *
     * Enriches each issue with projection metadata (projectedStatus,
     * activeRunId, activeLeaseId) in an efficient manner by batch-fetching
     * runs and leases.
     */
    async projectIssuesList<T extends { id: string; status: string; executionRunId: string | null; checkoutRunId: string | null; pickupFailCount: number; lastReconciledAt: Date | null }>(
      issueRows: T[],
    ): Promise<(T & IssueProjection)[]> {
      if (issueRows.length === 0) return [];

      // Batch fetch active runs
      const runIds = issueRows
        .map((row) => row.executionRunId)
        .filter((id): id is string => id != null);

      const runMap = new Map<string, { id: string; status: string }>();
      if (runIds.length > 0) {
        const runs = await db
          .select({
            id: heartbeatRuns.id,
            status: heartbeatRuns.status,
          })
          .from(heartbeatRuns)
          .where(
            and(
              inArray(heartbeatRuns.id, runIds),
              inArray(heartbeatRuns.status, ACTIVE_RUN_STATUSES),
            ),
          );
        for (const run of runs) {
          runMap.set(run.id, run);
        }
      }

      // Batch fetch active leases for all issues
      const issueIds = issueRows.map((row) => row.id);
      const leaseMap = new Map<string, { id: string; state: string }>();
      if (issueIds.length > 0) {
        const leases = await db
          .select({
            id: executionLeases.id,
            issueId: executionLeases.issueId,
            state: executionLeases.state,
          })
          .from(executionLeases)
          .where(
            and(
              inArray(executionLeases.issueId, issueIds),
              sql`${executionLeases.state} IN ('granted', 'renewed')`,
            ),
          );
        for (const lease of leases) {
          if (lease.issueId) {
            leaseMap.set(lease.issueId, { id: lease.id, state: lease.state });
          }
        }
      }

      // Batch fetch dependency data for all issues (VAL-REL-008)
      // Find which issues have at least one unresolved dependency
      const depBlockedSet = new Set<string>();
      if (issueIds.length > 0) {
        // Get all dependencies for these issues
        const allDeps = await db
          .select({
            issueId: issueDependencies.issueId,
            dependsOnIssueId: issueDependencies.dependsOnIssueId,
          })
          .from(issueDependencies)
          .where(inArray(issueDependencies.issueId, issueIds));

        if (allDeps.length > 0) {
          // Get unique dep target IDs and their statuses
          const depTargetIds = [...new Set(allDeps.map((d) => d.dependsOnIssueId))];
          const depIssueStatuses = await db
            .select({ id: issues.id, status: issues.status })
            .from(issues)
            .where(inArray(issues.id, depTargetIds));

          const statusMap = new Map(depIssueStatuses.map((i) => [i.id, i.status]));

          // For each issue, check if any dependency is not done
          for (const dep of allDeps) {
            const depStatus = statusMap.get(dep.dependsOnIssueId);
            if (!depStatus || depStatus !== "done") {
              depBlockedSet.add(dep.issueId);
            }
          }
        }
      }

      // Project each issue
      return issueRows.map((issue) => {
        const activeRun = issue.executionRunId
          ? (runMap.get(issue.executionRunId) ?? null)
          : null;
        const activeLease = leaseMap.get(issue.id) ?? null;

        const proj = this.projectIssueStatus(
          issue,
          activeRun,
          activeLease,
          issue.checkoutRunId,
          depBlockedSet.has(issue.id),
        );

        return {
          ...issue,
          ...proj,
        };
      });
    },
  };
}
