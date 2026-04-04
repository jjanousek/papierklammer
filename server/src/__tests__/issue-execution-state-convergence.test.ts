import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { agents, companies, createDb, heartbeatRuns, issues } from "@papierklammer/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { issueService } from "../services/issues.js";
import { eq, sql } from "drizzle-orm";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeDB = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping issue execution convergence tests: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeDB("issue execution state convergence", () => {
  let db!: ReturnType<typeof createDb>;
  let svc!: ReturnType<typeof issueService>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("issue-execution-convergence-");
    db = createDb(tempDb.connectionString);
    svc = issueService(db);
  }, 30_000);

  afterEach(async () => {
    await db.execute(sql`TRUNCATE TABLE heartbeat_runs, issues, agents, companies CASCADE`);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seedCompanyAndAgent() {
    const companyId = randomUUID();
    const agentId = randomUUID();

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });

    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "CEO",
      role: "ceo",
      status: "active",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });

    return { companyId, agentId };
  }

  it("clears stale execution ownership when the linked run is already terminal", async () => {
    const { companyId, agentId } = await seedCompanyAndAgent();
    const runId = randomUUID();
    const issueId = randomUUID();

    await db.insert(heartbeatRuns).values({
      id: runId,
      companyId,
      agentId,
      invocationSource: "manual",
      status: "failed",
      startedAt: new Date("2026-04-04T00:00:00Z"),
      finishedAt: new Date("2026-04-04T00:01:00Z"),
      contextSnapshot: { issueId },
    });

    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Starter issue",
      status: "todo",
      priority: "medium",
      assigneeAgentId: agentId,
      executionRunId: runId,
      executionAgentNameKey: "ceo",
      executionLockedAt: new Date("2026-04-04T00:00:30Z"),
    });

    const converged = await svc.convergeExecutionState(issueId);

    expect(converged).not.toBeNull();
    expect(converged?.activeRun).toBeNull();
    expect(converged?.issue.executionRunId).toBeNull();
    expect(converged?.issue.executionAgentNameKey).toBeNull();
    expect(converged?.issue.executionLockedAt).toBeNull();

    const stored = await db
      .select({
        executionRunId: issues.executionRunId,
        executionAgentNameKey: issues.executionAgentNameKey,
        executionLockedAt: issues.executionLockedAt,
      })
      .from(issues)
      .where(eq(issues.id, issueId))
      .then((rows) => rows[0] ?? null);

    expect(stored).toEqual({
      executionRunId: null,
      executionAgentNameKey: null,
      executionLockedAt: null,
    });
  });

  it("adopts the queued onboarding run when the issue still has active work in flight", async () => {
    const { companyId, agentId } = await seedCompanyAndAgent();
    const staleRunId = randomUUID();
    const queuedRunId = randomUUID();
    const issueId = randomUUID();

    await db.insert(heartbeatRuns).values([
      {
        id: staleRunId,
        companyId,
        agentId,
        invocationSource: "manual",
        status: "failed",
        startedAt: new Date("2026-04-04T00:00:00Z"),
        finishedAt: new Date("2026-04-04T00:01:00Z"),
        contextSnapshot: { issueId },
      },
      {
        id: queuedRunId,
        companyId,
        agentId,
        invocationSource: "manual",
        status: "queued",
        contextSnapshot: { issueId, wakeReason: "onboarding_launch" },
      },
    ]);

    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Starter issue",
      status: "todo",
      priority: "medium",
      assigneeAgentId: agentId,
      executionRunId: staleRunId,
      executionAgentNameKey: "ceo",
      executionLockedAt: new Date("2026-04-04T00:00:30Z"),
    });

    const converged = await svc.convergeExecutionState(issueId);

    expect(converged).not.toBeNull();
    expect(converged?.activeRun?.id).toBe(queuedRunId);
    expect(converged?.activeRun?.status).toBe("queued");
    expect(converged?.issue.executionRunId).toBe(queuedRunId);
    expect(converged?.issue.executionAgentNameKey).toBe("ceo");
    expect(converged?.issue.status).toBe("todo");

    const stored = await db
      .select({
        executionRunId: issues.executionRunId,
        executionAgentNameKey: issues.executionAgentNameKey,
      })
      .from(issues)
      .where(eq(issues.id, issueId))
      .then((rows) => rows[0] ?? null);

    expect(stored).toEqual({
      executionRunId: queuedRunId,
      executionAgentNameKey: "ceo",
    });
  });
});
