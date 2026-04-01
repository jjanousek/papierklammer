import { eq, sql } from "drizzle-orm";
import type { Db } from "@papierklammer/db";
import { agents, issueComments, issues } from "@papierklammer/db";
import { eventLogService } from "./event-log.js";
import { logger } from "../middleware/logger.js";

/**
 * Pickup failure escalation threshold: 2 failures within 15 minutes.
 */
const PICKUP_FAIL_THRESHOLD = 2;

/**
 * Time window for pickup failure escalation: 15 minutes.
 */
const PICKUP_FAIL_WINDOW_MS = 15 * 60 * 1000;

export interface EscalationResult {
  escalated: boolean;
  reason?: string;
  targetManagerId?: string | null;
}

/**
 * Escalation service.
 *
 * Tracks pickup failures and triggers auto-escalations when configured
 * thresholds are exceeded. Escalations are created as:
 * - A comment on the affected issue describing the failure
 * - An auto_escalation_created event in the control plane event log
 *
 * Escalation targets the agent's manager via the chain of command
 * (agents.reportsTo field).
 *
 * Factory function following the project's service pattern.
 */
export function escalationService(db: Db) {
  const eventLog = eventLogService(db);

  /**
   * Resolve the manager for an agent via the chain of command.
   * Returns the manager's ID, or null if no manager exists.
   */
  async function resolveManager(agentId: string): Promise<string | null> {
    const [agent] = await db
      .select({ reportsTo: agents.reportsTo })
      .from(agents)
      .where(eq(agents.id, agentId));

    return agent?.reportsTo ?? null;
  }

  /**
   * Create an escalation comment on an issue and emit the auto_escalation_created event.
   */
  async function createEscalation(input: {
    companyId: string;
    issueId: string;
    agentId: string;
    escalationType: string;
    reason: string;
    runId?: string;
    additionalPayload?: Record<string, unknown>;
  }): Promise<EscalationResult> {
    const targetManagerId = await resolveManager(input.agentId);

    // Create a comment on the issue describing the escalation
    const commentBody = `⚠️ **Auto-escalation** (${input.escalationType}): ${input.reason}`;

    await db
      .insert(issueComments)
      .values({
        companyId: input.companyId,
        issueId: input.issueId,
        authorAgentId: null,
        authorUserId: null,
        body: commentBody,
      });

    // Update issue's updatedAt so escalation activity is reflected
    await db
      .update(issues)
      .set({ updatedAt: new Date() })
      .where(eq(issues.id, input.issueId));

    // Emit auto_escalation_created event
    await eventLog.emit({
      companyId: input.companyId,
      entityType: "issue",
      entityId: input.issueId,
      eventType: "auto_escalation_created",
      payload: {
        escalationType: input.escalationType,
        reason: input.reason,
        agentId: input.agentId,
        issueId: input.issueId,
        targetManagerId,
        runId: input.runId ?? null,
        ...input.additionalPayload,
      },
    });

    logger.warn(
      {
        escalationType: input.escalationType,
        issueId: input.issueId,
        agentId: input.agentId,
        targetManagerId,
        runId: input.runId,
      },
      `Auto-escalation created: ${input.escalationType}`,
    );

    return {
      escalated: true,
      reason: input.reason,
      targetManagerId,
    };
  }

  return {
    /**
     * Increment pickup failure count on an issue.
     *
     * Called when a dispatched run fails to checkout within TTL.
     * Updates pickupFailCount and lastPickupFailureAt.
     */
    async incrementPickupFailure(issueId: string) {
      const now = new Date();

      const [updated] = await db
        .update(issues)
        .set({
          pickupFailCount: sql`${issues.pickupFailCount} + 1`,
          lastPickupFailureAt: now,
          updatedAt: now,
        })
        .where(eq(issues.id, issueId))
        .returning({
          id: issues.id,
          pickupFailCount: issues.pickupFailCount,
          lastPickupFailureAt: issues.lastPickupFailureAt,
        });

      return updated ?? null;
    },

    /**
     * Check if an issue has accumulated enough pickup failures to warrant
     * auto-escalation. Escalates when pickupFailCount >= 2 and the
     * lastPickupFailureAt is within the last 15 minutes.
     *
     * Creates an escalation comment on the issue and emits
     * auto_escalation_created event.
     */
    async checkAndEscalatePickupFailures(issueId: string): Promise<EscalationResult> {
      const [issue] = await db
        .select({
          id: issues.id,
          companyId: issues.companyId,
          assigneeAgentId: issues.assigneeAgentId,
          pickupFailCount: issues.pickupFailCount,
          lastPickupFailureAt: issues.lastPickupFailureAt,
        })
        .from(issues)
        .where(eq(issues.id, issueId));

      if (!issue) {
        return { escalated: false, reason: "Issue not found" };
      }

      // Check threshold
      if (issue.pickupFailCount < PICKUP_FAIL_THRESHOLD) {
        return { escalated: false, reason: "Below threshold" };
      }

      // Check time window — lastPickupFailureAt must be within 15 minutes
      if (!issue.lastPickupFailureAt) {
        return { escalated: false, reason: "No failure timestamp" };
      }

      const failureAge = Date.now() - issue.lastPickupFailureAt.getTime();
      if (failureAge > PICKUP_FAIL_WINDOW_MS) {
        return { escalated: false, reason: "Failures outside time window" };
      }

      if (!issue.assigneeAgentId) {
        return { escalated: false, reason: "No assignee agent" };
      }

      return createEscalation({
        companyId: issue.companyId,
        issueId: issue.id,
        agentId: issue.assigneeAgentId,
        escalationType: "pickup_failure",
        reason: `Agent failed to pickup issue ${issue.pickupFailCount} times within 15 minutes. Issue may require attention or reassignment.`,
        additionalPayload: {
          pickupFailCount: issue.pickupFailCount,
        },
      });
    },

    /**
     * Escalate a workspace binding failure.
     *
     * Called when workspace resolution fails during dispatch, indicating
     * a configuration problem that needs operator attention.
     */
    async escalateWorkspaceBindingFailure(input: {
      companyId: string;
      issueId: string;
      agentId: string;
      runId: string;
      reason: string;
    }): Promise<EscalationResult> {
      return createEscalation({
        companyId: input.companyId,
        issueId: input.issueId,
        agentId: input.agentId,
        escalationType: "workspace_binding_failure",
        reason: `Workspace binding failed: ${input.reason}. Run could not be dispatched.`,
        runId: input.runId,
      });
    },

    /**
     * Escalate a silent run completion.
     *
     * Called when a run completes after checkout without any status change,
     * comment, or keepalive — indicating the agent did no observable work.
     */
    async escalateSilentRunCompletion(input: {
      companyId: string;
      issueId: string;
      agentId: string;
      runId: string;
    }): Promise<EscalationResult> {
      return createEscalation({
        companyId: input.companyId,
        issueId: input.issueId,
        agentId: input.agentId,
        escalationType: "silent_run_completion",
        reason: `Run completed without updating issue status, creating a comment, or sending a keepalive. Agent may have failed silently.`,
        runId: input.runId,
      });
    },
  };
}
