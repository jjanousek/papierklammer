import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@papierklammer/db";
import {
  agents,
  dispatchIntents,
  executionEnvelopes,
  executionLeases,
  heartbeatRuns,
  issues,
  projectWorkspaces,
} from "@papierklammer/db";
import { intentQueueService } from "./intent-queue.js";
import { budgetService } from "./budgets.js";
import { eventLogService } from "./event-log.js";
import { dependencyService } from "./dependency.js";
import { lookupWarmWorkspace } from "./warm-workspace-pool.js";
import { logger } from "../middleware/logger.js";
import { parseObject, asNumber } from "../adapters/utils.js";

const HEARTBEAT_MAX_CONCURRENT_RUNS_DEFAULT = 1;
const HEARTBEAT_MAX_CONCURRENT_RUNS_MAX = 10;
const DEFAULT_LEASE_TTL_SEC = 300;

/**
 * Issue statuses considered closed / terminal.
 * An intent for an issue in one of these statuses is rejected.
 */
const CLOSED_ISSUE_STATUSES = ["done", "cancelled"];

export interface AdmissionResult {
  admitted: boolean;
  reason?: string;
}

function normalizeMaxConcurrentRuns(value: unknown) {
  const parsed = Math.floor(asNumber(value, HEARTBEAT_MAX_CONCURRENT_RUNS_DEFAULT));
  if (!Number.isFinite(parsed)) return HEARTBEAT_MAX_CONCURRENT_RUNS_DEFAULT;
  return Math.max(
    HEARTBEAT_MAX_CONCURRENT_RUNS_DEFAULT,
    Math.min(HEARTBEAT_MAX_CONCURRENT_RUNS_MAX, parsed),
  );
}

/**
 * Scheduler service.
 *
 * Consumes queued intents from the intent queue and decides whether they
 * become runs. Admission checks are run in order:
 *
 * 1. notBefore — skip if not yet due
 * 2. Issue still open (not done/cancelled)
 * 3. Assignee matches targetAgentId
 * 4. Workspace exists and is available
 * 5. No active execution lease on the issue
 * 6. Agent not at maxConcurrentRuns capacity
 * 7. Budget allows execution
 *
 * If all checks pass the intent is admitted, a lease is created,
 * an envelope is created, and a heartbeat_run is linked.
 */
