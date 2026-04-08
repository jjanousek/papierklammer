import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  agentWakeupRequests,
  agents,
  companies,
  createDb,
  executionLeases,
  heartbeatRuns,
  issues,
} from "@papierklammer/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { heartbeatService } from "../services/heartbeat.js";
import { eq, sql } from "drizzle-orm";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeDB = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping heartbeat company admission tests: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeDB("heartbeat company lifecycle admission gate", () => {
  let db!: ReturnType<typeof createDb>;
  let heartbeat!: ReturnType<typeof heartbeatService>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("heartbeat-company-admission-");
    db = createDb(tempDb.connectionString);
    heartbeat = heartbeatService(db);
  }, 30_000);

  afterEach(async () => {
    await db.execute(sql`TRUNCATE TABLE execution_leases, heartbeat_runs, agent_wakeup_requests, issues, agents, companies CASCADE`);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seedAgent(companyStatus: "paused" | "archived") {
    const companyId = randomUUID();
    const agentId = randomUUID();

    await db.insert(companies).values({
      id: companyId,
      name: "Lifecycle Co",
      status: companyStatus,
      pausedAt: companyStatus === "paused" ? new Date() : null,
      issuePrefix: "LIF",
      requireBoardApprovalForNewAgents: false,
    });

    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "Runner",
      role: "engineer",
      status: "active",
      adapterType: "process",
      adapterConfig: {
        command: process.execPath,
        args: ["-e", "setTimeout(() => process.exit(0), 10)"],
      },
      runtimeConfig: {},
      permissions: {},
    });

    return { companyId, agentId };
  }

  async function seedIssueExecution() {
    const companyId = randomUUID();
    const agentId = randomUUID();
    const issueId = randomUUID();
    const runId = randomUUID();
    const leaseId = randomUUID();
    const commentId = randomUUID();
    const now = new Date();

    await db.insert(companies).values({
      id: companyId,
      name: "Lifecycle Co",
      status: "active",
      pausedAt: null,
      issuePrefix: "LIF",
      requireBoardApprovalForNewAgents: false,
    });

    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "Runner",
      role: "engineer",
      status: "active",
      adapterType: "process",
      adapterConfig: {
        command: process.execPath,
        args: ["-e", "setInterval(() => {}, 1000)"],
      },
      runtimeConfig: {},
      permissions: {},
    });

    await db.insert(heartbeatRuns).values({
      id: runId,
      companyId,
      agentId,
      invocationSource: "assignment",
      triggerDetail: "system",
      status: "running",
      startedAt: now,
      contextSnapshot: { issueId, source: "issue.update" },
    });

    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Deferred wakeup issue",
      status: "todo",
      priority: "medium",
      assigneeAgentId: agentId,
    });

    await db.insert(executionLeases).values({
      id: leaseId,
      companyId,
      issueId,
      agentId,
      runId,
      leaseType: "issue_execution",
      state: "granted",
      ttlSeconds: 300,
      grantedAt: now,
      expiresAt: new Date(now.getTime() + 300_000),
    });

    await db
      .update(issues)
      .set({
        executionRunId: runId,
        executionLeaseId: leaseId,
        executionAgentNameKey: "runner",
        executionLockedAt: now,
      })
      .where(eq(issues.id, issueId));

    await db.insert(agentWakeupRequests).values({
      companyId,
      agentId,
      source: "automation",
      triggerDetail: "system",
      reason: "issue_execution_deferred",
      status: "deferred_issue_execution",
      payload: {
        issueId,
        commentId,
        _paperclipWakeContext: {
          issueId,
          taskId: issueId,
          commentId,
          wakeCommentId: commentId,
          wakeReason: "issue_commented",
          source: "issue.comment",
        },
      },
    });

    return { companyId, issueId, runId };
  }

  it.each([
    ["paused", "company.paused"],
    ["archived", "company.archived"],
  ] as const)("rejects wakeup for %s companies without creating a run", async (companyStatus, skipReason) => {
    const { agentId } = await seedAgent(companyStatus);

    await expect(
      heartbeat.wakeup(agentId, {
        source: "on_demand",
        triggerDetail: "manual",
        requestedByActorType: "user",
        requestedByActorId: "board",
      }),
    ).rejects.toThrow("cannot start new work");

    const runs = await db.select().from(heartbeatRuns);
    expect(runs).toHaveLength(0);

    const wakeups = await db.select().from(agentWakeupRequests);
    expect(wakeups).toHaveLength(1);
    expect(wakeups[0]?.status).toBe("skipped");
    expect(wakeups[0]?.reason).toBe(skipReason);
  });

  it.each([
    ["paused", "company.paused"],
    ["archived", "company.archived"],
  ] as const)("rejects invoke for %s companies without creating a run", async (companyStatus, skipReason) => {
    const { agentId } = await seedAgent(companyStatus);

    await expect(
      heartbeat.invoke(
        agentId,
        "on_demand",
        { source: "manual-test" },
        "manual",
        { actorType: "user", actorId: "board" },
      ),
    ).rejects.toThrow("cannot start new work");

    const runs = await db.select().from(heartbeatRuns);
    expect(runs).toHaveLength(0);

    const wakeups = await db
      .select()
      .from(agentWakeupRequests)
      .where(eq(agentWakeupRequests.agentId, agentId));
    expect(wakeups).toHaveLength(1);
    expect(wakeups[0]?.status).toBe("skipped");
    expect(wakeups[0]?.reason).toBe(skipReason);
  });

  it.each([
    ["paused", "company.paused"],
    ["archived", "company.archived"],
  ] as const)(
    "does not promote deferred issue execution wakeups for %s companies",
    async (companyStatus, skipReason) => {
      const { companyId, issueId, runId } = await seedIssueExecution();
      const deferredRequest = await db
        .select()
        .from(agentWakeupRequests)
        .where(eq(agentWakeupRequests.status, "deferred_issue_execution"))
        .then((rows) => rows[0] ?? null);
      expect(deferredRequest).not.toBeNull();

      await db
        .update(companies)
        .set({
          status: companyStatus,
          pausedAt: companyStatus === "paused" ? new Date() : null,
        })
        .where(eq(companies.id, companyId));

      await heartbeat.cancelRun(runId);

      const runs = await db
        .select({
          id: heartbeatRuns.id,
          status: heartbeatRuns.status,
        })
        .from(heartbeatRuns)
        .orderBy(heartbeatRuns.createdAt);
      expect(runs).toHaveLength(1);
      expect(runs[0]?.id).toBe(runId);
      expect(runs[0]?.status).toBe("cancelled");

      const updatedDeferredRequest = await db
        .select()
        .from(agentWakeupRequests)
        .where(eq(agentWakeupRequests.id, deferredRequest!.id))
        .then((rows) => rows[0] ?? null);
      expect(updatedDeferredRequest?.status).toBe("skipped");
      expect(updatedDeferredRequest?.reason).toBe(skipReason);

      const issue = await db
        .select({
          executionRunId: issues.executionRunId,
          executionLeaseId: issues.executionLeaseId,
        })
        .from(issues)
        .where(eq(issues.id, issueId))
        .then((rows) => rows[0] ?? null);
      expect(issue).toEqual({
        executionRunId: null,
        executionLeaseId: null,
      });
    },
  );
});
