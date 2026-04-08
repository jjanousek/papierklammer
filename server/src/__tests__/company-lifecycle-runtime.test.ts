import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  agentWakeupRequests,
  agents,
  companies,
  createDb,
  dispatchIntents,
  executionLeases,
  heartbeatRuns,
  issues,
  projectWorkspaces,
  projects,
} from "@papierklammer/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { activityService } from "../services/activity.js";
import { companyLifecycleService } from "../services/company-lifecycle.js";
import { companyService } from "../services/companies.js";
import { heartbeatService } from "../services/heartbeat.js";
import { intentQueueService } from "../services/intent-queue.js";
import { schedulerService } from "../services/scheduler.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeDB = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping company lifecycle runtime tests: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeDB("company lifecycle runtime coordination", () => {
  let db!: ReturnType<typeof createDb>;
  let lifecycle!: ReturnType<typeof companyLifecycleService>;
  let activity!: ReturnType<typeof activityService>;
  let companiesSvc!: ReturnType<typeof companyService>;
  let heartbeat!: ReturnType<typeof heartbeatService>;
  let intentQueue!: ReturnType<typeof intentQueueService>;
  let scheduler!: ReturnType<typeof schedulerService>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  const actor = {
    actorType: "user" as const,
    actorId: "board-user",
    agentId: null,
    runId: null,
  };

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("company-lifecycle-runtime-");
    db = createDb(tempDb.connectionString);
    lifecycle = companyLifecycleService(db);
    activity = activityService(db);
    companiesSvc = companyService(db);
    heartbeat = heartbeatService(db);
    intentQueue = intentQueueService(db);
    scheduler = schedulerService(db);
  }, 30_000);

  afterEach(async () => {
    await db.execute(sql`TRUNCATE TABLE
      company_lifecycle_events,
      agent_wakeup_requests,
      execution_leases,
      heartbeat_runs,
      dispatch_intents,
      project_workspaces,
      issues,
      projects,
      agents,
      companies
      CASCADE`);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seedCompanyFixture(status: "active" | "paused" = "active") {
    const companyId = randomUUID();
    const agentId = randomUUID();
    const projectId = randomUUID();
    const workspaceId = randomUUID();

    await db.insert(companies).values({
      id: companyId,
      name: "Lifecycle Runtime Co",
      status,
      pauseReason: status === "paused" ? "manual" : null,
      pausedAt: status === "paused" ? new Date("2026-04-08T12:00:00.000Z") : null,
      issuePrefix: `L${companyId.replace(/-/g, "").slice(0, 5).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });

    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "Lifecycle Agent",
      role: "engineer",
      status: "active",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });

    await db.insert(projects).values({
      id: projectId,
      companyId,
      name: "Lifecycle Project",
      status: "active",
    });

    await db.insert(projectWorkspaces).values({
      id: workspaceId,
      companyId,
      projectId,
      name: "main",
      sourceType: "local_path",
      cwd: "/tmp/lifecycle-runtime-workspace",
      isPrimary: true,
    });

    return { companyId, agentId, projectId, workspaceId };
  }

  async function seedActiveWorkload(companyId: string, agentId: string, projectId: string) {
    const runningIssueId = randomUUID();
    const queuedIssueId = randomUUID();
    const deferredIssueId = randomUUID();
    const runningRunId = randomUUID();
    const queuedRunId = randomUUID();
    const runningLeaseId = randomUUID();
    const queuedLeaseId = randomUUID();
    const now = new Date("2026-04-08T12:05:00.000Z");

    await db.insert(heartbeatRuns).values([
      {
        id: runningRunId,
        companyId,
        agentId,
        invocationSource: "assignment",
        triggerDetail: "system",
        status: "running",
        startedAt: now,
        contextSnapshot: { issueId: runningIssueId, projectId },
      },
      {
        id: queuedRunId,
        companyId,
        agentId,
        invocationSource: "scheduler",
        triggerDetail: "issue_assigned",
        status: "queued",
        contextSnapshot: { issueId: queuedIssueId, projectId },
      },
    ]);

    await db.insert(issues).values([
      {
        id: runningIssueId,
        companyId,
        projectId,
        title: "Running issue",
        status: "in_progress",
        priority: "medium",
        assigneeAgentId: agentId,
        executionRunId: runningRunId,
        executionAgentNameKey: "lifecycle-agent",
        executionLockedAt: now,
      },
      {
        id: queuedIssueId,
        companyId,
        projectId,
        title: "Queued issue",
        status: "in_progress",
        priority: "medium",
        assigneeAgentId: agentId,
        executionRunId: queuedRunId,
        executionAgentNameKey: "lifecycle-agent",
        executionLockedAt: now,
      },
      {
        id: deferredIssueId,
        companyId,
        projectId,
        title: "Deferred issue",
        status: "todo",
        priority: "medium",
        assigneeAgentId: agentId,
        executionAgentNameKey: "stale-owner",
        executionLockedAt: now,
      },
    ]);

    await db.insert(executionLeases).values([
      {
        id: runningLeaseId,
        companyId,
        issueId: runningIssueId,
        agentId,
        runId: runningRunId,
        leaseType: "issue_execution",
        state: "granted",
        ttlSeconds: 300,
        grantedAt: now,
        expiresAt: new Date(now.getTime() + 300_000),
      },
      {
        id: queuedLeaseId,
        companyId,
        issueId: queuedIssueId,
        agentId,
        runId: queuedRunId,
        leaseType: "issue_execution",
        state: "renewed",
        ttlSeconds: 300,
        grantedAt: now,
        renewedAt: now,
        expiresAt: new Date(now.getTime() + 300_000),
      },
    ]);

    await db
      .update(issues)
      .set({
        executionLeaseId: runningLeaseId,
      })
      .where(eq(issues.id, runningIssueId));

    await db
      .update(issues)
      .set({
        executionLeaseId: queuedLeaseId,
      })
      .where(eq(issues.id, queuedIssueId));

    await db.insert(agentWakeupRequests).values([
      {
        companyId,
        agentId,
        source: "automation",
        triggerDetail: "system",
        reason: "queued_followup",
        payload: { issueId: queuedIssueId, projectId },
        status: "queued",
      },
      {
        companyId,
        agentId,
        source: "automation",
        triggerDetail: "system",
        reason: "issue_execution_deferred",
        payload: {
          issueId: deferredIssueId,
          projectId,
          _paperclipWakeContext: {
            issueId: deferredIssueId,
            projectId,
            wakeReason: "issue_comment_mentioned",
          },
        },
        status: "deferred_issue_execution",
      },
    ]);

    await db.insert(dispatchIntents).values([
      {
        companyId,
        issueId: queuedIssueId,
        projectId,
        targetAgentId: agentId,
        intentType: "issue_assigned",
        priority: 40,
        status: "queued",
      },
      {
        companyId,
        issueId: deferredIssueId,
        projectId,
        targetAgentId: agentId,
        intentType: "issue_comment_mentioned",
        priority: 30,
        status: "deferred",
        resolvedAt: now,
      },
    ]);

    return {
      runningIssueId,
      queuedIssueId,
      deferredIssueId,
      runningRunId,
      queuedRunId,
      runningLeaseId,
      queuedLeaseId,
    };
  }

  it.each([
    ["pause", "paused"],
    ["archive", "archived"],
  ] as const)(
    "%s sweeps live company work, clears ownership residue, and records lifecycle audit details",
    async (operation, nextStatus) => {
      const { companyId, agentId, projectId } = await seedCompanyFixture("active");
      await seedActiveWorkload(companyId, agentId, projectId);

      const result = operation === "pause"
        ? await lifecycle.pause(companyId, actor)
        : await lifecycle.archive(companyId, actor);

      expect(result.company.status).toBe(nextStatus);
      expect(result.quiesce.cancelledRuns).toBe(2);
      expect(result.quiesce.cancelledWakeups).toBe(2);
      expect(result.quiesce.rejectedIntents).toBe(2);
      expect(result.quiesce.releasedLeases).toBe(2);
      expect(result.audit.action).toBe(`company.${nextStatus === "paused" ? "paused" : "archived"}`);
      expect(result.audit.details).toMatchObject({
        previousStatus: "active",
        nextStatus,
        quiesce: {
          cancelledRuns: 2,
          cancelledWakeups: 2,
          rejectedIntents: 2,
          releasedLeases: 2,
        },
      });

      const liveRuns = await db
        .select({ status: heartbeatRuns.status })
        .from(heartbeatRuns)
        .where(
          and(
            eq(heartbeatRuns.companyId, companyId),
            inArray(heartbeatRuns.status, ["queued", "running"]),
          ),
        );
      expect(liveRuns).toEqual([]);

      const pendingWakeups = await db
        .select({ status: agentWakeupRequests.status })
        .from(agentWakeupRequests)
        .where(
          and(
            eq(agentWakeupRequests.companyId, companyId),
            inArray(agentWakeupRequests.status, ["queued", "deferred_issue_execution"]),
          ),
        );
      expect(pendingWakeups).toEqual([]);

      const unreconciledIntents = await db
        .select({ status: dispatchIntents.status })
        .from(dispatchIntents)
        .where(
          and(
            eq(dispatchIntents.companyId, companyId),
            inArray(dispatchIntents.status, ["queued", "admitted", "deferred"]),
          ),
        );
      expect(unreconciledIntents).toEqual([]);

      const activeLeases = await db
        .select({ state: executionLeases.state })
        .from(executionLeases)
        .where(
          and(
            eq(executionLeases.companyId, companyId),
            inArray(executionLeases.state, ["granted", "renewed"]),
          ),
        );
      expect(activeLeases).toEqual([]);

      const issueLocks = await db
        .select({
          executionRunId: issues.executionRunId,
          executionLeaseId: issues.executionLeaseId,
          executionAgentNameKey: issues.executionAgentNameKey,
          executionLockedAt: issues.executionLockedAt,
        })
        .from(issues)
        .where(eq(issues.companyId, companyId));
      for (const issue of issueLocks) {
        expect(issue.executionRunId).toBeNull();
        expect(issue.executionLeaseId).toBeNull();
        expect(issue.executionAgentNameKey).toBeNull();
        expect(issue.executionLockedAt).toBeNull();
      }

      const activityEntries = await activity.list({ companyId });
      expect(activityEntries[0]).toMatchObject({
        action: `company.${nextStatus === "paused" ? "paused" : "archived"}`,
        entityType: "company",
        entityId: companyId,
      });
      expect(activityEntries[0]?.details).toMatchObject({
        previousStatus: "active",
        nextStatus,
        quiesce: {
          cancelledRuns: 2,
          cancelledWakeups: 2,
          rejectedIntents: 2,
          releasedLeases: 2,
        },
      });
    },
    20_000,
  );

  it("resume re-allows only future work and does not replay cancelled work", async () => {
    const { companyId, agentId, projectId, workspaceId } = await seedCompanyFixture("active");
    const seeded = await seedActiveWorkload(companyId, agentId, projectId);

    await lifecycle.pause(companyId, actor);

    const beforeResumeRuns = await db
      .select({ id: heartbeatRuns.id, status: heartbeatRuns.status })
      .from(heartbeatRuns)
      .where(eq(heartbeatRuns.companyId, companyId))
      .orderBy(heartbeatRuns.createdAt);

    const resumed = await lifecycle.resume(companyId, actor);
    expect(resumed.company.status).toBe("active");
    expect(resumed.audit.details).toMatchObject({
      previousStatus: "paused",
      nextStatus: "active",
    });

    const afterResumeRuns = await db
      .select({ id: heartbeatRuns.id, status: heartbeatRuns.status })
      .from(heartbeatRuns)
      .where(eq(heartbeatRuns.companyId, companyId))
      .orderBy(heartbeatRuns.createdAt);
    expect(afterResumeRuns).toEqual(beforeResumeRuns);
    expect(afterResumeRuns.map((run) => run.id)).toEqual([
      seeded.runningRunId,
      seeded.queuedRunId,
    ]);

    const explicitIntent = await intentQueue.createIntent({
      companyId,
      issueId: seeded.queuedIssueId,
      projectId,
      workspaceId,
      targetAgentId: agentId,
      intentType: "issue_assigned",
      priority: 40,
    });

    const admission = await scheduler.processIntent(explicitIntent.id);
    expect(admission.admitted).toBe(true);

    const activeRuns = await db
      .select({ id: heartbeatRuns.id, status: heartbeatRuns.status })
      .from(heartbeatRuns)
      .where(
        and(
          eq(heartbeatRuns.companyId, companyId),
          inArray(heartbeatRuns.status, ["queued", "running"]),
        ),
      );
    expect(activeRuns).toHaveLength(1);
    expect(activeRuns[0]?.id).toBe(admission.runId);
  }, 20_000);

  it("keeps delete audit visible after the company row is removed", async () => {
    const { companyId } = await seedCompanyFixture("paused");

    const deleted = await lifecycle.deleteGuarded(companyId, "Lifecycle Runtime Co", actor);
    expect(deleted.deletedCompanyId).toBe(companyId);

    expect(await companiesSvc.getById(companyId)).toBeNull();

    const activityEntries = await activity.list({ companyId });
    expect(activityEntries).toHaveLength(1);
    expect(activityEntries[0]).toMatchObject({
      action: "company.deleted",
      entityType: "company",
      entityId: companyId,
      details: {
        previousStatus: "paused",
        nextStatus: "deleted",
      },
    });
  });
});
