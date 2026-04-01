import { and, asc, desc, eq, gte, sql } from "drizzle-orm";
import type { Db } from "@papierklammer/db";
import { controlPlaneEvents } from "@papierklammer/db";

/**
 * Known control-plane event types.
 *
 * Each event is emitted at a specific lifecycle point:
 * - intent_created: when an intent is added to the queue
 * - intent_admitted: when the scheduler admits an intent
 * - intent_rejected: when the scheduler rejects an intent
 * - run_started: when a heartbeat run transitions to running
 * - run_completed: when a run finishes successfully
 * - run_failed: when a run finishes with failure
 * - run_cancelled: when a run is cancelled (e.g., by stale reaper)
 * - lease_allocated: when an execution lease is granted
 * - lease_renewed: when an execution lease is renewed
 * - lease_expired: when an execution lease expires
 * - checkout_acquired: when an issue checkout succeeds
 * - checkout_conflict: when an issue checkout fails due to conflict
 * - issue_status_changed: when an issue status is updated
 * - workspace_resolution_failed: when workspace resolution fails at dispatch
 * - auto_escalation_created: when an auto-escalation is triggered
 */
export const EVENT_TYPES = [
  "intent_created",
  "intent_admitted",
  "intent_rejected",
  "run_started",
  "run_completed",
  "run_failed",
  "run_cancelled",
  "lease_allocated",
  "lease_renewed",
  "lease_expired",
  "checkout_acquired",
  "checkout_conflict",
  "issue_status_changed",
  "workspace_resolution_failed",
  "auto_escalation_created",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

/**
 * Known entity types for events.
 */
export const ENTITY_TYPES = [
  "intent",
  "run",
  "lease",
  "issue",
] as const;

export type EntityType = (typeof ENTITY_TYPES)[number];

export interface EmitEventInput {
  companyId: string;
  entityType: string;
  entityId: string;
  eventType: string;
  payload?: Record<string, unknown>;
}

export interface QueryEventsFilters {
  companyId: string;
  entityType?: string;
  entityId?: string;
  eventType?: string;
  since?: Date;
  limit?: number;
}

/**
 * Event Log service.
 *
 * Append-only event log backed by the `control_plane_events` table.
 * Provides insert (emit) and query operations. No update or delete
 * methods are exposed — events are immutable once written.
 *
 * Factory function following the project's service pattern.
 */
export function eventLogService(db: Db) {
  return {
    /**
     * Emit (insert) a new event into the control plane event log.
     *
     * This is append-only — once written, events cannot be modified or deleted.
     */
    async emit(input: EmitEventInput) {
      const [event] = await db
        .insert(controlPlaneEvents)
        .values({
          companyId: input.companyId,
          entityType: input.entityType,
          entityId: input.entityId,
          eventType: input.eventType,
          payload: input.payload ?? null,
        })
        .returning();

      return event;
    },

    /**
     * Query events with filters.
     *
     * Supports filtering by companyId (required), entityType, entityId,
     * eventType, since (timestamp), and limit. Results are ordered by
     * createdAt descending (newest first).
     */
    async query(filters: QueryEventsFilters) {
      const conditions = [
        eq(controlPlaneEvents.companyId, filters.companyId),
      ];

      if (filters.entityType) {
        conditions.push(eq(controlPlaneEvents.entityType, filters.entityType));
      }
      if (filters.entityId) {
        conditions.push(eq(controlPlaneEvents.entityId, filters.entityId));
      }
      if (filters.eventType) {
        conditions.push(eq(controlPlaneEvents.eventType, filters.eventType));
      }
      if (filters.since) {
        conditions.push(gte(controlPlaneEvents.createdAt, filters.since));
      }

      let query = db
        .select()
        .from(controlPlaneEvents)
        .where(and(...conditions))
        .orderBy(desc(controlPlaneEvents.createdAt));

      if (filters.limit) {
        query = query.limit(filters.limit) as typeof query;
      }

      return query;
    },
  };
}
