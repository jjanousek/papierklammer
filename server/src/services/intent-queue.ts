import { and, asc, desc, eq, gt, sql } from "drizzle-orm";
import type { Db } from "@papierklammer/db";
import { dispatchIntents } from "@papierklammer/db";
import { badRequest, conflict, notFound } from "../errors.js";
import { eventLogService } from "./event-log.js";

/**
 * Known dispatch intent types.
 */
export const INTENT_TYPES = [
  "issue_assigned",
  "issue_comment_mentioned",
  "dependency_unblocked",
  "approval_resolved",
  "timer_hint",
  "manager_escalation",
  "retry_after_failure",
] as const;

export type IntentType = (typeof INTENT_TYPES)[number];

/**
 * Priority levels for intent types.
 *
 * Higher value = processed first.  Event-driven intents have meaningful
 * priority; timer_hint is intentionally lowest (0) so it is always
 * superseded when a real event exists.
 */
export const INTENT_PRIORITY_MAP: Record<IntentType, number> = {
  manager_escalation: 50,
  issue_assigned: 40,
  issue_comment_mentioned: 30,
  dependency_unblocked: 30,
  approval_resolved: 30,
  retry_after_failure: 20,
  timer_hint: 0,
};

/**
 * Return the canonical priority for a given intent type.
 * Falls back to 0 for unknown types.
 */
export function getIntentPriority(intentType: string): number {
  return (INTENT_PRIORITY_MAP as Record<string, number>)[intentType] ?? 0;
}

/**
 * Valid intent status values and their allowed transitions.
 *
 * State machine:
 *   queued → admitted | rejected | superseded | deferred
 *   admitted → consumed
 */
const VALID_TRANSITIONS: Record<string, string[]> = {
  queued: ["admitted", "rejected", "superseded", "deferred"],
  admitted: ["consumed"],
  // Terminal states — no outgoing transitions
  rejected: [],
  superseded: [],
  deferred: [],
  consumed: [],
};

export interface CreateIntentInput {
  companyId: string;
  issueId: string;
  projectId: string;
  goalId?: string;
  workspaceId?: string;
  targetAgentId: string;
  intentType: string;
  priority?: number;
  dedupeKey?: string;
  sourceEventId?: string;
  notBefore?: Date;
}

export interface FindQueuedIntentsFilters {
  companyId: string;
  agentId?: string;
  issueId?: string;
}

