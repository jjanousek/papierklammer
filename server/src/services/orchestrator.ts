import { and, desc, eq, inArray, isNotNull, isNull, lte, not, or, sql } from "drizzle-orm";
import type { Db } from "@papierklammer/db";
import {
  agents,
  heartbeatRuns,
  dispatchIntents,
  executionLeases,
  issues,
} from "@papierklammer/db";
import { heartbeatService } from "./heartbeat.js";
import { summarizeHeartbeatRunResultJson } from "./heartbeat-run-summary.js";

/**
 * Active run statuses for counting purposes.
 */
const ACTIVE_RUN_STATUSES = ["queued", "running"];
const ORPHANED_RUN_STATUSES = ["running"];

/**
 * Active lease states for counting purposes.
 */
const ACTIVE_LEASE_STATES = ["granted", "renewed"];
const STALE_LEASE_STATES = ["granted", "renewed", "expired"];

/**
 * Default stale intent threshold: 1 hour in milliseconds.
 */
const STALE_INTENT_THRESHOLD_MS = 60 * 60 * 1000;

const ACTIVE_NUDGE_STATUSES = ["in_progress", "blocked", "todo"];
const RUN_REVIEW_TEXT_KEYS = ["summary", "result", "message", "error"] as const;

const NUDGE_STATUS_PRIORITY = sql<number>`
  case
    when ${issues.status} = 'in_progress' then 0
    when ${issues.status} = 'blocked' then 1
    when ${issues.status} = 'todo' then 2
    else 99
  end
`;

export interface AgentOverview {
  agentId: string;
  name: string;
  status: string;
  activeRunCount: number;
  queuedIntentCount: number;
}

export interface RunReviewEntry {
  runId: string;
  status: string;
  agentId: string;
  agentName: string;
  issueId: string | null;
  issueIdentifier: string | null;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  resultSummaryText: string | null;
  stdoutExcerpt: string | null;
  stderrExcerpt: string | null;
}

