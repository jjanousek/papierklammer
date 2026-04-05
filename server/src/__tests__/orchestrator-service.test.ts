import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  agents,
  companies,
  createDb,
  dispatchIntents,
  executionLeases,
  heartbeatRuns,
  issues,
  projects,
} from "@papierklammer/db";
import { eq, sql } from "drizzle-orm";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { orchestratorService } from "../services/orchestrator.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeDB = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping orchestrator service tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeDB("orchestratorService", () => {
  let db!: ReturnType<typeof createDb>;
  let svc!: ReturnType<typeof orchestratorService>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-orchestrator-service-");
    db = createDb(tempDb.connectionString);
    svc = orchestratorService(db);
  }, 20_000);

  afterEach(async () => {
    await db.execute(
      sql`TRUNCATE TABLE dispatch_intents, execution_leases, heartbeat_runs, issues, projects, agents, companies CASCADE`,
    );
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seedAgentContext() {
    const companyId = randomUUID();
    const agentId = randomUUID();
    const projectId = randomUUID();

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });

    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "Agent Alpha",
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
      name: "Project Alpha",
      status: "planned",
    });

    return { companyId, agentId, projectId };
  }

  it("prefers in-progress work over blocked, todo, and backlog assignments", async () => {
    const { companyId, agentId, projectId } = await seedAgentContext();
    const backlogIssueId = randomUUID();
    const todoIssueId = randomUUID();
    const blockedIssueId = randomUUID();
    const activeIssueId = randomUUID();

    await db.insert(issues).values([
      {
        id: backlogIssueId,
        companyId,
        projectId,
        title: "Backlog issue",
        status: "backlog",
        priority: "medium",
        assigneeAgentId: agentId,
        updatedAt: new Date("2026-04-05T09:00:00.000Z"),
      },
      {
        id: todoIssueId,
        companyId,
        projectId,
        title: "Todo issue",
        status: "todo",
        priority: "medium",
        assigneeAgentId: agentId,
        updatedAt: new Date("2026-04-05T10:00:00.000Z"),
      },
      {
        id: blockedIssueId,
        companyId,
        projectId,
        title: "Blocked issue",
        status: "blocked",
        priority: "medium",
        assigneeAgentId: agentId,
        updatedAt: new Date("2026-04-05T11:00:00.000Z"),
      },
      {
        id: activeIssueId,
        companyId,
        projectId,
        title: "Active issue",
        status: "in_progress",
        priority: "medium",
        assigneeAgentId: agentId,
        startedAt: new Date("2026-04-05T12:00:00.000Z"),
        updatedAt: new Date("2026-04-05T12:00:00.000Z"),
      },
    ]);

    const issue = await svc.findAgentAssignedIssue(companyId, agentId);

    expect(issue).toEqual({
      id: activeIssueId,
      projectId,
    });
  });

  it("uses a deterministic recency tie-breaker within the same active status bucket", async () => {
    const { companyId, agentId, projectId } = await seedAgentContext();
    const olderTodoIssueId = randomUUID();
    const newerTodoIssueId = randomUUID();

    await db.insert(issues).values([
      {
        id: olderTodoIssueId,
        companyId,
        projectId,
        title: "Older todo",
        status: "todo",
        priority: "medium",
        assigneeAgentId: agentId,
        updatedAt: new Date("2026-04-05T08:00:00.000Z"),
      },
      {
        id: newerTodoIssueId,
        companyId,
        projectId,
        title: "Newer todo",
        status: "todo",
        priority: "medium",
        assigneeAgentId: agentId,
        updatedAt: new Date("2026-04-05T13:00:00.000Z"),
      },
    ]);

    const issue = await svc.findAgentAssignedIssue(companyId, agentId);

    expect(issue).toEqual({
      id: newerTodoIssueId,
      projectId,
    });
  });

  it("returns null when the agent only has backlog assignments", async () => {
    const { companyId, agentId, projectId } = await seedAgentContext();

    await db.insert(issues).values({
      id: randomUUID(),
      companyId,
      projectId,
      title: "Backlog only",
      status: "backlog",
      priority: "medium",
      assigneeAgentId: agentId,
    });

    await expect(svc.findAgentAssignedIssue(companyId, agentId)).resolves.toBeNull();
  });

  it("returns null when active assigned issues do not belong to a project", async () => {
    const { companyId, agentId } = await seedAgentContext();

    await db.insert(issues).values({
      id: randomUUID(),
      companyId,
      title: "Projectless todo",
      status: "todo",
      priority: "medium",
      assigneeAgentId: agentId,
    });

    await expect(svc.findAgentAssignedIssue(companyId, agentId)).resolves.toBeNull();
  });

  it("returns company-scoped active and recent run review entries with stable identity fields", async () => {
    const { companyId, agentId, projectId } = await seedAgentContext();
    const issueId = randomUUID();
    const otherCompanyId = randomUUID();
    const otherAgentId = randomUUID();

    await db.insert(issues).values({
      id: issueId,
      companyId,
      projectId,
      identifier: "TDEMO-1",
      title: "Demo repo review",
      status: "in_progress",
      priority: "medium",
      assigneeAgentId: agentId,
    });

    await db.insert(companies).values({
      id: otherCompanyId,
      name: "Other Company",
      issuePrefix: "OTHR",
      requireBoardApprovalForNewAgents: false,
    });

    await db.insert(agents).values({
      id: otherAgentId,
      companyId: otherCompanyId,
      name: "Other Agent",
      role: "engineer",
      status: "active",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });

    await db.insert(heartbeatRuns).values([
      {
        id: randomUUID(),
        companyId,
        agentId,
        invocationSource: "manual",
        status: "running",
        startedAt: new Date("2026-04-05T10:00:00.000Z"),
        contextSnapshot: { issueId },
        stdoutExcerpt: "Live output from the target run",
      },
      {
        id: randomUUID(),
        companyId,
        agentId,
        invocationSource: "manual",
        status: "succeeded",
        startedAt: new Date("2026-04-05T09:30:00.000Z"),
        finishedAt: new Date("2026-04-05T09:45:00.000Z"),
        contextSnapshot: { issueId },
        resultJson: {
          summary: "Created a concise operator-facing result summary.",
          stdout: "verbose raw stdout that should not win over the summary",
        },
      },
      {
        id: randomUUID(),
        companyId: otherCompanyId,
        agentId: otherAgentId,
        invocationSource: "manual",
        status: "running",
        startedAt: new Date("2026-04-05T11:00:00.000Z"),
        stdoutExcerpt: "should not leak",
      },
    ]);

    const status = await svc.getAgentOverviews(companyId);

    expect(status.agents).toContainEqual({
      agentId,
      name: "Agent Alpha",
      status: "active",
      activeRunCount: 1,
      queuedIntentCount: 0,
    });
    expect(status.activeRuns).toHaveLength(1);
    expect(status.activeRuns[0]).toMatchObject({
      agentId,
      agentName: "Agent Alpha",
      issueId,
      issueIdentifier: "TDEMO-1",
      status: "running",
      resultSummaryText: "Live output from the target run",
    });
    expect(status.recentRuns).toHaveLength(1);
    expect(status.recentRuns[0]).toMatchObject({
      agentId,
      issueId,
      issueIdentifier: "TDEMO-1",
      status: "succeeded",
      resultSummaryText: "Created a concise operator-facing result summary.",
    });
  });

  it("returns company-scoped stale inventory with orphaned active runs and excludes completed runs", async () => {
    const primary = await seedAgentContext();
    const secondary = await seedAgentContext();
    const staleIssueId = randomUUID();
    const orphanIssueId = randomUUID();
    const completedIssueId = randomUUID();
    const otherIssueId = randomUUID();
    const leaseExpiredRunId = randomUUID();
    const orphanRunId = randomUUID();
    const completedRunId = randomUUID();
    const otherRunId = randomUUID();
    const staleLeaseId = randomUUID();
    const orphanedLeaseId = randomUUID();
    const otherLeaseId = randomUUID();
    const staleIntentId = randomUUID();
    const otherIntentId = randomUUID();
    const staleCreatedAt = new Date(Date.now() - (2 * 60 * 60 * 1000));
    const expiredAt = new Date(Date.now() - 60_000);

    await db.insert(issues).values([
      {
        id: staleIssueId,
        companyId: primary.companyId,
        projectId: primary.projectId,
        title: "Expired lease issue",
        status: "in_progress",
        priority: "medium",
        assigneeAgentId: primary.agentId,
      },
      {
        id: orphanIssueId,
        companyId: primary.companyId,
        projectId: primary.projectId,
        title: "Orphaned run issue",
        status: "in_progress",
        priority: "medium",
        assigneeAgentId: primary.agentId,
      },
      {
        id: completedIssueId,
        companyId: primary.companyId,
        projectId: primary.projectId,
        title: "Completed issue",
        status: "done",
        priority: "medium",
        assigneeAgentId: primary.agentId,
      },
      {
        id: otherIssueId,
        companyId: secondary.companyId,
        projectId: secondary.projectId,
        title: "Other company stale issue",
        status: "in_progress",
        priority: "medium",
        assigneeAgentId: secondary.agentId,
      },
    ]);

    await db.insert(heartbeatRuns).values([
      {
        id: leaseExpiredRunId,
        companyId: primary.companyId,
        agentId: primary.agentId,
        invocationSource: "manual",
        status: "running",
      },
      {
        id: orphanRunId,
        companyId: primary.companyId,
        agentId: primary.agentId,
        invocationSource: "manual",
        status: "running",
      },
      {
        id: completedRunId,
        companyId: primary.companyId,
        agentId: primary.agentId,
        invocationSource: "manual",
        status: "succeeded",
        finishedAt: new Date(),
        contextSnapshot: { issueId: completedIssueId },
      },
      {
        id: otherRunId,
        companyId: secondary.companyId,
        agentId: secondary.agentId,
        invocationSource: "manual",
        status: "running",
      },
    ]);

    await db
      .update(issues)
      .set({ executionRunId: leaseExpiredRunId, updatedAt: new Date() })
      .where(eq(issues.id, staleIssueId));
    await db
      .update(issues)
      .set({
        executionRunId: orphanRunId,
        checkoutRunId: orphanRunId,
        updatedAt: new Date(),
      })
      .where(eq(issues.id, orphanIssueId));
    await db
      .update(issues)
      .set({ executionRunId: otherRunId, updatedAt: new Date() })
      .where(eq(issues.id, otherIssueId));

    await db.insert(executionLeases).values([
      {
        id: staleLeaseId,
        leaseType: "issue_execution_lease",
        issueId: staleIssueId,
        agentId: primary.agentId,
        runId: leaseExpiredRunId,
        state: "expired",
        companyId: primary.companyId,
        grantedAt: new Date(Date.now() - 600_000),
        expiresAt: expiredAt,
      },
      {
        id: orphanedLeaseId,
        leaseType: "issue_execution_lease",
        issueId: staleIssueId,
        agentId: primary.agentId,
        runId: leaseExpiredRunId,
        state: "granted",
        companyId: primary.companyId,
        grantedAt: new Date(Date.now() - 600_000),
        expiresAt: expiredAt,
      },
      {
        id: randomUUID(),
        leaseType: "issue_execution_lease",
        issueId: completedIssueId,
        agentId: primary.agentId,
        runId: completedRunId,
        state: "expired",
        companyId: primary.companyId,
        grantedAt: new Date(Date.now() - 600_000),
        expiresAt: expiredAt,
      },
      {
        id: otherLeaseId,
        leaseType: "issue_execution_lease",
        issueId: otherIssueId,
        agentId: secondary.agentId,
        runId: otherRunId,
        state: "granted",
        companyId: secondary.companyId,
        grantedAt: new Date(Date.now() - 600_000),
        expiresAt: expiredAt,
      },
    ]);

    await db.insert(dispatchIntents).values([
      {
        id: staleIntentId,
        companyId: primary.companyId,
        issueId: staleIssueId,
        projectId: primary.projectId,
        targetAgentId: primary.agentId,
        intentType: "issue_assigned",
        priority: 10,
        status: "queued",
        createdAt: staleCreatedAt,
        updatedAt: staleCreatedAt,
      },
      {
        id: otherIntentId,
        companyId: secondary.companyId,
        issueId: otherIssueId,
        projectId: secondary.projectId,
        targetAgentId: secondary.agentId,
        intentType: "issue_assigned",
        priority: 10,
        status: "queued",
        createdAt: staleCreatedAt,
        updatedAt: staleCreatedAt,
      },
    ]);

    const staleItems = await svc.getStaleItems(primary.companyId);
    const staleRunsById = new Map(
      staleItems.staleRuns.map((row) => [row.runId, row.reason]),
    );

    expect(staleItems.staleRuns).toHaveLength(2);
    expect(staleRunsById.get(leaseExpiredRunId)).toBe("lease_expired");
    expect(staleRunsById.get(orphanRunId)).toBe("orphaned_active_run");
    expect(staleRunsById.has(completedRunId)).toBe(false);
    expect(staleRunsById.has(otherRunId)).toBe(false);
    expect(staleItems.staleIntents).toEqual([
      expect.objectContaining({ intentId: staleIntentId, reason: "queued_too_long" }),
    ]);
    expect(staleItems.orphanedLeases).toEqual([
      expect.objectContaining({ leaseId: orphanedLeaseId, issueId: staleIssueId }),
    ]);
  });

  it("dedupes stale cleanup targets and ignores cross-company lease rows for the same run", async () => {
    const primary = await seedAgentContext();
    const secondary = await seedAgentContext();
    const issueId = randomUUID();
    const runId = randomUUID();
    const primaryExpiredLeaseId = randomUUID();
    const primaryActiveLeaseId = randomUUID();
    const foreignLeaseId = randomUUID();

    await db.insert(issues).values({
      id: issueId,
      companyId: primary.companyId,
      projectId: primary.projectId,
      title: "Cleanup target",
      status: "in_progress",
      priority: "medium",
      assigneeAgentId: primary.agentId,
    });

    await db.insert(heartbeatRuns).values({
      id: runId,
      companyId: primary.companyId,
      agentId: primary.agentId,
      invocationSource: "manual",
      status: "running",
    });

    await db
      .update(issues)
      .set({ executionRunId: runId, updatedAt: new Date() })
      .where(eq(issues.id, issueId));

    await db.insert(executionLeases).values([
      {
        id: primaryExpiredLeaseId,
        leaseType: "issue_execution_lease",
        issueId,
        agentId: primary.agentId,
        runId,
        state: "expired",
        companyId: primary.companyId,
        grantedAt: new Date(Date.now() - 600_000),
        expiresAt: new Date(Date.now() - 60_000),
      },
      {
        id: primaryActiveLeaseId,
        leaseType: "issue_execution_lease",
        issueId,
        agentId: primary.agentId,
        runId,
        state: "granted",
        companyId: primary.companyId,
        grantedAt: new Date(Date.now() - 600_000),
        expiresAt: new Date(Date.now() - 30_000),
      },
      {
        id: foreignLeaseId,
        leaseType: "issue_execution_lease",
        issueId,
        agentId: secondary.agentId,
        runId,
        state: "granted",
        companyId: secondary.companyId,
        grantedAt: new Date(Date.now() - 600_000),
        expiresAt: new Date(Date.now() - 30_000),
      },
    ]);

    const staleRuns = await svc.findStaleRunsForCleanup(primary.companyId);

    expect(staleRuns).toEqual([
      {
        runId,
        leaseId: primaryActiveLeaseId,
        leaseState: "granted",
      },
    ]);
  });

  it("recovers a stale issue for the target run without mutating another company", async () => {
    const primary = await seedAgentContext();
    const secondary = await seedAgentContext();
    const primaryIssueId = randomUUID();
    const secondaryIssueId = randomUUID();
    const primaryRunId = randomUUID();
    const secondaryRunId = randomUUID();
    const failureAt = new Date(Date.now() - 60_000);

    await db.insert(heartbeatRuns).values([
      {
        id: primaryRunId,
        companyId: primary.companyId,
        agentId: primary.agentId,
        invocationSource: "manual",
        status: "failed",
      },
      {
        id: secondaryRunId,
        companyId: secondary.companyId,
        agentId: secondary.agentId,
        invocationSource: "manual",
        status: "running",
      },
    ]);

    await db.insert(issues).values([
      {
        id: primaryIssueId,
        companyId: primary.companyId,
        projectId: primary.projectId,
        title: "Recover me",
        status: "blocked",
        priority: "medium",
        assigneeAgentId: primary.agentId,
        executionRunId: primaryRunId,
        checkoutRunId: primaryRunId,
        pickupFailCount: 6,
        lastPickupFailureAt: failureAt,
      },
      {
        id: secondaryIssueId,
        companyId: secondary.companyId,
        projectId: secondary.projectId,
        title: "Leave me alone",
        status: "in_progress",
        priority: "medium",
        assigneeAgentId: secondary.agentId,
        executionRunId: secondaryRunId,
        checkoutRunId: secondaryRunId,
        pickupFailCount: 4,
        lastPickupFailureAt: failureAt,
      },
    ]);

    const recoveredIds = await svc.recoverIssueForRun(primary.companyId, primaryRunId);

    expect(recoveredIds).toEqual([primaryIssueId]);

    const [recoveredIssue] = await db
      .select()
      .from(issues)
      .where(eq(issues.id, primaryIssueId));
    expect(recoveredIssue.status).toBe("todo");
    expect(recoveredIssue.executionRunId).toBeNull();
    expect(recoveredIssue.checkoutRunId).toBeNull();
    expect(recoveredIssue.pickupFailCount).toBe(0);
    expect(recoveredIssue.lastPickupFailureAt).toBeNull();

    const [otherIssue] = await db
      .select()
      .from(issues)
      .where(eq(issues.id, secondaryIssueId));
    expect(otherIssue.status).toBe("in_progress");
    expect(otherIssue.executionRunId).toBe(secondaryRunId);
    expect(otherIssue.checkoutRunId).toBe(secondaryRunId);
    expect(otherIssue.pickupFailCount).toBe(4);
    expect(otherIssue.lastPickupFailureAt).toBeInstanceOf(Date);
  });

  it("clears issue stale ownership and restores schedulability for manual unblock", async () => {
    const { companyId, agentId, projectId } = await seedAgentContext();
    const issueId = randomUUID();
    const runId = randomUUID();

    await db.insert(heartbeatRuns).values({
      id: runId,
      companyId,
      agentId,
      invocationSource: "manual",
      status: "failed",
    });

    await db.insert(issues).values({
      id: issueId,
      companyId,
      projectId,
      title: "Manually unblock me",
      status: "blocked",
      priority: "medium",
      assigneeAgentId: agentId,
      executionRunId: runId,
      checkoutRunId: runId,
      pickupFailCount: 5,
      lastPickupFailureAt: new Date(Date.now() - 30_000),
    });

    await svc.clearIssueLock(issueId, companyId);

    const [issue] = await db
      .select()
      .from(issues)
      .where(eq(issues.id, issueId));
    expect(issue.status).toBe("todo");
    expect(issue.executionRunId).toBeNull();
    expect(issue.checkoutRunId).toBeNull();
    expect(issue.executionLockedAt).toBeNull();
    expect(issue.pickupFailCount).toBe(0);
    expect(issue.lastPickupFailureAt).toBeNull();
  });
});