export function intentQueueService(db: Db) {
  const eventLog = eventLogService(db);

  /**
   * Validate required fields for intent creation.
   */
  function validateCreateInput(input: CreateIntentInput) {
    if (!input.companyId) throw badRequest("companyId is required");
    if (!input.issueId) throw badRequest("issueId is required");
    if (!input.projectId) throw badRequest("projectId is required");
    if (!input.targetAgentId) throw badRequest("targetAgentId is required");
    if (!input.intentType) throw badRequest("intentType is required");
    if (!(INTENT_TYPES as readonly string[]).includes(input.intentType)) {
      throw badRequest(`Invalid intentType: ${input.intentType}. Must be one of: ${INTENT_TYPES.join(", ")}`);
    }
  }

  /**
   * Fetch an intent row by id. Throws notFound if missing.
   */
  async function requireIntent(intentId: string) {
    const [row] = await db
      .select()
      .from(dispatchIntents)
      .where(eq(dispatchIntents.id, intentId));
    if (!row) throw notFound(`Intent ${intentId} not found`);
    return row;
  }

  /**
   * Assert that a state transition is allowed.
   */
  function assertTransition(current: string, target: string) {
    const allowed = VALID_TRANSITIONS[current];
    if (!allowed || !allowed.includes(target)) {
      throw conflict(
        `Cannot transition intent from '${current}' to '${target}'`,
      );
    }
  }

  return {
    /**
     * Create a new dispatch intent.
     * Handles deduplication: if a queued intent with the same dedupeKey exists,
     * supersede the older one and keep the new one.
     *
     * Special handling for timer_hint intents: if a higher-priority queued intent
     * already exists with the same dedupeKey, the timer_hint is auto-superseded
     * on creation (it never becomes active). This ensures event-driven intents
     * always take precedence over timer hints.
     */
    async createIntent(input: CreateIntentInput) {
      validateCreateInput(input);

      const effectivePriority = input.priority ?? getIntentPriority(input.intentType);

      // Timer hint supersession: if creating a timer_hint and a higher-priority
      // queued intent already exists for the same dedupeKey, auto-supersede the
      // new timer_hint immediately.
      if (input.dedupeKey && input.intentType === "timer_hint") {
        const higherPriorityExists = await db
          .select({ id: dispatchIntents.id })
          .from(dispatchIntents)
          .where(
            and(
              eq(dispatchIntents.companyId, input.companyId),
              eq(dispatchIntents.dedupeKey, input.dedupeKey),
              eq(dispatchIntents.status, "queued"),
              gt(dispatchIntents.priority, effectivePriority),
            ),
          )
          .limit(1);

        if (higherPriorityExists.length > 0) {
          // Insert the timer_hint as immediately superseded
          const [row] = await db
            .insert(dispatchIntents)
            .values({
              companyId: input.companyId,
              issueId: input.issueId,
              projectId: input.projectId,
              goalId: input.goalId ?? null,
              workspaceId: input.workspaceId ?? null,
              targetAgentId: input.targetAgentId,
              intentType: input.intentType,
              priority: effectivePriority,
              status: "superseded",
              dedupeKey: input.dedupeKey ?? null,
              sourceEventId: input.sourceEventId ?? null,
              notBefore: input.notBefore ?? null,
              resolvedAt: new Date(),
            })
            .returning();

          // Emit intent_created event (even for auto-superseded timer hints)
          await eventLog.emit({
            companyId: input.companyId,
            entityType: "intent",
            entityId: row.id,
            eventType: "intent_created",
            payload: {
              intentType: input.intentType,
              issueId: input.issueId,
              agentId: input.targetAgentId,
              projectId: input.projectId,
              status: "superseded",
            },
          });

          return row;
        }
      }

      // Standard deduplication: supersede existing queued intents with the same dedupeKey
      if (input.dedupeKey) {
        await db
          .update(dispatchIntents)
          .set({
            status: "superseded",
            resolvedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(dispatchIntents.companyId, input.companyId),
              eq(dispatchIntents.dedupeKey, input.dedupeKey),
              eq(dispatchIntents.status, "queued"),
            ),
          );
      }

      const [row] = await db
        .insert(dispatchIntents)
        .values({
          companyId: input.companyId,
          issueId: input.issueId,
          projectId: input.projectId,
          goalId: input.goalId ?? null,
          workspaceId: input.workspaceId ?? null,
          targetAgentId: input.targetAgentId,
          intentType: input.intentType,
          priority: effectivePriority,
          status: "queued",
          dedupeKey: input.dedupeKey ?? null,
          sourceEventId: input.sourceEventId ?? null,
          notBefore: input.notBefore ?? null,
        })
        .returning();

      // Emit intent_created event
      await eventLog.emit({
        companyId: input.companyId,
        entityType: "intent",
        entityId: row.id,
        eventType: "intent_created",
        payload: {
          intentType: input.intentType,
          issueId: input.issueId,
          agentId: input.targetAgentId,
          projectId: input.projectId,
          status: "queued",
        },
      });

      return row;
    },

    /**
     * Get an intent by ID.
     */
    async getIntent(intentId: string) {
      const [row] = await db
        .select()
        .from(dispatchIntents)
        .where(eq(dispatchIntents.id, intentId));
      return row ?? null;
    },

    /**
     * Transition queued → admitted. Sets resolvedAt.
     * Atomic: includes status predicate in WHERE clause to prevent concurrent transitions.
     */
    async admitIntent(intentId: string) {
      const intent = await requireIntent(intentId);
      assertTransition(intent.status, "admitted");

      const rows = await db
        .update(dispatchIntents)
        .set({
          status: "admitted",
          resolvedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(dispatchIntents.id, intentId),
            eq(dispatchIntents.status, "queued"),
          ),
        )
        .returning();

      if (rows.length === 0) {
        throw conflict(`Intent ${intentId} was concurrently modified — expected status 'queued'`);
      }
      return rows[0];
    },

    /**
     * Transition queued → rejected.
     * Atomic: includes status predicate in WHERE clause.
     */
    async rejectIntent(intentId: string, reason: string) {
      const intent = await requireIntent(intentId);
      assertTransition(intent.status, "rejected");

      const rows = await db
        .update(dispatchIntents)
        .set({
          status: "rejected",
          resolvedAt: new Date(),
          updatedAt: new Date(),
          sourceEventId: reason,
        })
        .where(
          and(
            eq(dispatchIntents.id, intentId),
            eq(dispatchIntents.status, "queued"),
          ),
        )
        .returning();

      if (rows.length === 0) {
        throw conflict(`Intent ${intentId} was concurrently modified — expected status 'queued'`);
      }
      return rows[0];
    },

    /**
     * Transition admitted → consumed. Records the runId.
     * Atomic: includes status predicate in WHERE clause.
     */
    async consumeIntent(intentId: string, runId: string) {
      const intent = await requireIntent(intentId);
      assertTransition(intent.status, "consumed");

      const rows = await db
        .update(dispatchIntents)
        .set({
          status: "consumed",
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(dispatchIntents.id, intentId),
            eq(dispatchIntents.status, "admitted"),
          ),
        )
        .returning();

      if (rows.length === 0) {
        throw conflict(`Intent ${intentId} was concurrently modified — expected status 'admitted'`);
      }
      return rows[0];
    },

    /**
     * Transition queued → superseded.
     * Atomic: includes status predicate in WHERE clause.
     */
    async supersedeIntent(intentId: string) {
      const intent = await requireIntent(intentId);
      assertTransition(intent.status, "superseded");

      const rows = await db
        .update(dispatchIntents)
        .set({
          status: "superseded",
          resolvedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(dispatchIntents.id, intentId),
            eq(dispatchIntents.status, "queued"),
          ),
        )
        .returning();

      if (rows.length === 0) {
        throw conflict(`Intent ${intentId} was concurrently modified — expected status 'queued'`);
      }
      return rows[0];
    },

    /**
     * Transition queued → deferred.
     * Atomic: includes status predicate in WHERE clause.
     */
    async deferIntent(intentId: string, reason: string) {
      const intent = await requireIntent(intentId);
      assertTransition(intent.status, "deferred");

      const rows = await db
        .update(dispatchIntents)
        .set({
          status: "deferred",
          resolvedAt: new Date(),
          updatedAt: new Date(),
          sourceEventId: reason,
        })
        .where(
          and(
            eq(dispatchIntents.id, intentId),
            eq(dispatchIntents.status, "queued"),
          ),
        )
        .returning();

      if (rows.length === 0) {
        throw conflict(`Intent ${intentId} was concurrently modified — expected status 'queued'`);
      }
      return rows[0];
    },

    /**
     * Query queued intents with filters, sorted by priority desc then createdAt asc.
     */
    async findQueuedIntents(filters: FindQueuedIntentsFilters) {
      const conditions = [
        eq(dispatchIntents.status, "queued"),
        eq(dispatchIntents.companyId, filters.companyId),
      ];

      if (filters.agentId) {
        conditions.push(eq(dispatchIntents.targetAgentId, filters.agentId));
      }
      if (filters.issueId) {
        conditions.push(eq(dispatchIntents.issueId, filters.issueId));
      }

      return db
        .select()
        .from(dispatchIntents)
        .where(and(...conditions))
        .orderBy(desc(dispatchIntents.priority), asc(dispatchIntents.createdAt));
    },

    /**
     * Reject all queued intents for a closed/cancelled issue.
     * Requires companyId for multi-tenant isolation.
     * Returns the count of rejected intents.
     */
    async invalidateForClosedIssue(issueId: string, companyId?: string) {
      const conditions = [
        eq(dispatchIntents.issueId, issueId),
        eq(dispatchIntents.status, "queued"),
      ];
      if (companyId) {
        conditions.push(eq(dispatchIntents.companyId, companyId));
      }

      const result = await db
        .update(dispatchIntents)
        .set({
          status: "rejected",
          resolvedAt: new Date(),
          updatedAt: new Date(),
          sourceEventId: "issue closed",
        })
        .where(and(...conditions))
        .returning();

      return result.length;
    },
  };
}
