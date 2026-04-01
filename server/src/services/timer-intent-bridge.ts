import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@papierklammer/db";
import { agents, issues } from "@papierklammer/db";
import type { intentQueueService } from "./intent-queue.js";
import { INTENT_PRIORITY_MAP } from "./intent-queue.js";
import { parseObject, asNumber, asBoolean } from "../adapters/utils.js";

/**
 * Issue statuses considered "open" for timer-hint intents.
 * Backlog issues are excluded — they should not trigger timer wakes.
 */
const OPEN_ACTIONABLE_STATUSES = ["todo", "in_progress", "in_review", "blocked"];

/**
 * Timer hint priority: lowest priority value.
 * Re-exported from the canonical INTENT_PRIORITY_MAP for backward compat.
 */
export const TIMER_HINT_PRIORITY = INTENT_PRIORITY_MAP.timer_hint;

/**
 * Parse heartbeat policy from agent's runtimeConfig.
 * Matches the logic in heartbeat.ts parseHeartbeatPolicy().
 */
function parseHeartbeatPolicy(agent: typeof agents.$inferSelect) {
  const runtimeConfig = parseObject(agent.runtimeConfig);
  const heartbeat = parseObject(runtimeConfig.heartbeat);
  const intervalSec = Math.max(0, asNumber(heartbeat.intervalSec, 0));

  return {
    enabled: asBoolean(heartbeat.enabled, true),
    intervalSec,
  };
}

/**
 * Replacement for the original tickTimers() in heartbeatService.
 *
 * Instead of calling enqueueWakeup() (which creates heartbeat_runs),
 * this creates timer_hint dispatch_intent rows for each open issue
 * assigned to agents whose heartbeat timer has elapsed.
 *
 * Timer hints have the lowest priority (0) and use dedupeKey 'issue:<issueId>'
 * (unified with assignment intents) so they are superseded when higher-priority
 * intents exist for the same issue.
 */
export async function tickTimers(
  db: Db,
  intentQueue: ReturnType<typeof intentQueueService>,
  now = new Date(),
) {
  const allAgents = await db.select().from(agents);
  let checked = 0;
  let intentsCreated = 0;
  let skipped = 0;

  for (const agent of allAgents) {
    // Skip non-invokable agents
    if (
      agent.status === "paused" ||
      agent.status === "terminated" ||
      agent.status === "pending_approval"
    ) {
      continue;
    }

    const policy = parseHeartbeatPolicy(agent);
    if (!policy.enabled || policy.intervalSec <= 0) continue;

    checked += 1;

    // Check if enough time has elapsed since last heartbeat
    const baseline = new Date(agent.lastHeartbeatAt ?? agent.createdAt).getTime();
    const elapsedMs = now.getTime() - baseline;
    if (elapsedMs < policy.intervalSec * 1000) continue;

    // Find all open, actionable issues assigned to this agent
    const openIssues = await db
      .select({
        id: issues.id,
        companyId: issues.companyId,
        projectId: issues.projectId,
      })
      .from(issues)
      .where(
        and(
          eq(issues.assigneeAgentId, agent.id),
          eq(issues.companyId, agent.companyId),
          inArray(issues.status, OPEN_ACTIONABLE_STATUSES),
        ),
      );

    if (openIssues.length === 0) {
      skipped += 1;
      continue;
    }

    // Create a timer_hint intent for each open issue
    for (const issue of openIssues) {
      try {
        await intentQueue.createIntent({
          companyId: issue.companyId,
          issueId: issue.id,
          projectId: issue.projectId ?? "",
          targetAgentId: agent.id,
          intentType: "timer_hint",
          priority: TIMER_HINT_PRIORITY,
          dedupeKey: `issue:${issue.id}`,
          sourceEventId: "heartbeat_timer",
        });
        intentsCreated += 1;
      } catch {
        // Silently skip if intent creation fails (e.g., missing projectId)
        skipped += 1;
      }
    }
  }

  return { checked, intentsCreated, skipped };
}
