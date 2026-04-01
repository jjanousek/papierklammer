import { and, eq, sql, lte, inArray } from "drizzle-orm";
import type { Db } from "@papierklammer/db";
import {
  agents,
  heartbeatRuns,
  dispatchIntents,
  executionLeases,
  issues,
} from "@papierklammer/db";

/**
 * Active run statuses for counting purposes.
 */
const ACTIVE_RUN_STATUSES = ["queued", "running"];

/**
 * Active lease states for counting purposes.
 */
const ACTIVE_LEASE_STATES = ["granted", "renewed"];

/**
 * Default stale intent threshold: 1 hour in milliseconds.
 */
const STALE_INTENT_THRESHOLD_MS = 60 * 60 * 1000;

export interface AgentOverview {
  id: string;
  name: string;
  status: string;
  activeRunCount: number;
  queuedIntentCount: number;
}

export interface StaleRun {
  runId: string;
  agentId: string;
  startedAt: Date | null;
  reason: string;
}

export interface StaleIntent {
  intentId: string;
  createdAt: Date;
  reason: string;
}

export interface OrphanedLease {
  leaseId: string;
  issueId: string | null;
  expiresAt: Date;
}

export interface StaleRunForCleanup {
  runId: string;
  leaseId: string;
}

export interface StaleIntentForCleanup {
  id: string;
}

export interface AgentWithCompany {
  id: string;
  companyId: string;
  name: string;
}

export interface AgentAssignedIssue {
  id: string;
  projectId: string | null;
}

/**
 * Orchestrator service.
 *
 * Provides DB-level queries for the orchestrator console routes.
 * All methods are company-scoped for multi-tenant isolation.
 *
 * Factory function following the project's service pattern.
 */
