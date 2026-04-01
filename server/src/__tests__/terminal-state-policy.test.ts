import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  agents,
  companies,
  controlPlaneEvents,
  createDb,
  executionLeases,
  heartbeatRuns,
  issueComments,
  issues,
  projects,
} from "@papierklammer/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { terminalStatePolicyService } from "../services/terminal-state-policy.js";
import { eventLogService } from "../services/event-log.js";
import { leaseManagerService } from "../services/lease-manager.js";
import { eq, sql } from "drizzle-orm";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeDB = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres terminal-state-policy tests: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeDB("terminal-state policy service", () => {
  let db!: ReturnType<typeof createDb>;
  let policy!: ReturnType<typeof terminalStatePolicyService>;
  let eventLog!: ReturnType<typeof eventLogService>;
  let leaseMgr!: ReturnType<typeof leaseManagerService>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  // Shared test data
  let companyId: string;
  let agentId: string;
  let managerId: string;
  let projectId: string;
  let issueId: string;
  let runId: string;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("terminal-state-policy-");
    db = createDb(tempDb.connectionString);
    policy = terminalStatePolicyService(db);
    eventLog = eventLogService(db);
    leaseMgr = leaseManagerService(db);
  }, 30_000);

  afterEach(async () => {
    await db.execute(sql`TRUNCATE TABLE
      control_plane_events,
      execution_leases,
      issue_comments,
      heartbeat_run_events,
      heartbeat_runs,
      issues,
      projects,
      agents,
      companies
      CASCADE`);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  /** Helper: seed company + manager + agent + project + issue + run */
  async function seedTestData(opts?: {
    issueStatus?: string;
    checkoutRunId?: string | null;
    runStatus?: string;
    runStartedAt?: Date;
    runFinishedAt?: Date;
  }) {
    companyId = randomUUID();
    managerId = randomUUID();
    agentId = randomUUID();
    projectId = randomUUID();
    issueId = randomUUID();
    runId = randomUUID();

    await db.insert(companies).values({
      id: companyId,
      name: "TestCo",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });

    // Manager agent
    await db.insert(agents).values({
      id: managerId,
      companyId,
      name: "Manager",
      role: "manager",
      status: "active",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
      reportsTo: null,
    });

    // Worker agent (reports to manager)
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "TestAgent",
      role: "engineer",
      status: "active",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
      reportsTo: managerId,
    });

    await db.insert(projects).values({
      id: projectId,
      companyId,
      name: "TestProject",
      status: "active",
    });

    const startedAt = opts?.runStartedAt ?? new Date(Date.now() - 60_000);
    const finishedAt = opts?.runFinishedAt ?? new Date();

    // Insert the run BEFORE the issue (because issue FKs reference heartbeat_runs)
    await db.insert(heartbeatRuns).values({
      id: runId,
      companyId,
      agentId,
      invocationSource: "scheduler",
      status: opts?.runStatus ?? "succeeded",
      startedAt,
      finishedAt,
      contextSnapshot: { issueId },
    });

    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Test Issue",
      status: opts?.issueStatus ?? "in_progress",
      priority: "medium",
      projectId,
      assigneeAgentId: agentId,
      checkoutRunId: opts?.checkoutRunId !== undefined ? opts.checkoutRunId : runId,
      executionRunId: runId,
    });
  }

  // ─── VAL-REL-006: Terminal-state policy enforced ──────────────────────────

  describe("VAL-REL-006: Terminal-state policy enforced", () => {
    it("silent run completion → run marked failed with terminal_state_violation", async () => {
      await seedTestData();

      const result = await policy.enforceOnRunCompletion({
        runId,
        companyId,
        agentId,
        issueId,
        runStartedAt: new Date(Date.now() - 60_000),
        runFinishedAt: new Date(),
      });

      expect(result.violated).toBe(true);
      expect(result.reason).toContain("without updating issue status");

      // Verify run is marked as failed with terminal_state_violation
      const [run] = await db
        .select({
          status: heartbeatRuns.status,
          errorCode: heartbeatRuns.errorCode,
          error: heartbeatRuns.error,
        })
        .from(heartbeatRuns)
        .where(eq(heartbeatRuns.id, runId));

      expect(run.status).toBe("failed");
      expect(run.errorCode).toBe("terminal_state_violation");
      expect(run.error).toContain("without updating issue status");
    });

    it("auto-comment added to issue explaining failure", async () => {
      await seedTestData();

      await policy.enforceOnRunCompletion({
        runId,
        companyId,
        agentId,
        issueId,
        runStartedAt: new Date(Date.now() - 60_000),
        runFinishedAt: new Date(),
      });

      // Verify auto-comment on the issue
      const comments = await db
        .select()
        .from(issueComments)
        .where(eq(issueComments.issueId, issueId));

      // There should be at least the terminal-state policy comment
      // (escalation also creates a comment, so might be 2)
      expect(comments.length).toBeGreaterThanOrEqual(1);
      const policyComment = comments.find(
        (c) => c.body.includes("Terminal-state policy violation"),
      );
      expect(policyComment).toBeDefined();
      expect(policyComment!.body).toContain("without updating issue status");
    });

    it("escalation triggered on silent run completion", async () => {
      await seedTestData();

      await policy.enforceOnRunCompletion({
        runId,
        companyId,
        agentId,
        issueId,
        runStartedAt: new Date(Date.now() - 60_000),
        runFinishedAt: new Date(),
      });

      // Verify auto_escalation_created event emitted
      const events = await db
        .select()
        .from(controlPlaneEvents)
        .where(eq(controlPlaneEvents.eventType, "auto_escalation_created"));

      expect(events.length).toBeGreaterThanOrEqual(1);
      const silentEscalation = events.find(
        (e) => (e.payload as Record<string, unknown>)?.escalationType === "silent_run_completion",
      );
      expect(silentEscalation).toBeDefined();
      expect((silentEscalation!.payload as Record<string, unknown>).runId).toBe(runId);
    });

    it("run_failed event emitted on terminal-state violation", async () => {
      await seedTestData();

      await policy.enforceOnRunCompletion({
        runId,
        companyId,
        agentId,
        issueId,
        runStartedAt: new Date(Date.now() - 60_000),
        runFinishedAt: new Date(),
      });

      // Verify run_failed event emitted
      const events = await db
        .select()
        .from(controlPlaneEvents)
        .where(eq(controlPlaneEvents.eventType, "run_failed"));

      expect(events.length).toBeGreaterThanOrEqual(1);
      const failEvent = events.find(
        (e) => (e.payload as Record<string, unknown>)?.errorCode === "terminal_state_violation",
      );
      expect(failEvent).toBeDefined();
    });
  });

  // ─── Normal completion with comment → succeeds normally ──────────────────

  describe("normal completion with comment → succeeds normally", () => {
    it("run with comment during execution → not violated", async () => {
      await seedTestData();

      const runStartedAt = new Date(Date.now() - 60_000);

      // Add a comment on the issue that was created during the run
      await db.insert(issueComments).values({
        companyId,
        issueId,
        authorAgentId: agentId,
        body: "Working on this issue",
        createdAt: new Date(runStartedAt.getTime() + 10_000), // 10s after run started
      });

      const result = await policy.enforceOnRunCompletion({
        runId,
        companyId,
        agentId,
        issueId,
        runStartedAt,
        runFinishedAt: new Date(),
      });

      expect(result.violated).toBe(false);

      // Verify run is still succeeded
      const [run] = await db
        .select({ status: heartbeatRuns.status })
        .from(heartbeatRuns)
        .where(eq(heartbeatRuns.id, runId));
      expect(run.status).toBe("succeeded");
    });

    it("run with status change during execution → not violated", async () => {
      await seedTestData();

      const runStartedAt = new Date(Date.now() - 60_000);

      // Emit an issue_status_changed event during the run
      await eventLog.emit({
        companyId,
        entityType: "issue",
        entityId: issueId,
        eventType: "issue_status_changed",
        payload: {
          issueId,
          previousStatus: "todo",
          newStatus: "in_progress",
          agentId,
        },
      });

      const result = await policy.enforceOnRunCompletion({
        runId,
        companyId,
        agentId,
        issueId,
        runStartedAt,
        runFinishedAt: new Date(),
      });

      expect(result.violated).toBe(false);
    });

    it("run with keepalive (lease renewal) during execution → not violated", async () => {
      await seedTestData();

      const runStartedAt = new Date(Date.now() - 60_000);

      // Create a lease and renew it (simulating keepalive)
      const lease = await leaseMgr.grantLease({
        leaseType: "issue_execution_lease",
        issueId,
        agentId,
        runId,
        companyId,
        ttlSeconds: 300,
      });

      // Renew the lease (this emits a lease_renewed event via the lease manager)
      await leaseMgr.renewLease(lease.id);

      const result = await policy.enforceOnRunCompletion({
        runId,
        companyId,
        agentId,
        issueId,
        runStartedAt,
        runFinishedAt: new Date(),
      });

      expect(result.violated).toBe(false);
    });
  });

  // ─── Edge cases ──────────────────────────────────────────────────────────

  describe("edge cases", () => {
    it("run without checked-out issue → not violated", async () => {
      // Seed without any checkoutRunId on the issue
      companyId = randomUUID();
      managerId = randomUUID();
      agentId = randomUUID();
      projectId = randomUUID();
      issueId = randomUUID();
      runId = randomUUID();

      await db.insert(companies).values({
        id: companyId,
        name: "TestCo",
        issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
        requireBoardApprovalForNewAgents: false,
      });
      await db.insert(agents).values({
        id: managerId,
        companyId,
        name: "Manager",
        role: "manager",
        status: "active",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
        reportsTo: null,
      });
      await db.insert(agents).values({
        id: agentId,
        companyId,
        name: "TestAgent",
        role: "engineer",
        status: "active",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
        reportsTo: managerId,
      });
      await db.insert(projects).values({
        id: projectId,
        companyId,
        name: "TestProject",
        status: "active",
      });
      await db.insert(heartbeatRuns).values({
        id: runId,
        companyId,
        agentId,
        invocationSource: "scheduler",
        status: "succeeded",
        startedAt: new Date(Date.now() - 60_000),
        finishedAt: new Date(),
        contextSnapshot: { issueId },
      });
      await db.insert(issues).values({
        id: issueId,
        companyId,
        title: "Test Issue",
        status: "in_progress",
        priority: "medium",
        projectId,
        assigneeAgentId: agentId,
        checkoutRunId: null,
        executionRunId: null,
      });

      const result = await policy.enforceOnRunCompletion({
        runId,
        companyId,
        agentId,
        issueId,
        runStartedAt: new Date(Date.now() - 60_000),
        runFinishedAt: new Date(),
      });

      expect(result.violated).toBe(false);
    });

    it("run with different checkoutRunId → not violated", async () => {
      // Need to create another run first so the FK can reference it
      const otherRunId = randomUUID();

      companyId = randomUUID();
      managerId = randomUUID();
      agentId = randomUUID();
      projectId = randomUUID();
      issueId = randomUUID();
      runId = randomUUID();

      await db.insert(companies).values({
        id: companyId,
        name: "TestCo",
        issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
        requireBoardApprovalForNewAgents: false,
      });
      await db.insert(agents).values({
        id: managerId,
        companyId,
        name: "Manager",
        role: "manager",
        status: "active",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
        reportsTo: null,
      });
      await db.insert(agents).values({
        id: agentId,
        companyId,
        name: "TestAgent",
        role: "engineer",
        status: "active",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
        reportsTo: managerId,
      });
      await db.insert(projects).values({
        id: projectId,
        companyId,
        name: "TestProject",
        status: "active",
      });
      // Insert both runs
      await db.insert(heartbeatRuns).values({
        id: runId,
        companyId,
        agentId,
        invocationSource: "scheduler",
        status: "succeeded",
        startedAt: new Date(Date.now() - 60_000),
        finishedAt: new Date(),
        contextSnapshot: { issueId },
      });
      await db.insert(heartbeatRuns).values({
        id: otherRunId,
        companyId,
        agentId,
        invocationSource: "scheduler",
        status: "succeeded",
        startedAt: new Date(Date.now() - 120_000),
        finishedAt: new Date(Date.now() - 60_000),
        contextSnapshot: { issueId },
      });
      await db.insert(issues).values({
        id: issueId,
        companyId,
        title: "Test Issue",
        status: "in_progress",
        priority: "medium",
        projectId,
        assigneeAgentId: agentId,
        checkoutRunId: otherRunId, // Different run checked out
        executionRunId: runId,
      });

      const result = await policy.enforceOnRunCompletion({
        runId,
        companyId,
        agentId,
        issueId,
        runStartedAt: new Date(Date.now() - 60_000),
        runFinishedAt: new Date(),
      });

      expect(result.violated).toBe(false);
    });

    it("run with null issueId → not violated", async () => {
      await seedTestData();

      const result = await policy.enforceOnRunCompletion({
        runId,
        companyId,
        agentId,
        issueId: null,
        runStartedAt: new Date(Date.now() - 60_000),
        runFinishedAt: new Date(),
      });

      expect(result.violated).toBe(false);
    });

    it("issue already in done status → not violated (terminal state reached)", async () => {
      await seedTestData({ issueStatus: "done" });

      const result = await policy.enforceOnRunCompletion({
        runId,
        companyId,
        agentId,
        issueId,
        runStartedAt: new Date(Date.now() - 60_000),
        runFinishedAt: new Date(),
      });

      expect(result.violated).toBe(false);
    });

    it("issue already in cancelled status → not violated", async () => {
      await seedTestData({ issueStatus: "cancelled" });

      const result = await policy.enforceOnRunCompletion({
        runId,
        companyId,
        agentId,
        issueId,
        runStartedAt: new Date(Date.now() - 60_000),
        runFinishedAt: new Date(),
      });

      expect(result.violated).toBe(false);
    });

    it("comment created before run started → still violated", async () => {
      await seedTestData();

      const runStartedAt = new Date(Date.now() - 60_000);

      // Add a comment BEFORE the run started
      await db.insert(issueComments).values({
        companyId,
        issueId,
        authorAgentId: agentId,
        body: "Old comment from before the run",
        createdAt: new Date(runStartedAt.getTime() - 120_000), // 2 min before run
      });

      const result = await policy.enforceOnRunCompletion({
        runId,
        companyId,
        agentId,
        issueId,
        runStartedAt,
        runFinishedAt: new Date(),
      });

      expect(result.violated).toBe(true);
    });

    it("non-existent issue → not violated", async () => {
      await seedTestData();

      const result = await policy.enforceOnRunCompletion({
        runId,
        companyId,
        agentId,
        issueId: randomUUID(), // non-existent
        runStartedAt: new Date(Date.now() - 60_000),
        runFinishedAt: new Date(),
      });

      expect(result.violated).toBe(false);
    });
  });
});