export function schedulerService(db: Db) {
  const intentQueue = intentQueueService(db);
  const budgets = budgetService(db);
  const eventLog = eventLogService(db);
  const deps = dependencyService(db);

  /**
   * Count currently running runs for an agent, scoped to a company.
   */
  async function countRunningRunsForAgent(agentId: string, companyId: string): Promise<number> {
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)` })
      .from(heartbeatRuns)
      .where(
        and(
          eq(heartbeatRuns.agentId, agentId),
          eq(heartbeatRuns.companyId, companyId),
          eq(heartbeatRuns.status, "running"),
        ),
      );
    return Number(count ?? 0);
  }

  /**
   * Parse the maxConcurrentRuns from agent's runtimeConfig.heartbeat.
   */
  function getMaxConcurrentRuns(agent: typeof agents.$inferSelect): number {
    const runtimeConfig = parseObject(agent.runtimeConfig);
    const heartbeat = parseObject(runtimeConfig.heartbeat);
    return normalizeMaxConcurrentRuns(heartbeat.maxConcurrentRuns);
  }

  /**
   * Run all admission checks for an intent without side effects.
   * Returns { admitted: true } or { admitted: false, reason: "..." }.
   */
  async function checkAdmission(
    intent: typeof dispatchIntents.$inferSelect,
    now = new Date(),
  ): Promise<AdmissionResult> {
    // 1. notBefore — skip if not yet due
    if (intent.notBefore && intent.notBefore.getTime() > now.getTime()) {
      return { admitted: false, reason: "notBefore is in the future" };
    }

    // 2. Issue still open (company-scoped)
    const [issue] = await db
      .select()
      .from(issues)
      .where(
        and(
          eq(issues.id, intent.issueId),
          eq(issues.companyId, intent.companyId),
        ),
      );
    if (!issue) {
      return { admitted: false, reason: "issue not found" };
    }
    if (CLOSED_ISSUE_STATUSES.includes(issue.status)) {
      return { admitted: false, reason: "issue closed" };
    }

    // 2b. Dependency gate — issue must not have unresolved dependencies (VAL-REL-009)
    const blocked = await deps.hasUnresolvedDependencies(intent.issueId, intent.companyId);
    if (blocked) {
      return { admitted: false, reason: "blocked on dependency" };
    }

    // 3. Assignee matches targetAgentId
    if (issue.assigneeAgentId !== intent.targetAgentId) {
      return { admitted: false, reason: "assignee mismatch" };
    }

    // 4. Workspace exists and is available (company-scoped)
    if (intent.workspaceId) {
      const [workspace] = await db
        .select()
        .from(projectWorkspaces)
        .where(
          and(
            eq(projectWorkspaces.id, intent.workspaceId),
            eq(projectWorkspaces.companyId, intent.companyId),
          ),
        );
      if (!workspace) {
        return { admitted: false, reason: "workspace not found" };
      }
    } else if (issue.projectId) {
      // For project-bound issues, verify the project has at least one workspace
      const workspaces = await db
        .select({ id: projectWorkspaces.id })
        .from(projectWorkspaces)
        .where(
          and(
            eq(projectWorkspaces.projectId, issue.projectId),
            eq(projectWorkspaces.companyId, intent.companyId),
          ),
        )
        .limit(1);
      if (workspaces.length === 0) {
        return { admitted: false, reason: "workspace not found" };
      }
    }

    // 5. No active execution lease on the issue (company-scoped)
    const activeLeases = await db
      .select({ id: executionLeases.id })
      .from(executionLeases)
      .where(
        and(
          eq(executionLeases.issueId, intent.issueId),
          eq(executionLeases.companyId, intent.companyId),
          sql`${executionLeases.state} IN ('granted', 'renewed')`,
        ),
      )
      .limit(1);
    if (activeLeases.length > 0) {
      return { admitted: false, reason: "active lease exists on issue" };
    }

    // 6. Agent not at maxConcurrentRuns capacity (company-scoped)
    const [agent] = await db
      .select()
      .from(agents)
      .where(
        and(
          eq(agents.id, intent.targetAgentId),
          eq(agents.companyId, intent.companyId),
        ),
      );
    if (!agent) {
      return { admitted: false, reason: "agent not found" };
    }
    const maxConcurrentRuns = getMaxConcurrentRuns(agent);
    const runningCount = await countRunningRunsForAgent(intent.targetAgentId, intent.companyId);
    if (runningCount >= maxConcurrentRuns) {
      return { admitted: false, reason: "agent at max concurrent runs" };
    }

    // 7. Budget allows execution
    const budgetBlock = await budgets.getInvocationBlock(
      intent.companyId,
      intent.targetAgentId,
      {
        issueId: intent.issueId,
        projectId: intent.projectId,
      },
    );
    if (budgetBlock) {
      return { admitted: false, reason: `budget exhausted: ${budgetBlock.reason}` };
    }

    return { admitted: true };
  }

  /**
   * Process a single intent by ID.
   *
   * Runs admission checks. If admitted:
   * - Transitions intent to admitted
   * - Creates an execution lease
   * - Creates an execution envelope
   * - Creates a heartbeat_run linked to intent and envelope
   *
   * If any check fails: rejects or defers with specific reason.
   *
   * Returns the admission result.
   */
  async function processIntent(
    intentId: string,
    now = new Date(),
  ): Promise<AdmissionResult & { runId?: string; leaseId?: string; envelopeId?: string }> {
    const intent = await intentQueue.getIntent(intentId);
    if (!intent) {
      return { admitted: false, reason: "intent not found" };
    }
    if (intent.status !== "queued") {
      return { admitted: false, reason: `intent is not queued (status: ${intent.status})` };
    }

    const admission = await checkAdmission(intent, now);
    if (!admission.admitted) {
      // Skip notBefore intents — leave them queued for later processing
      // (aligned with batch method processQueuedIntents which also skips these)
      if (admission.reason === "notBefore is in the future") {
        return admission;
      }
      // Defer if at capacity, reject otherwise
      const deferReasons = ["agent at max concurrent runs", "blocked on dependency"];
      if (admission.reason && deferReasons.includes(admission.reason)) {
        await intentQueue.deferIntent(intentId, admission.reason);
      } else {
        await intentQueue.rejectIntent(intentId, admission.reason ?? "admission denied");

        // Emit intent_rejected event
        await eventLog.emit({
          companyId: intent.companyId,
          entityType: "intent",
          entityId: intentId,
          eventType: "intent_rejected",
          payload: {
            intentId,
            intentType: intent.intentType,
            issueId: intent.issueId,
            agentId: intent.targetAgentId,
            reason: admission.reason ?? "admission denied",
          },
        });
      }
      return admission;
    }

    // Admit the intent
    await intentQueue.admitIntent(intentId);

    // Emit intent_admitted event
    await eventLog.emit({
      companyId: intent.companyId,
      entityType: "intent",
      entityId: intentId,
      eventType: "intent_admitted",
      payload: {
        intentId,
        intentType: intent.intentType,
        issueId: intent.issueId,
        agentId: intent.targetAgentId,
      },
    });

    // Create execution lease with stored TTL for accurate renewal
    const leaseExpiresAt = new Date(now.getTime() + DEFAULT_LEASE_TTL_SEC * 1000);
    const [lease] = await db
      .insert(executionLeases)
      .values({
        leaseType: "issue_execution",
        issueId: intent.issueId,
        agentId: intent.targetAgentId,
        state: "granted",
        ttlSeconds: DEFAULT_LEASE_TTL_SEC,
        companyId: intent.companyId,
        grantedAt: now,
        expiresAt: leaseExpiresAt,
      })
      .returning();

    // Emit lease_allocated event
    await eventLog.emit({
      companyId: intent.companyId,
      entityType: "lease",
      entityId: lease.id,
      eventType: "lease_allocated",
      payload: {
        leaseId: lease.id,
        issueId: intent.issueId,
        agentId: intent.targetAgentId,
        ttlSeconds: DEFAULT_LEASE_TTL_SEC,
        expiresAt: leaseExpiresAt.toISOString(),
      },
    });

    // Create heartbeat_run (queued status, linked to intent)
    const [run] = await db
      .insert(heartbeatRuns)
      .values({
        companyId: intent.companyId,
        agentId: intent.targetAgentId,
        invocationSource: "scheduler",
        triggerDetail: intent.intentType,
        status: "queued",
        intentId: intent.id,
        contextSnapshot: {
          issueId: intent.issueId,
          projectId: intent.projectId,
          goalId: intent.goalId,
          workspaceId: intent.workspaceId,
        },
      })
      .returning();

    // Update lease with runId
    await db
      .update(executionLeases)
      .set({ runId: run.id, updatedAt: new Date() })
      .where(eq(executionLeases.id, lease.id));

    // Resolve workspace for envelope (company-scoped)
    // First, check the warm workspace pool for sticky routing
    let resolvedWorkspaceId = intent.workspaceId;
    if (!resolvedWorkspaceId && intent.projectId) {
      const warmWs = await lookupWarmWorkspace(db, intent.projectId);
      if (warmWs) {
        resolvedWorkspaceId = warmWs.workspaceId;
        logger.debug(
          {
            intentId: intent.id,
            projectId: intent.projectId,
            warmWorkspaceId: warmWs.workspaceId,
          },
          "Scheduler using warm workspace for sticky routing",
        );
      }
    }
    if (!resolvedWorkspaceId && intent.projectId) {
      const [primaryWs] = await db
        .select({ id: projectWorkspaces.id })
        .from(projectWorkspaces)
        .where(
          and(
            eq(projectWorkspaces.projectId, intent.projectId),
            eq(projectWorkspaces.companyId, intent.companyId),
            eq(projectWorkspaces.isPrimary, true),
          ),
        )
        .limit(1);
      if (primaryWs) {
        resolvedWorkspaceId = primaryWs.id;
      } else {
        // Fall back to first workspace for the project (company-scoped)
        const [firstWs] = await db
          .select({ id: projectWorkspaces.id })
          .from(projectWorkspaces)
          .where(
            and(
              eq(projectWorkspaces.projectId, intent.projectId),
              eq(projectWorkspaces.companyId, intent.companyId),
            ),
          )
          .limit(1);
        resolvedWorkspaceId = firstWs?.id ?? null;
      }
    }

    // Create execution envelope
    const [envelope] = await db
      .insert(executionEnvelopes)
      .values({
        runId: run.id,
        companyId: intent.companyId,
        agentId: intent.targetAgentId,
        issueId: intent.issueId,
        projectId: intent.projectId,
        goalId: intent.goalId ?? null,
        workspaceId: resolvedWorkspaceId ?? null,
        wakeReason: intent.intentType,
        runKind: "standard",
        executionPolicyVersion: "1",
        workspaceBindingMode: intent.projectId
          ? "required_project_workspace"
          : "explicit_ad_hoc_workspace",
      })
      .returning();

    // Link the envelope to the run
    await db
      .update(heartbeatRuns)
      .set({ envelopeId: envelope.id, updatedAt: new Date() })
      .where(eq(heartbeatRuns.id, run.id));

    // Emit run_started event
    await eventLog.emit({
      companyId: intent.companyId,
      entityType: "run",
      entityId: run.id,
      eventType: "run_started",
      payload: {
        runId: run.id,
        agentId: intent.targetAgentId,
        issueId: intent.issueId,
        intentId: intent.id,
        leaseId: lease.id,
        envelopeId: envelope.id,
      },
    });

    // Intent remains 'admitted' after run creation.
    // Consumption happens later when the run starts executing.

    logger.info(
      {
        intentId: intent.id,
        runId: run.id,
        leaseId: lease.id,
        envelopeId: envelope.id,
        agentId: intent.targetAgentId,
        issueId: intent.issueId,
      },
      "Scheduler admitted intent and created run",
    );

    return {
      admitted: true,
      runId: run.id,
      leaseId: lease.id,
      envelopeId: envelope.id,
    };
  }

  /**
   * Batch process all queued intents for a company.
   * Intents are processed in order: priority desc, then createdAt asc.
   * Returns counts of admitted, rejected, deferred, and skipped intents.
   */
  async function processQueuedIntents(companyId: string, now = new Date()) {
    const queued = await intentQueue.findQueuedIntents({ companyId });
    let admitted = 0;
    let rejected = 0;
    let deferred = 0;
    let skipped = 0;

    for (const intent of queued) {
      // Skip intents whose notBefore hasn't arrived yet
      if (intent.notBefore && intent.notBefore.getTime() > now.getTime()) {
        skipped += 1;
        continue;
      }

      const result = await processIntent(intent.id, now);
      if (result.admitted) {
        admitted += 1;
      } else if (result.reason === "agent at max concurrent runs") {
        deferred += 1;
      } else {
        rejected += 1;
      }
    }

    return { admitted, rejected, deferred, skipped, total: queued.length };
  }

  return {
    checkAdmission,
    processIntent,
    processQueuedIntents,
  };
}