function compactRunReviewText(value: string | null | undefined, maxLength = 320) {
  if (!value) return null;
  const normalized = value
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!normalized) return null;
  return normalized.length <= maxLength
    ? normalized
    : `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function extractRunReviewText(
  resultJson: Record<string, unknown> | null | undefined,
  stdoutExcerpt: string | null | undefined,
  stderrExcerpt: string | null | undefined,
) {
  const summarized = summarizeHeartbeatRunResultJson(resultJson);
  if (summarized) {
    for (const key of RUN_REVIEW_TEXT_KEYS) {
      const value = summarized[key];
      if (typeof value === "string") {
        const compacted = compactRunReviewText(value);
        if (compacted) return compacted;
      }
    }
  }

  return compactRunReviewText(stderrExcerpt) ?? compactRunReviewText(stdoutExcerpt);
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
  leaseId: string | null;
  leaseState: string | null;
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

function buildRecoveredIssuePatch(now: Date) {
  return {
    status: sql`case
      when ${issues.status} in ('in_progress', 'blocked') then 'todo'
      else ${issues.status}
    end`,
    checkoutRunId: null,
    executionRunId: null,
    executionAgentNameKey: null,
    executionLockedAt: null,
    pickupFailCount: 0,
    lastPickupFailureAt: null,
    lastReconciledAt: now,
    updatedAt: now,
  };
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
  const heartbeat = heartbeatService(db);

  async function clearIssueLockInternal(issueId: string, companyId?: string): Promise<void> {
    const now = new Date();
    const conditions = [eq(issues.id, issueId)];
    if (companyId) {
      conditions.push(eq(issues.companyId, companyId));
    }

    await db
      .update(issues)
      .set(buildRecoveredIssuePatch(now))
      .where(and(...conditions));
  }

  return {
    /**
     * Get all agents for a company with their active run and queued intent counts.
     */
    async getAgentOverviews(companyId: string): Promise<{
      agents: AgentOverview[];
      totalActiveLeases: number;
      activeRuns: RunReviewEntry[];
      recentRuns: RunReviewEntry[];
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

      const runIssueId = sql<string | null>`${heartbeatRuns.contextSnapshot} ->> 'issueId'`;
      const runReviewSort = desc(
        sql`coalesce(${heartbeatRuns.finishedAt}, ${heartbeatRuns.startedAt}, ${heartbeatRuns.createdAt})`,
      );

      const activeRunRows = await db
        .select({
          runId: heartbeatRuns.id,
          status: heartbeatRuns.status,
          agentId: heartbeatRuns.agentId,
          agentName: agents.name,
          issueId: runIssueId.as("issueId"),
          issueIdentifier: issues.identifier,
          createdAt: heartbeatRuns.createdAt,
          startedAt: heartbeatRuns.startedAt,
          finishedAt: heartbeatRuns.finishedAt,
          resultJson: heartbeatRuns.resultJson,
          stdoutExcerpt: heartbeatRuns.stdoutExcerpt,
          stderrExcerpt: heartbeatRuns.stderrExcerpt,
        })
        .from(heartbeatRuns)
        .innerJoin(
          agents,
          and(eq(agents.id, heartbeatRuns.agentId), eq(agents.companyId, companyId)),
        )
        .leftJoin(
          issues,
          and(eq(issues.companyId, companyId), sql`${issues.id}::text = ${runIssueId}`),
        )
        .where(
          and(
            eq(heartbeatRuns.companyId, companyId),
            inArray(heartbeatRuns.status, ACTIVE_RUN_STATUSES),
          ),
        )
        .orderBy(runReviewSort, desc(heartbeatRuns.createdAt))
        .limit(8);

      const recentRunRows = await db
        .select({
          runId: heartbeatRuns.id,
          status: heartbeatRuns.status,
          agentId: heartbeatRuns.agentId,
          agentName: agents.name,
          issueId: runIssueId.as("issueId"),
          issueIdentifier: issues.identifier,
          createdAt: heartbeatRuns.createdAt,
          startedAt: heartbeatRuns.startedAt,
          finishedAt: heartbeatRuns.finishedAt,
          resultJson: heartbeatRuns.resultJson,
          stdoutExcerpt: heartbeatRuns.stdoutExcerpt,
          stderrExcerpt: heartbeatRuns.stderrExcerpt,
        })
        .from(heartbeatRuns)
        .innerJoin(
          agents,
          and(eq(agents.id, heartbeatRuns.agentId), eq(agents.companyId, companyId)),
        )
        .leftJoin(
          issues,
          and(eq(issues.companyId, companyId), sql`${issues.id}::text = ${runIssueId}`),
        )
        .where(
          and(
            eq(heartbeatRuns.companyId, companyId),
            not(inArray(heartbeatRuns.status, ACTIVE_RUN_STATUSES)),
          ),
        )
        .orderBy(runReviewSort, desc(heartbeatRuns.createdAt))
        .limit(8);

      const toRunReviewEntry = (
        row: typeof activeRunRows[number] | typeof recentRunRows[number],
      ): RunReviewEntry => ({
        runId: row.runId,
        status: row.status,
        agentId: row.agentId,
        agentName: row.agentName,
        issueId: row.issueId,
        issueIdentifier: row.issueIdentifier ?? null,
        createdAt: row.createdAt,
        startedAt: row.startedAt,
        finishedAt: row.finishedAt,
        resultSummaryText: extractRunReviewText(
          row.resultJson,
          row.stdoutExcerpt,
          row.stderrExcerpt,
        ),
        stdoutExcerpt: compactRunReviewText(row.stdoutExcerpt),
        stderrExcerpt: compactRunReviewText(row.stderrExcerpt),
      });

      const agentList = companyAgents.map((agent) => ({
        agentId: agent.id,
        name: agent.name,
        status: agent.status,
        activeRunCount: runCountMap.get(agent.id) ?? 0,
        queuedIntentCount: intentCountMap.get(agent.id) ?? 0,
      }));

      return {
        agents: agentList,
        totalActiveLeases: leaseCountRow?.count ?? 0,
        activeRuns: activeRunRows.map(toRunReviewEntry),
        recentRuns: recentRunRows.map(toRunReviewEntry),
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

      // Stale runs: active runs whose associated lease is expired/past expiry.
      const staleRunRows = await db
        .select({
          runId: heartbeatRuns.id,
          agentId: heartbeatRuns.agentId,
          startedAt: heartbeatRuns.startedAt,
          leaseState: executionLeases.state,
          leaseExpiresAt: executionLeases.expiresAt,
        })
        .from(heartbeatRuns)
        .innerJoin(
          executionLeases,
          and(
            eq(heartbeatRuns.id, executionLeases.runId),
            eq(executionLeases.companyId, companyId),
          ),
        )
        .where(
          and(
            eq(heartbeatRuns.companyId, companyId),
            inArray(heartbeatRuns.status, ACTIVE_RUN_STATUSES),
            lte(executionLeases.expiresAt, now),
            inArray(executionLeases.state, STALE_LEASE_STATES),
          ),
        );

      const orphanedRunRows = await db
        .select({
          runId: heartbeatRuns.id,
          agentId: heartbeatRuns.agentId,
          startedAt: heartbeatRuns.startedAt,
        })
        .from(heartbeatRuns)
        .leftJoin(
          executionLeases,
          and(
            eq(heartbeatRuns.id, executionLeases.runId),
            eq(executionLeases.companyId, companyId),
            inArray(executionLeases.state, ACTIVE_LEASE_STATES),
          ),
        )
        .where(
          and(
            eq(heartbeatRuns.companyId, companyId),
            inArray(heartbeatRuns.status, ORPHANED_RUN_STATUSES),
            isNull(executionLeases.id),
          ),
        );

      const staleRunMap = new Map<string, StaleRun>();
      for (const row of staleRunRows) {
        staleRunMap.set(row.runId, {
          runId: row.runId,
          agentId: row.agentId,
          startedAt: row.startedAt,
          reason: "lease_expired",
        });
      }
      for (const row of orphanedRunRows) {
        if (!staleRunMap.has(row.runId)) {
          staleRunMap.set(row.runId, {
            runId: row.runId,
            agentId: row.agentId,
            startedAt: row.startedAt,
            reason: "orphaned_active_run",
          });
        }
      }

      const staleRuns = [...staleRunMap.values()];

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

      const staleLeaseRows = await db
        .select({
          runId: heartbeatRuns.id,
          leaseId: executionLeases.id,
          leaseState: executionLeases.state,
        })
        .from(heartbeatRuns)
        .innerJoin(
          executionLeases,
          and(
            eq(heartbeatRuns.id, executionLeases.runId),
            eq(executionLeases.companyId, companyId),
          ),
        )
        .where(
          and(
            eq(heartbeatRuns.companyId, companyId),
            inArray(heartbeatRuns.status, ACTIVE_RUN_STATUSES),
            lte(executionLeases.expiresAt, now),
            inArray(executionLeases.state, STALE_LEASE_STATES),
          ),
        );

      const orphanedRunRows = await db
        .select({
          runId: heartbeatRuns.id,
        })
        .from(heartbeatRuns)
        .leftJoin(
          executionLeases,
          and(
            eq(heartbeatRuns.id, executionLeases.runId),
            eq(executionLeases.companyId, companyId),
            inArray(executionLeases.state, ACTIVE_LEASE_STATES),
          ),
        )
        .where(
          and(
            eq(heartbeatRuns.companyId, companyId),
            inArray(heartbeatRuns.status, ORPHANED_RUN_STATUSES),
            isNull(executionLeases.id),
          ),
        );

      const staleRunMap = new Map<string, StaleRunForCleanup>();
      for (const row of staleLeaseRows) {
        const existing = staleRunMap.get(row.runId);
        const existingIsReleaseable = existing ? existing.leaseState !== "expired" : false;
        const nextIsReleaseable = row.leaseState !== "expired";
        if (!existing || (!existingIsReleaseable && nextIsReleaseable)) {
          staleRunMap.set(row.runId, {
            runId: row.runId,
            leaseId: row.leaseId,
            leaseState: row.leaseState,
          });
        }
      }
      for (const row of orphanedRunRows) {
        if (!staleRunMap.has(row.runId)) {
          staleRunMap.set(row.runId, {
            runId: row.runId,
            leaseId: null,
            leaseState: null,
          });
        }
      }

      return [...staleRunMap.values()];
    },

    /**
     * Cancel a run by marking it as failed.
     */
    async cancelRun(runId: string): Promise<boolean> {
      const now = new Date();
      const cancelled = await db
        .update(heartbeatRuns)
        .set({
          status: "failed",
          error: "Cancelled by orchestrator: stale run cleanup",
          finishedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(heartbeatRuns.id, runId),
            inArray(heartbeatRuns.status, ACTIVE_RUN_STATUSES),
          ),
        )
        .returning({ id: heartbeatRuns.id });

      return cancelled.length > 0;
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
     * Find an agent's deterministic active assigned issue for nudge.
     *
     * Priority order:
     * 1. in_progress
     * 2. blocked
     * 3. todo
     *
     * Within a status bucket, prefer the most recently started/updated work.
     * Backlog-only assignments are intentionally excluded so nudge targets
     * active work instead of arbitrarily selecting unscheduled backlog items.
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
            inArray(issues.status, ACTIVE_NUDGE_STATUSES),
            isNotNull(issues.projectId),
          ),
        )
        .orderBy(
          NUDGE_STATUS_PRIORITY,
          sql`${issues.startedAt} desc nulls last`,
          desc(issues.updatedAt),
          desc(issues.createdAt),
          desc(issues.id),
        )
        .limit(1);

      return assignedIssue ?? null;
    },

    /**
     * Clear execution lock on an issue.
     */
    async clearIssueLock(issueId: string, companyId?: string): Promise<void> {
      await clearIssueLockInternal(issueId, companyId);
    },

    /**
     * Manual unblock must also resolve any still-active run linked to the issue,
     * otherwise convergeExecutionState can immediately rebind the recovered issue
     * back onto queued/running work on the next read.
     */
    async recoverIssueForManualUnblock(
      issueId: string,
      companyId: string,
      executionRunId: string | null,
      checkoutRunId: string | null,
    ): Promise<string[]> {
      const linkConditions = [sql`${heartbeatRuns.contextSnapshot} ->> 'issueId' = ${issueId}`];
      if (executionRunId) {
        linkConditions.push(eq(heartbeatRuns.id, executionRunId));
      }
      if (checkoutRunId) {
        linkConditions.push(eq(heartbeatRuns.id, checkoutRunId));
      }

      const linkedRuns = await db
        .select({ id: heartbeatRuns.id })
        .from(heartbeatRuns)
        .where(
          and(
            eq(heartbeatRuns.companyId, companyId),
            inArray(heartbeatRuns.status, ACTIVE_RUN_STATUSES),
            or(...linkConditions),
          ),
        );

      const activeRunIds = [...new Set(linkedRuns.map((row) => row.id))];
      for (const runId of activeRunIds) {
        await heartbeat.cancelRun(runId);
      }

      await clearIssueLockInternal(issueId, companyId);
      return activeRunIds;
    },

    /**
     * Recover issues linked to a stale run by clearing execution ownership,
     * restoring them to a schedulable state, and resetting stale pickup state.
     */
    async recoverIssueForRun(companyId: string, runId: string): Promise<string[]> {
      const now = new Date();
      const recovered = await db
        .update(issues)
        .set(buildRecoveredIssuePatch(now))
        .where(
          and(
            eq(issues.companyId, companyId),
            or(
              eq(issues.executionRunId, runId),
              eq(issues.checkoutRunId, runId),
            ),
          ),
        )
        .returning({ id: issues.id });

      return recovered.map((row) => row.id);
    },
  };
}
