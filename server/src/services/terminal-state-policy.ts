import { and, eq, gte, sql } from "drizzle-orm";
import type { Db } from "@papierklammer/db";
import {
  controlPlaneEvents,
  executionLeases,
  heartbeatRuns,
  issueComments,
  issues,
} from "@papierklammer/db";
import { escalationService } from "./escalation.js";
import { eventLogService } from "./event-log.js";
import { issueService } from "./issues.js";
import { logger } from "../middleware/logger.js";

/**
 * Terminal-state policy for checked-out issues.
 *
 * When a run completes (succeeds), the server checks if the agent performed
 * any terminal action during execution:
 * - Status change on the issue
 * - Comment creation on the issue
 * - Explicit keepalive (lease renewal via run activity)
 *
 * If the run checked out an issue but ended without any of these actions,
 * the run is marked as failed with errorCode='terminal_state_violation'
 * and an auto-comment is added to the issue explaining the failure.
 * This also triggers escalation.
 *
 * Factory function following the project's service pattern.
 */
export function terminalStatePolicyService(db: Db) {
  const eventLog = eventLogService(db);
  const escalation = escalationService(db);
  const issueSvc = issueService(db);

  /**
   * Check if a run performed any terminal action on its checked-out issue.
   *
   * Terminal actions include:
   * 1. Issue status change (issue_status_changed event for this issue during the run)
   * 2. Comment creation (issue_comments created during the run window)
   * 3. Explicit keepalive (lease_renewed event for this issue during the run)
   *
   * @returns true if any terminal action was detected, false if silent completion
   */
  async function hasTerminalAction(input: {
    companyId: string;
    runId: string;
    issueId: string;
    runStartedAt: Date;
    runFinishedAt: Date;
  }): Promise<boolean> {
    const { companyId, runId, issueId, runStartedAt, runFinishedAt } = input;

    // 1. Check for issue_status_changed events during the run
    const statusChangeEvents = await db
      .select({ id: controlPlaneEvents.id })
      .from(controlPlaneEvents)
      .where(
        and(
          eq(controlPlaneEvents.companyId, companyId),
          eq(controlPlaneEvents.entityType, "issue"),
          eq(controlPlaneEvents.entityId, issueId),
          eq(controlPlaneEvents.eventType, "issue_status_changed"),
          gte(controlPlaneEvents.createdAt, runStartedAt),
        ),
      )
      .limit(1);

    if (statusChangeEvents.length > 0) return true;

    // 2. Check for comments created during the run
    const comments = await db
      .select({ id: issueComments.id })
      .from(issueComments)
      .where(
        and(
          eq(issueComments.companyId, companyId),
          eq(issueComments.issueId, issueId),
          gte(issueComments.createdAt, runStartedAt),
        ),
      )
      .limit(1);

    if (comments.length > 0) return true;

    // 3. Check for lease renewal activity (keepalive) during the run
    const leaseRenewals = await db
      .select({ id: controlPlaneEvents.id })
      .from(controlPlaneEvents)
      .where(
        and(
          eq(controlPlaneEvents.companyId, companyId),
          eq(controlPlaneEvents.entityType, "lease"),
          eq(controlPlaneEvents.eventType, "lease_renewed"),
          gte(controlPlaneEvents.createdAt, runStartedAt),
          // Match lease renewals for this issue by checking payload
          sql`(${controlPlaneEvents.payload}->>'issueId')::text = ${issueId}`,
        ),
      )
      .limit(1);

    if (leaseRenewals.length > 0) return true;

    return false;
  }

  return {
    /**
     * Enforce the terminal-state policy for a completed run.
     *
     * Should be called after a run succeeds. Checks if the run had a
     * checked-out issue and whether any terminal action was performed.
     *
     * If no terminal action was found:
     * 1. Marks the run as failed with errorCode='terminal_state_violation'
     * 2. Auto-creates a comment on the issue explaining the failure
     * 3. Triggers escalation
     *
     * @returns { violated: true, ... } if the policy was violated, { violated: false } otherwise
     */
    async enforceOnRunCompletion(input: {
      runId: string;
      companyId: string;
      agentId: string;
      issueId: string | null;
      runStartedAt: Date | null;
      runFinishedAt: Date;
    }): Promise<{ violated: boolean; reason?: string }> {
      const { runId, companyId, agentId, issueId, runStartedAt, runFinishedAt } = input;

      // Only applies to runs that had a checked-out issue
      if (!issueId) {
        return { violated: false };
      }

      // Check if the issue was actually checked out by this run
      const [issue] = await db
        .select({
          id: issues.id,
          checkoutRunId: issues.checkoutRunId,
          status: issues.status,
        })
        .from(issues)
        .where(
          and(
            eq(issues.id, issueId),
            eq(issues.companyId, companyId),
          ),
        );

      if (!issue) {
        return { violated: false };
      }

      // Only enforce if this run actually checked out the issue
      if (issue.checkoutRunId !== runId) {
        return { violated: false };
      }

      // Don't enforce if the issue is already in a terminal state (done/cancelled)
      // — the agent may have transitioned it and the checkout was already released
      if (issue.status === "done" || issue.status === "cancelled") {
        return { violated: false };
      }

      const effectiveStartedAt = runStartedAt ?? new Date(runFinishedAt.getTime() - 60_000);

      // Check for any terminal action
      const hasAction = await hasTerminalAction({
        companyId,
        runId,
        issueId,
        runStartedAt: effectiveStartedAt,
        runFinishedAt,
      });

      if (hasAction) {
        return { violated: false };
      }

      // Policy violated — silent completion
      const reason =
        "Run completed without updating issue status, creating a comment, or sending a keepalive";

      // 1. Mark the run as failed with terminal_state_violation
      await db
        .update(heartbeatRuns)
        .set({
          status: "failed",
          error: reason,
          errorCode: "terminal_state_violation",
          updatedAt: new Date(),
        })
        .where(eq(heartbeatRuns.id, runId));

      // 2. Emit run_failed event
      await eventLog.emit({
        companyId,
        entityType: "run",
        entityId: runId,
        eventType: "run_failed",
        payload: {
          runId,
          agentId,
          issueId,
          errorCode: "terminal_state_violation",
          reason,
        },
      });

      // 3. Auto-create a comment on the issue explaining the failure
      try {
        await issueSvc.addComment(
          issueId,
          `⚠️ **Terminal-state policy violation**: ${reason}`,
          {},
        );
      } catch (err) {
        logger.warn(
          { err, runId, issueId },
          "Failed to add terminal-state violation comment to issue",
        );
      }

      // 4. Trigger escalation
      try {
        await escalation.escalateSilentRunCompletion({
          companyId,
          issueId,
          agentId,
          runId,
        });
      } catch (err) {
        logger.warn(
          { err, runId, issueId },
          "Failed to escalate silent run completion",
        );
      }

      logger.warn(
        { runId, issueId, agentId, companyId },
        "Terminal-state policy violated: silent run completion",
      );

      return { violated: true, reason };
    },
  };
}
