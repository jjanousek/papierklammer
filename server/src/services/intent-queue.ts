import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { Db } from "@papierklammer/db";
import { dispatchIntents } from "@papierklammer/db";
import { badRequest, conflict, notFound } from "../errors.js";

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
     */
    async createIntent(input: CreateIntentInput) {
      validateCreateInput(input);

      // Deduplication: supersede existing queued intents with the same dedupeKey
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
          priority: input.priority ?? 0,
          status: "queued",
          dedupeKey: input.dedupeKey ?? null,
          sourceEventId: input.sourceEventId ?? null,
          notBefore: input.notBefore ?? null,
        })
        .returning();

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
     */
    async admitIntent(intentId: string) {
      const intent = await requireIntent(intentId);
      assertTransition(intent.status, "admitted");

      const [updated] = await db
        .update(dispatchIntents)
        .set({
          status: "admitted",
          resolvedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(dispatchIntents.id, intentId))
        .returning();

      return updated;
    },

    /**
     * Transition queued → rejected.
     */
    async rejectIntent(intentId: string, reason: string) {
      const intent = await requireIntent(intentId);
      assertTransition(intent.status, "rejected");

      const [updated] = await db
        .update(dispatchIntents)
        .set({
          status: "rejected",
          resolvedAt: new Date(),
          updatedAt: new Date(),
          sourceEventId: reason,
        })
        .where(eq(dispatchIntents.id, intentId))
        .returning();

      return updated;
    },

    /**
     * Transition admitted → consumed. Records the runId.
     */
    async consumeIntent(intentId: string, runId: string) {
      const intent = await requireIntent(intentId);
      assertTransition(intent.status, "consumed");

      const [updated] = await db
        .update(dispatchIntents)
        .set({
          status: "consumed",
          updatedAt: new Date(),
        })
        .where(eq(dispatchIntents.id, intentId))
        .returning();

      return updated;
    },

    /**
     * Transition queued → superseded.
     */
    async supersedeIntent(intentId: string) {
      const intent = await requireIntent(intentId);
      assertTransition(intent.status, "superseded");

      const [updated] = await db
        .update(dispatchIntents)
        .set({
          status: "superseded",
          resolvedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(dispatchIntents.id, intentId))
        .returning();

      return updated;
    },

    /**
     * Transition queued → deferred.
     */
    async deferIntent(intentId: string, reason: string) {
      const intent = await requireIntent(intentId);
      assertTransition(intent.status, "deferred");

      const [updated] = await db
        .update(dispatchIntents)
        .set({
          status: "deferred",
          resolvedAt: new Date(),
          updatedAt: new Date(),
          sourceEventId: reason,
        })
        .where(eq(dispatchIntents.id, intentId))
        .returning();

      return updated;
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
     * Returns the count of rejected intents.
     */
    async invalidateForClosedIssue(issueId: string) {
      const result = await db
        .update(dispatchIntents)
        .set({
          status: "rejected",
          resolvedAt: new Date(),
          updatedAt: new Date(),
          sourceEventId: "issue closed",
        })
        .where(
          and(
            eq(dispatchIntents.issueId, issueId),
            eq(dispatchIntents.status, "queued"),
          ),
        )
        .returning();

      return result.length;
    },
  };
}
