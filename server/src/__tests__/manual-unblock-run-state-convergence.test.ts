import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
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
import { eq, inArray, sql } from "drizzle-orm";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { errorHandler } from "../middleware/index.js";
import { agentRoutes } from "../routes/agents.js";
import { issueRoutes } from "../routes/issues.js";
import { orchestratorRoutes } from "../routes/orchestrator.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeDB = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping manual unblock convergence tests: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

const storageStub = {
  provider: "local_disk",
  putFile: async () => {
    throw new Error("storage not used in this test");
  },
  getObject: async () => {
    throw new Error("storage not used in this test");
  },
  headObject: async () => ({ exists: false }),
  deleteObject: async () => undefined,
} as any;

describeDB("manual unblock run-state convergence", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("manual-unblock-run-state-");
    db = createDb(tempDb.connectionString);
  }, 30_000);

  afterEach(async () => {
    await db.execute(
      sql`TRUNCATE TABLE dispatch_intents, execution_leases, heartbeat_runs, issues, projects, agents, companies CASCADE`,
    );
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  function createApp(companyId: string) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as any).actor = {
        type: "board",
        userId: "local-board",
        source: "local_implicit",
        companyIds: [companyId],
        isInstanceAdmin: false,
      };
      next();
    });
    app.use("/api", orchestratorRoutes(db));
    app.use("/api", agentRoutes(db));
    app.use("/api", issueRoutes(db, storageStub));
    app.use(errorHandler);
    return app;
  }

  function readJsonBody<T>(response: { text?: string; body: T }): T {
    if (typeof response.text === "string" && response.text.length > 0) {
      return JSON.parse(response.text) as T;
    }
    return response.body;
  }

  async function seedFixture() {
    const companyId = randomUUID();
    const agentId = randomUUID();
    const projectId = randomUUID();
    const issueId = randomUUID();
    const leasedRunId = randomUUID();
    const orphanedRunId = randomUUID();
    const queuedRunId = randomUUID();
    const intentId = randomUUID();
    const leaseId = randomUUID();
    const now = new Date("2026-04-06T10:00:00.000Z");

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
      name: "Recovery Project",
      status: "planned",
    });

    await db.insert(heartbeatRuns).values([
      {
        id: leasedRunId,
        companyId,
        agentId,
        invocationSource: "manual",
        status: "running",
        createdAt: new Date("2026-04-06T09:55:00.000Z"),
        startedAt: new Date("2026-04-06T09:56:00.000Z"),
        contextSnapshot: { issueId },
      },
      {
        id: orphanedRunId,
        companyId,
        agentId,
        invocationSource: "manual",
        status: "running",
        createdAt: new Date("2026-04-06T09:57:00.000Z"),
        startedAt: new Date("2026-04-06T09:58:00.000Z"),
        contextSnapshot: { issueId },
      },
      {
        id: queuedRunId,
        companyId,
        agentId,
        invocationSource: "manual",
        status: "queued",
        createdAt: new Date("2026-04-06T09:59:00.000Z"),
        contextSnapshot: { issueId },
      },
    ]);

    await db.insert(issues).values({
      id: issueId,
      companyId,
      projectId,
      title: "Recover stale work",
      status: "blocked",
      priority: "medium",
      assigneeAgentId: agentId,
      executionRunId: leasedRunId,
      checkoutRunId: leasedRunId,
      executionAgentNameKey: "agent alpha",
      executionLockedAt: now,
      pickupFailCount: 4,
      lastPickupFailureAt: now,
    });

    await db.insert(executionLeases).values({
      id: leaseId,
      leaseType: "issue_execution_lease",
      issueId,
      agentId,
      runId: leasedRunId,
      state: "granted",
      companyId,
      grantedAt: new Date("2026-04-06T09:56:00.000Z"),
      renewedAt: new Date("2026-04-06T09:59:30.000Z"),
      expiresAt: new Date("2026-04-06T10:05:00.000Z"),
    });

    await db.insert(dispatchIntents).values({
      id: intentId,
      companyId,
      issueId,
      projectId,
      targetAgentId: agentId,
      intentType: "issue_assigned",
      priority: 10,
      status: "queued",
      createdAt: new Date("2026-04-06T09:54:00.000Z"),
      updatedAt: new Date("2026-04-06T09:54:00.000Z"),
    });

    return { companyId, agentId, issueId, leasedRunId, orphanedRunId, queuedRunId, leaseId };
  }

  it("unblock cancels linked active work and keeps API status surfaces converged", async () => {
    const { companyId, agentId, issueId, leasedRunId, orphanedRunId, queuedRunId, leaseId } =
      await seedFixture();
    const app = createApp(companyId);

    const liveBefore = await request(app).get(`/api/companies/${companyId}/live-runs`);
    const liveBeforeBody = readJsonBody<Array<{ id: string }>>(liveBefore);
    expect(liveBefore.status).toBe(200);
    expect(liveBeforeBody.map((run) => run.id).sort()).toEqual(
      [leasedRunId, orphanedRunId, queuedRunId].sort(),
    );

    const unblockRes = await request(app)
      .post(`/api/orchestrator/issues/${issueId}/unblock`)
      .send({});
    const unblockBody = readJsonBody<{
      issue: { executionRunId: string | null; checkoutRunId: string | null; status: string };
      leaseReleased: boolean;
      rejectedIntents: number;
      recovery: {
        issueId: string;
        companyId: string;
        releasedLeaseId: string | null;
        clearedExecutionRunId: string | null;
        clearedCheckoutRunId: string | null;
        rejectedIntentCount: number;
      };
    }>(unblockRes);

    expect(unblockRes.status).toBe(200);
    expect(unblockBody.issue.executionRunId).toBeNull();
    expect(unblockBody.issue.checkoutRunId).toBeNull();
    expect(unblockBody.issue.status).toBe("todo");
    expect(unblockBody.leaseReleased).toBe(true);
    expect(unblockBody.rejectedIntents).toBe(1);
    expect(unblockBody.recovery).toEqual({
      issueId,
      companyId,
      releasedLeaseId: leaseId,
      clearedExecutionRunId: leasedRunId,
      clearedCheckoutRunId: leasedRunId,
      rejectedIntentCount: 1,
    });

    const issueRes = await request(app).get(`/api/issues/${issueId}`);
    const issueBody = readJsonBody<{
      executionRunId: string | null;
      checkoutRunId: string | null;
      executionAgentNameKey: string | null;
      executionLockedAt: string | null;
      status: string;
      projectedStatus: string;
      activeRunId: string | null;
      pickupFailCount: number;
      lastPickupFailureAt: string | null;
    }>(issueRes);
    expect(issueRes.status).toBe(200);
    expect({
      executionRunId: issueBody.executionRunId,
      checkoutRunId: issueBody.checkoutRunId,
      executionAgentNameKey: issueBody.executionAgentNameKey,
      executionLockedAt: issueBody.executionLockedAt,
    }).toEqual({
      executionRunId: null,
      checkoutRunId: null,
      executionAgentNameKey: null,
      executionLockedAt: null,
    });
    expect(issueBody.status).toBe("todo");
    expect(issueBody.projectedStatus).toBe("todo");
    expect(issueBody.activeRunId).toBeNull();
    expect(issueBody.pickupFailCount).toBe(0);
    expect(issueBody.lastPickupFailureAt).toBeNull();

    const activeRunRes = await request(app).get(`/api/issues/${issueId}/active-run`);
    expect(activeRunRes.status).toBe(200);
    expect(activeRunRes.body).toBeNull();

    const liveAfter = await request(app).get(`/api/companies/${companyId}/live-runs`);
    const liveAfterBody = readJsonBody<Array<{ id: string }>>(liveAfter);
    expect(liveAfter.status).toBe(200);
    expect(liveAfterBody).toEqual([]);

    const statusAfter = await request(app).get("/api/orchestrator/status").query({ companyId });
    const statusBody = readJsonBody<{
      totalActiveRuns: number;
      activeRuns: Array<unknown>;
      agents: Array<{ agentId: string; activeRunCount: number }>;
    }>(statusAfter);
    expect(statusAfter.status).toBe(200);
    expect(statusBody.totalActiveRuns).toBe(0);
    expect(statusBody.activeRuns).toEqual([]);
    expect(statusBody.agents).toEqual([
      expect.objectContaining({
        agentId,
        activeRunCount: 0,
      }),
    ]);

    const staleAfter = await request(app).get("/api/orchestrator/stale").query({ companyId });
    expect(staleAfter.status).toBe(200);
    expect(staleAfter.body.staleRuns).toEqual([]);
    expect(staleAfter.body.orphanedLeases).toEqual([]);

    const storedRuns = await db
      .select({
        id: heartbeatRuns.id,
        status: heartbeatRuns.status,
        finishedAt: heartbeatRuns.finishedAt,
      })
      .from(heartbeatRuns)
      .where(inArray(heartbeatRuns.id, [leasedRunId, orphanedRunId, queuedRunId]));

    expect(storedRuns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: leasedRunId, status: "cancelled", finishedAt: expect.any(Date) }),
        expect.objectContaining({ id: orphanedRunId, status: "cancelled", finishedAt: expect.any(Date) }),
        expect.objectContaining({ id: queuedRunId, status: "cancelled", finishedAt: expect.any(Date) }),
      ]),
    );

    const queuedIntents = await db
      .select({ status: dispatchIntents.status })
      .from(dispatchIntents)
      .where(eq(dispatchIntents.issueId, issueId));

    expect(queuedIntents).toEqual([expect.objectContaining({ status: "rejected" })]);
  });
});
