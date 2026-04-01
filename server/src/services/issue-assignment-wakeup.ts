import type { Db } from "@papierklammer/db";
import { logger } from "../middleware/logger.js";
import type { intentQueueService } from "./intent-queue.js";
import { INTENT_PRIORITY_MAP } from "./intent-queue.js";

type WakeupTriggerDetail = "manual" | "ping" | "callback" | "system";
type WakeupSource = "timer" | "assignment" | "on_demand" | "automation";

/**
 * Priority for issue_assigned intents.
 * Re-exported from the canonical INTENT_PRIORITY_MAP for backward compat.
 */
export const ISSUE_ASSIGNED_PRIORITY = INTENT_PRIORITY_MAP.issue_assigned;

export interface IssueAssignmentWakeupDeps {
  wakeup: (
    agentId: string,
    opts: {
      source?: WakeupSource;
      triggerDetail?: WakeupTriggerDetail;
      reason?: string | null;
      payload?: Record<string, unknown> | null;
      requestedByActorType?: "user" | "agent" | "system";
      requestedByActorId?: string | null;
      contextSnapshot?: Record<string, unknown>;
    },
  ) => Promise<unknown>;
}

/**
 * Legacy wakeup path: calls heartbeat.wakeup() directly to create a heartbeat_run.
 * Retained for backward compatibility during the migration to intent-driven dispatch.
 */
export function queueIssueAssignmentWakeup(input: {
  heartbeat: IssueAssignmentWakeupDeps;
  issue: { id: string; assigneeAgentId: string | null; status: string };
  reason: string;
  mutation: string;
  contextSource: string;
  requestedByActorType?: "user" | "agent" | "system";
  requestedByActorId?: string | null;
  rethrowOnError?: boolean;
}) {
  if (!input.issue.assigneeAgentId || input.issue.status === "backlog") return;

  return input.heartbeat
    .wakeup(input.issue.assigneeAgentId, {
      source: "assignment",
      triggerDetail: "system",
      reason: input.reason,
      payload: { issueId: input.issue.id, mutation: input.mutation },
      requestedByActorType: input.requestedByActorType,
      requestedByActorId: input.requestedByActorId ?? null,
      contextSnapshot: { issueId: input.issue.id, source: input.contextSource },
    })
    .catch((err) => {
      logger.warn({ err, issueId: input.issue.id }, "failed to wake assignee on issue assignment");
      if (input.rethrowOnError) throw err;
      return null;
    });
}

/**
 * Intent-driven wakeup path: creates an issue_assigned dispatch_intent
 * instead of calling heartbeat.wakeup() directly.
 *
 * This is the new path for the intent-driven dispatch system.
 * The intent will be picked up by the scheduler for admission control.
 */
export async function queueIssueAssignmentIntent(input: {
  db: Db;
  intentQueue: ReturnType<typeof intentQueueService>;
  issue: {
    id: string;
    assigneeAgentId: string | null;
    status: string;
    companyId: string;
    projectId: string | null;
  };
  reason: string;
  rethrowOnError?: boolean;
}) {
  if (!input.issue.assigneeAgentId || input.issue.status === "backlog") return;

  try {
    return await input.intentQueue.createIntent({
      companyId: input.issue.companyId,
      issueId: input.issue.id,
      projectId: input.issue.projectId ?? "",
      targetAgentId: input.issue.assigneeAgentId,
      intentType: "issue_assigned",
      priority: ISSUE_ASSIGNED_PRIORITY,
      dedupeKey: `issue:${input.issue.id}`,
      sourceEventId: input.reason,
    });
  } catch (err) {
    logger.warn(
      { err, issueId: input.issue.id },
      "failed to create issue_assigned intent",
    );
    if (input.rethrowOnError) throw err;
    return null;
  }
}
