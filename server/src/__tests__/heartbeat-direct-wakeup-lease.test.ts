import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  agents,
  companies,
  controlPlaneEvents,
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
import { projectionService } from "../services/projections.js";
import { reconcilerService } from "../services/reconciler.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeDB = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping direct wakeup lease tests: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeDB("heartbeat direct issue wakeups", () => {
  let db!: ReturnType<typeof createDb>;
  let heartbeat!: ReturnType<typeof heartbeatService>;
  let projections!: ReturnType<typeof projectionService>;
  let reconciler!: ReturnType<typeof reconcilerService>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("heartbeat-direct-wakeup-lease-");
    db = createDb(tempDb.connectionString);
    heartbeat = heartbeatService(db);
    projections = projectionService(db);
    reconciler = reconcilerService(db);
  }, 30_000);

  afterEach(async () => {
    await new Promise((resolve) => setTimeout(resolve, 100));
    await db.execute(sql`TRUNCATE TABLE execution_leases, heartbeat_runs, agent_wakeup_requests, issues, agents, companies CASCADE`);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function waitForRunStatus(
    runId: string,
    expectedStatus: "queued" | "running",
    timeoutMs = 1_500,
  ) {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const run = await db
        .select()
        .from(heartbeatRuns)
        .where(eq(heartbeatRuns.id, runId))
        .then((rows) => rows[0] ?? null);

      if (run?.status === expectedStatus) {
        return run;
      }

      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    return db
      .select()
      .from(heartbeatRuns)
      .where(eq(heartbeatRuns.id, runId))
      .then((rows) => rows[0] ?? null);
  }

  it("allocates an execution lease for direct assignment wakeups tied to an issue", async () => {
    const companyId = randomUUID();
    const agentId = randomUUID();
    const issueId = randomUUID();

    await db.insert(companies).values({
      id: companyId,
      name: "Weather Corp",
      issuePrefix: "WEA",
      requireBoardApprovalForNewAgents: false,
    });

    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "CEO",
      role: "ceo",
      status: "active",
      adapterType: "process",
      adapterConfig: {
        command: process.execPath,
        args: ["-e", "setInterval(() => {}, 1000)"],
      },
      runtimeConfig: {},
      permissions: {},
    });

    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Launch the company",
      status: "todo",
      priority: "medium",
      assigneeAgentId: agentId,
    });

    try {
      const run = await heartbeat.wakeup(agentId, {
        source: "assignment",
        triggerDetail: "system",
        reason: "issue_assigned",
        payload: { issueId },
        contextSnapshot: { issueId, source: "issue.update" },
      });

      expect(run).not.toBeNull();
      expect((await waitForRunStatus(run!.id, "running"))?.status).toBe("running");

      const lease = await db
        .select()
        .from(executionLeases)
        .where(
          and(
            eq(executionLeases.companyId, companyId),
            eq(executionLeases.issueId, issueId),
            eq(executionLeases.runId, run!.id),
            eq(executionLeases.state, "granted"),
          ),
        )
        .then((rows) => rows[0] ?? null);

      expect(lease).not.toBeNull();
      expect(lease?.agentId).toBe(agentId);
      expect(lease?.leaseType).toBe("issue_execution");

      const issue = await db
        .select({
          executionLeaseId: issues.executionLeaseId,
        })
        .from(issues)
        .where(eq(issues.id, issueId))
        .then((rows) => rows[0] ?? null);

      expect(issue).not.toBeNull();
      expect(issue?.executionLeaseId).toBe(lease?.id ?? null);
    } finally {
      await heartbeat.cancelActiveForAgent(agentId);
    }
  });

  it("keeps direct-assignment wakeup ownership coherent through reconciliation", async () => {
    const companyId = randomUUID();
    const agentId = randomUUID();
    const issueId = randomUUID();

    await db.insert(companies).values({
      id: companyId,
      name: "Launch Co",
      issuePrefix: "LCH",
      requireBoardApprovalForNewAgents: false,
    });

    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "Builder",
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

    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Handle onboarding launch",
      status: "todo",
      priority: "medium",
      assigneeAgentId: agentId,
    });

    try {
      const run = await heartbeat.wakeup(agentId, {
        source: "assignment",
        triggerDetail: "system",
        reason: "issue_assigned",
        payload: { issueId },
        contextSnapshot: { issueId, source: "issue.update" },
      });

      expect(run).not.toBeNull();

      const runningRun = await waitForRunStatus(run!.id, "running");
      expect(runningRun?.status).toBe("running");

      const lease = await db
        .select()
        .from(executionLeases)
        .where(
          and(
            eq(executionLeases.companyId, companyId),
            eq(executionLeases.issueId, issueId),
            eq(executionLeases.runId, run!.id),
            eq(executionLeases.state, "granted"),
          ),
        )
        .then((rows) => rows[0] ?? null);

      expect(lease).not.toBeNull();

      const issueBeforeReconcile = await db
        .select({
          executionRunId: issues.executionRunId,
          executionLeaseId: issues.executionLeaseId,
        })
        .from(issues)
        .where(eq(issues.id, issueId))
        .then((rows) => rows[0] ?? null);

      expect(issueBeforeReconcile).toEqual({
        executionRunId: run!.id,
        executionLeaseId: lease!.id,
      });

      const projectionBeforeReconcile = await projections.getIssueProjection(issueId);
      expect(projectionBeforeReconcile).toMatchObject({
        projectedStatus: "todo",
        activeRunId: run!.id,
        activeLeaseId: lease!.id,
      });

      const reconcileResult = await reconciler.reconcile(companyId);
      expect(reconcileResult.orphanedRunsClosed).toBe(0);

      const runAfterReconcile = await db
        .select({
          id: heartbeatRuns.id,
          status: heartbeatRuns.status,
          errorCode: heartbeatRuns.errorCode,
        })
        .from(heartbeatRuns)
        .where(eq(heartbeatRuns.id, run!.id))
        .then((rows) => rows[0] ?? null);

      expect(runAfterReconcile).toEqual({
        id: run!.id,
        status: "running",
        errorCode: null,
      });

      const projectionAfterReconcile = await projections.getIssueProjection(issueId);
      expect(projectionAfterReconcile).toMatchObject({
        projectedStatus: "todo",
        activeRunId: run!.id,
        activeLeaseId: lease!.id,
      });

      const orphanCloseEvents = await db
        .select()
        .from(controlPlaneEvents)
        .where(eq(controlPlaneEvents.companyId, companyId));

      expect(
        orphanCloseEvents.some(
          (event) =>
            event.entityType === "run"
            && event.entityId === run!.id
            && event.eventType === "reconciliation_orphaned_run_closed",
        ),
      ).toBe(false);
    } finally {
      await heartbeat.cancelActiveForAgent(agentId);
    }
  });
});