export function orchestratorService(db: Db) {
  return {
    /**
     * Get all agents for a company with their active run and queued intent counts.
     */
    async getAgentOverviews(companyId: string): Promise<{
      agents: AgentOverview[];
      totalActiveLeases: number;
    }> {
      // Fetch all agents for the company
      const companyAgents = await db
        .select({
          id: agents.id,
          name: agents.name,
          status: agents.status,
        })
        .from(agents)
        .where(eq(agents.companyId, companyId));

      // Count active runs per agent
      const activeRunCounts = await db
        .select({
          agentId: heartbeatRuns.agentId,
          count: sql<number>`count(*)::int`,
        })
        .from(heartbeatRuns)
        .where(
          and(
            eq(heartbeatRuns.companyId, companyId),
            inArray(heartbeatRuns.status, ACTIVE_RUN_STATUSES),
          ),
        )
        .groupBy(heartbeatRuns.agentId);

      const runCountMap = new Map(
        activeRunCounts.map((r) => [r.agentId, r.count]),
      );

      // Count queued intents per agent
      const queuedIntentCounts = await db
        .select({
          agentId: dispatchIntents.targetAgentId,
          count: sql<number>`count(*)::int`,
        })
        .from(dispatchIntents)
        .where(
          and(
            eq(dispatchIntents.companyId, companyId),
            eq(dispatchIntents.status, "queued"),
          ),
        )
        .groupBy(dispatchIntents.targetAgentId);

      const intentCountMap = new Map(
        queuedIntentCounts.map((r) => [r.agentId, r.count]),
      );

      // Count active leases total
      const [leaseCountRow] = await db
        .select({
          count: sql<number>`count(*)::int`,
        })
        .from(executionLeases)
        .where(
          and(
            eq(executionLeases.companyId, companyId),
            inArray(executionLeases.state, ACTIVE_LEASE_STATES),
          ),
        );

      const agentList = companyAgents.map((agent) => ({
        id: agent.id,
        name: agent.name,
        status: agent.status,
        activeRunCount: runCountMap.get(agent.id) ?? 0,
        queuedIntentCount: intentCountMap.get(agent.id) ?? 0,
      }));

      return {
        agents: agentList,
        totalActiveLeases: leaseCountRow?.count ?? 0,
      };
    },

    /**
     * Get stale items for a company: runs past TTL, intents queued too long,
     * and leases past expiry not yet reaped.
     */
    async getStaleItems(companyId: string): Promise<{
      staleRuns: StaleRun[];
      staleIntents: StaleIntent[];
      orphanedLeases: OrphanedLease[];
    }> {
      const now = new Date();

      // Stale runs: active runs whose associated lease is expired
      const staleRunRows = await db
        .select({
          runId: heartbeatRuns.id,
          agentId: heartbeatRuns.agentId,
          startedAt: heartbeatRuns.startedAt,
          leaseState: executionLeases.state,
          leaseExpiresAt: executionLeases.expiresAt,
        })
        .from(heartbeatRuns)
        .leftJoin(
          executionLeases,
          eq(heartbeatRuns.id, executionLeases.runId),
        )
        .where(
          and(
            eq(heartbeatRuns.companyId, companyId),
            inArray(heartbeatRuns.status, ACTIVE_RUN_STATUSES),
            sql`(${executionLeases.expiresAt} IS NOT NULL AND ${executionLeases.expiresAt} < ${now})`,
          ),
        );

      const staleRuns: StaleRun[] = staleRunRows.map((r) => ({
        runId: r.runId,
        agentId: r.agentId,
        startedAt: r.startedAt,
        reason: "lease_expired",
      }));

      // Stale intents: queued for more than 1 hour
      const staleIntentThreshold = new Date(
        now.getTime() - STALE_INTENT_THRESHOLD_MS,
      );
      const staleIntentRows = await db
        .select({
          intentId: dispatchIntents.id,
          createdAt: dispatchIntents.createdAt,
        })
        .from(dispatchIntents)
        .where(
          and(
            eq(dispatchIntents.companyId, companyId),
            eq(dispatchIntents.status, "queued"),
            lte(dispatchIntents.createdAt, staleIntentThreshold),
          ),
        );

      const staleIntents: StaleIntent[] = staleIntentRows.map((r) => ({
        intentId: r.intentId,
        createdAt: r.createdAt,
        reason: "queued_too_long",
      }));

      // Orphaned leases: past expiry but still in active state
      const orphanedLeaseRows = await db
        .select({
          leaseId: executionLeases.id,
          issueId: executionLeases.issueId,
          expiresAt: executionLeases.expiresAt,
        })
        .from(executionLeases)
        .where(
          and(
            eq(executionLeases.companyId, companyId),
            inArray(executionLeases.state, ACTIVE_LEASE_STATES),
            lte(executionLeases.expiresAt, now),
          ),
        );

      const orphanedLeases: OrphanedLease[] = orphanedLeaseRows.map((r) => ({
        leaseId: r.leaseId,
        issueId: r.issueId,
        expiresAt: r.expiresAt,
      }));

      return { staleRuns, staleIntents, orphanedLeases };
    },

    /**
     * Find stale runs (active with expired leases) for bulk cleanup.
     */
    async findStaleRunsForCleanup(companyId: string): Promise<StaleRunForCleanup[]> {
      const now = new Date();

      return db
        .select({
          runId: heartbeatRuns.id,
          leaseId: executionLeases.id,
        })
        .from(heartbeatRuns)
        .innerJoin(
          executionLeases,
          eq(heartbeatRuns.id, executionLeases.runId),
        )
        .where(
          and(
            eq(heartbeatRuns.companyId, companyId),
            inArray(heartbeatRuns.status, ACTIVE_RUN_STATUSES),
            lte(executionLeases.expiresAt, now),
            inArray(executionLeases.state, ACTIVE_LEASE_STATES),
          ),
        );
    },

    /**
     * Cancel a run by marking it as failed.
     */
    async cancelRun(runId: string): Promise<void> {
      const now = new Date();
      await db
        .update(heartbeatRuns)
        .set({
          status: "failed",
          error: "Cancelled by orchestrator: stale run cleanup",
          finishedAt: now,
          updatedAt: now,
        })
        .where(eq(heartbeatRuns.id, runId));
    },

    /**
     * Find stale intents (queued > 1 hour) for bulk cleanup.
     */
    async findStaleIntentsForCleanup(companyId: string): Promise<StaleIntentForCleanup[]> {
      const now = new Date();
      const staleThreshold = new Date(
        now.getTime() - STALE_INTENT_THRESHOLD_MS,
      );

      return db
        .select({ id: dispatchIntents.id })
        .from(dispatchIntents)
        .where(
          and(
            eq(dispatchIntents.companyId, companyId),
            eq(dispatchIntents.status, "queued"),
            lte(dispatchIntents.createdAt, staleThreshold),
          ),
        );
    },

    /**
     * Get an agent by ID with company info.
     */
    async getAgent(agentId: string): Promise<AgentWithCompany | null> {
      const [agent] = await db
        .select({
          id: agents.id,
          companyId: agents.companyId,
          name: agents.name,
        })
        .from(agents)
        .where(eq(agents.id, agentId));

      return agent ?? null;
    },

    /**
     * Find an agent's most recent assigned issue (for nudge).
     */
    async findAgentAssignedIssue(companyId: string, agentId: string): Promise<AgentAssignedIssue | null> {
      const [assignedIssue] = await db
        .select({
          id: issues.id,
          projectId: issues.projectId,
        })
        .from(issues)
        .where(
          and(
            eq(issues.companyId, companyId),
            eq(issues.assigneeAgentId, agentId),
            inArray(issues.status, ["todo", "in_progress", "backlog"]),
          ),
        )
        .limit(1);

      return assignedIssue ?? null;
    },

    /**
     * Clear execution lock on an issue.
     */
    async clearIssueLock(issueId: string): Promise<void> {
      await db
        .update(issues)
        .set({
          executionRunId: null,
          executionLockedAt: null,
          updatedAt: new Date(),
        })
        .where(eq(issues.id, issueId));
    },
  };
}
