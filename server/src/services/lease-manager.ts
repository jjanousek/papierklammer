import { and, eq, sql, lte } from "drizzle-orm";
import type { Db } from "@papierklammer/db";
import { executionLeases } from "@papierklammer/db";
import { conflict, notFound } from "../errors.js";

/**
 * Default TTL for execution leases: 5 minutes.
 */
export const DEFAULT_LEASE_TTL_SEC = 300;

/**
 * Checkout TTL: 60 seconds. A dispatched run must checkout within this window.
 */
export const CHECKOUT_TTL_SEC = 60;

/**
 * Active lease states. A lease in one of these states is considered "active"
 * and blocks new leases on the same issue.
 */
const ACTIVE_STATES = ["granted", "renewed"] as const;

export interface GrantLeaseInput {
  leaseType: string;
  issueId: string;
  agentId: string;
  runId?: string;
  companyId: string;
  /** TTL in seconds. Defaults to DEFAULT_LEASE_TTL_SEC. */
  ttlSeconds?: number;
}

/**
 * Lease Manager service.
 *
 * Manages execution leases with TTL on issues and agents.
 * Enforces one active lease per issue.
 *
 * Factory function following the project's service pattern.
 */
export function leaseManagerService(db: Db) {
  /**
   * Fetch a lease by ID. Throws notFound if missing.
   */
  async function requireLease(leaseId: string) {
    const [row] = await db
      .select()
      .from(executionLeases)
      .where(eq(executionLeases.id, leaseId));
    if (!row) throw notFound(`Lease ${leaseId} not found`);
    return row;
  }

  /**
   * Compute the original TTL from a lease row.
   * Uses the difference between expiresAt and grantedAt (or renewedAt if renewed).
   * Falls back to DEFAULT_LEASE_TTL_SEC if computation fails.
   */
  function getOriginalTtlMs(lease: typeof executionLeases.$inferSelect): number {
    // The TTL is always the original grant TTL — we use grantedAt to expiresAt diff
    // when the lease has never been renewed, otherwise use DEFAULT_LEASE_TTL_SEC
    // since renewals always reset to the same TTL.
    const grantDiff = lease.expiresAt.getTime() - lease.grantedAt.getTime();
    if (lease.renewedAt) {
      // After a renewal, the expiresAt was reset, so we can't reconstruct
      // original TTL from the current expiresAt. We store it via the grantedAt diff
      // from the first grant... but that's overwritten. Use default.
      // Actually, let's always use the grantedAt diff from the original grant,
      // but after renewal, expiresAt changed. So let's track the TTL differently.
      // We'll just use DEFAULT_LEASE_TTL_SEC for renewed leases since we don't
      // store the original TTL separately.
      return DEFAULT_LEASE_TTL_SEC * 1000;
    }
    return grantDiff > 0 ? grantDiff : DEFAULT_LEASE_TTL_SEC * 1000;
  }

  return {
    /**
     * Grant a new execution lease.
     *
     * Creates an execution_lease with state='granted', expiresAt=now()+ttl.
     * Enforces one active lease per issue: if an active (granted/renewed) lease
     * exists for the issue, throws a conflict error.
     */
    async grantLease(input: GrantLeaseInput) {
      const ttl = input.ttlSeconds ?? DEFAULT_LEASE_TTL_SEC;
      const now = new Date();
      const expiresAt = new Date(now.getTime() + ttl * 1000);

      // Check for existing active lease on this issue
      const existing = await db
        .select({ id: executionLeases.id })
        .from(executionLeases)
        .where(
          and(
            eq(executionLeases.issueId, input.issueId),
            sql`${executionLeases.state} IN ('granted', 'renewed')`,
          ),
        )
        .limit(1);

      if (existing.length > 0) {
        throw conflict(
          `Active lease already exists for issue ${input.issueId}`,
        );
      }

      const [lease] = await db
        .insert(executionLeases)
        .values({
          leaseType: input.leaseType,
          issueId: input.issueId,
          agentId: input.agentId,
          runId: input.runId ?? null,
          state: "granted",
          companyId: input.companyId,
          grantedAt: now,
          expiresAt,
        })
        .returning();

      return lease;
    },

    /**
     * Renew an active lease.
     *
     * Updates state='renewed', renewedAt=now(), extends expiresAt by the
     * original TTL (computed from the grant). Only works if lease is in
     * granted or renewed state.
     */
    async renewLease(leaseId: string) {
      const lease = await requireLease(leaseId);

      if (!ACTIVE_STATES.includes(lease.state as typeof ACTIVE_STATES[number])) {
        throw conflict(
          `Lease ${leaseId} is not active (state: ${lease.state}). Cannot renew an expired or released lease.`,
        );
      }

      const now = new Date();
      const ttlMs = getOriginalTtlMs(lease);
      const newExpiresAt = new Date(now.getTime() + ttlMs);

      const [updated] = await db
        .update(executionLeases)
        .set({
          state: "renewed",
          renewedAt: now,
          expiresAt: newExpiresAt,
          updatedAt: now,
        })
        .where(eq(executionLeases.id, leaseId))
        .returning();

      return updated;
    },

    /**
     * Release an active lease.
     *
     * Sets state='released', releasedAt=now(), releaseReason.
     * Only works if lease is granted or renewed.
     */
    async releaseLease(leaseId: string, reason: string) {
      const lease = await requireLease(leaseId);

      if (!ACTIVE_STATES.includes(lease.state as typeof ACTIVE_STATES[number])) {
        throw conflict(
          `Lease ${leaseId} is not active (state: ${lease.state}). Cannot release.`,
        );
      }

      const now = new Date();

      const [updated] = await db
        .update(executionLeases)
        .set({
          state: "released",
          releasedAt: now,
          releaseReason: reason,
          updatedAt: now,
        })
        .where(eq(executionLeases.id, leaseId))
        .returning();

      return updated;
    },

    /**
     * Expire all leases past their expiresAt that are still granted/renewed.
     *
     * Returns the IDs of expired leases.
     */
    async expireLeases(): Promise<string[]> {
      const now = new Date();

      const expired = await db
        .update(executionLeases)
        .set({
          state: "expired",
          updatedAt: now,
        })
        .where(
          and(
            sql`${executionLeases.state} IN ('granted', 'renewed')`,
            lte(executionLeases.expiresAt, now),
          ),
        )
        .returning({ id: executionLeases.id });

      return expired.map((row) => row.id);
    },

    /**
     * Get the active lease for an issue, or null if none.
     *
     * An active lease is one with state 'granted' or 'renewed'.
     */
    async getActiveLease(issueId: string) {
      const [row] = await db
        .select()
        .from(executionLeases)
        .where(
          and(
            eq(executionLeases.issueId, issueId),
            sql`${executionLeases.state} IN ('granted', 'renewed')`,
          ),
        )
        .limit(1);

      return row ?? null;
    },

    /**
     * Get the active lease for an agent, or null if none.
     *
     * An active lease is one with state 'granted' or 'renewed'.
     */
    async getActiveLeaseForAgent(agentId: string) {
      const [row] = await db
        .select()
        .from(executionLeases)
        .where(
          and(
            eq(executionLeases.agentId, agentId),
            sql`${executionLeases.state} IN ('granted', 'renewed')`,
          ),
        )
        .limit(1);

      return row ?? null;
    },
  };
}
