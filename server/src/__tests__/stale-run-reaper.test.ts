import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  agents,
  companies,
  controlPlaneEvents,
  createDb,
  executionLeases,
  heartbeatRunEvents,
  heartbeatRuns,
  issues,
  projects,
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
    `Skipping embedded Postgres stale run reaper tests: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeDB("stale run reaper (reapStaleLeaseRuns)", () => {
  let db!: ReturnType<typeof createDb>;
  let heartbeat!: ReturnType<typeof heartbeatService>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  // Shared test data
  let companyId: string;
  let agentId: string;
  let projectId: string;
  let issueId: string;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("stale-reaper-");
    db = createDb(tempDb.connectionString);
    heartbeat = heartbeatService(db);
  }, 30_000);

  afterEach(async () => {
    await db.execute(sql`TRUNCATE TABLE
      control_plane_events,
      execution_leases,
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

  /** Helper: seed company + agent + project + issue */
  async function seedTestData() {
    companyId = randomUUID();
    agentId = randomUUID();
    projectId = randomUUID();
    issueId = randomUUID();

    await db.insert(companies).values({
      id: companyId,
      name: "TestCo",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
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
    });

    await db.insert(projects).values({
      id: projectId,
      companyId,
      name: "TestProject",
      status: "active",
    });

    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Test Issue",
      status: "todo",
      priority: "medium",
      projectId,
    });
  }

  /** Helper: create a run linked to a lease */
  async function createRunWithLease(opts: {
    runStatus?: string;
    leaseState?: string;
    leaseExpiresAt?: Date;
    leaseGrantedAt?: Date;
    leaseRenewedAt?: Date | null;
    setExecutionRunId?: boolean;
    setCheckoutRunId?: boolean;
  }) {
    const runId = randomUUID();

    await db.insert(heartbeatRuns).values({
      id: runId,
      companyId,
      agentId,
      invocationSource: "scheduler",
      status: opts.runStatus ?? "running",
    });

    // Set executionRunId on the issue if requested
    if (opts.setExecutionRunId !== false) {
      await db
        .update(issues)
        .set({
          executionRunId: runId,
          executionAgentNameKey: "testagent",
          executionLockedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(issues.id, issueId));
    }

    // Set checkoutRunId on the issue if requested
    if (opts.setCheckoutRunId) {
      await db
        .update(issues)
        .set({
          checkoutRunId: runId,
          updatedAt: new Date(),
        })
        .where(eq(issues.id, issueId));
    }

    const leaseId = randomUUID();
    await db.insert(executionLeases).values({
      id: leaseId,
      leaseType: "issue_execution_lease",
      issueId,
      agentId,
      runId,
      state: opts.leaseState ?? "expired",
      companyId,
      grantedAt: opts.leaseGrantedAt ?? new Date(Date.now() - 600_000),
      renewedAt: opts.leaseRenewedAt ?? null,
      expiresAt: opts.leaseExpiresAt ?? new Date(Date.now() - 100),
    });

    return { runId, leaseId };
  }

  // ─── VAL-HARD-050: Reaper cancels runs with expired leases ────────────────

  describe("VAL-HARD-050: Reaper cancels runs with expired leases", () => {
    it("cancels a running run whose lease has already expired (state=expired)", async () => {
      await seedTestData();
      const { runId, leaseId } = await createRunWithLease({
        runStatus: "running",
        leaseState: "expired",
        leaseExpiresAt: new Date(Date.now() - 100),
      });

      const result = await heartbeat.reapStaleLeaseRuns();

      expect(result.reaped).toBe(1);
      expect(result.runIds).toContain(runId);

      // Verify run status is now failed
      const [run] = await db
        .select()
        .from(heartbeatRuns)
        .where(eq(heartbeatRuns.id, runId));
      expect(run.status).toBe("failed");
      expect(run.errorCode).toBe("lease_expired");
      expect(run.finishedAt).toBeInstanceOf(Date);
    });

    it("expires and cancels a run whose lease is still granted but past expiresAt", async () => {
      await seedTestData();
      const { runId, leaseId } = await createRunWithLease({
        runStatus: "running",
        leaseState: "granted",
        leaseExpiresAt: new Date(Date.now() - 100),
      });

      const result = await heartbeat.reapStaleLeaseRuns();

      expect(result.reaped).toBe(1);

      // Verify lease state changed to expired
      const [lease] = await db
        .select()
        .from(executionLeases)
        .where(eq(executionLeases.id, leaseId));
      expect(lease.state).toBe("expired");

      // Verify run is failed
      const [run] = await db
        .select()
        .from(heartbeatRuns)
        .where(eq(heartbeatRuns.id, runId));
      expect(run.status).toBe("failed");
    });

    it("expires and cancels a run whose lease is renewed but past expiresAt", async () => {
      await seedTestData();
      const { runId, leaseId } = await createRunWithLease({
        runStatus: "running",
        leaseState: "renewed",
        leaseExpiresAt: new Date(Date.now() - 100),
        leaseRenewedAt: new Date(Date.now() - 200_000),
      });

      const result = await heartbeat.reapStaleLeaseRuns();

      expect(result.reaped).toBe(1);

      const [lease] = await db
        .select()
        .from(executionLeases)
        .where(eq(executionLeases.id, leaseId));
      expect(lease.state).toBe("expired");
    });

    it("cancels a queued run whose lease has expired", async () => {
      await seedTestData();
      const { runId } = await createRunWithLease({
        runStatus: "queued",
        leaseState: "expired",
        leaseExpiresAt: new Date(Date.now() - 100),
      });

      const result = await heartbeat.reapStaleLeaseRuns();

      expect(result.reaped).toBe(1);

      const [run] = await db
        .select()
        .from(heartbeatRuns)
        .where(eq(heartbeatRuns.id, runId));
      expect(run.status).toBe("failed");
    });

    it("does NOT reap a run whose lease is still active and not expired", async () => {
      await seedTestData();
      const { runId } = await createRunWithLease({
        runStatus: "running",
        leaseState: "granted",
        leaseExpiresAt: new Date(Date.now() + 300_000), // 5 min in future
      });

      const result = await heartbeat.reapStaleLeaseRuns();

      expect(result.reaped).toBe(0);

      const [run] = await db
        .select()
        .from(heartbeatRuns)
        .where(eq(heartbeatRuns.id, runId));
      expect(run.status).toBe("running");
    });

    it("does NOT reap an already-completed run even if lease expired", async () => {
      await seedTestData();
      const { runId } = await createRunWithLease({
        runStatus: "completed",
        leaseState: "expired",
        leaseExpiresAt: new Date(Date.now() - 100),
        setExecutionRunId: false,
      });

      const result = await heartbeat.reapStaleLeaseRuns();

      expect(result.reaped).toBe(0);
    });

    it("reaps multiple stale runs in one call", async () => {
      await seedTestData();

      // Create a second issue for second run
      const issueId2 = randomUUID();
      await db.insert(issues).values({
        id: issueId2,
        companyId,
        title: "Test Issue 2",
        status: "todo",
        priority: "medium",
        projectId,
      });

      // First run with expired lease
      const runId1 = randomUUID();
      await db.insert(heartbeatRuns).values({
        id: runId1,
        companyId,
        agentId,
        invocationSource: "scheduler",
        status: "running",
      });
      await db
        .update(issues)
        .set({ executionRunId: runId1, updatedAt: new Date() })
        .where(eq(issues.id, issueId));
      await db.insert(executionLeases).values({
        leaseType: "issue_execution_lease",
        issueId,
        agentId,
        runId: runId1,
        state: "expired",
        companyId,
        grantedAt: new Date(Date.now() - 600_000),
        expiresAt: new Date(Date.now() - 100),
      });

      // Second run with expired lease
      const runId2 = randomUUID();
      await db.insert(heartbeatRuns).values({
        id: runId2,
        companyId,
        agentId,
        invocationSource: "scheduler",
        status: "running",
      });
      await db
        .update(issues)
        .set({ executionRunId: runId2, updatedAt: new Date() })
        .where(eq(issues.id, issueId2));
      await db.insert(executionLeases).values({
        leaseType: "issue_execution_lease",
        issueId: issueId2,
        agentId,
        runId: runId2,
        state: "expired",
        companyId,
        grantedAt: new Date(Date.now() - 600_000),
        expiresAt: new Date(Date.now() - 100),
      });

      const result = await heartbeat.reapStaleLeaseRuns();

      expect(result.reaped).toBe(2);
      expect(result.runIds).toContain(runId1);
      expect(result.runIds).toContain(runId2);
    });

    it("returns empty result when no stale runs exist", async () => {
      await seedTestData();
      const result = await heartbeat.reapStaleLeaseRuns();
      expect(result.reaped).toBe(0);
      expect(result.runIds).toEqual([]);
    });
  });

  // ─── VAL-HARD-051: Reaper releases issue execution lock ───────────────────

  describe("VAL-HARD-051: Reaper releases issue execution lock on stale run", () => {
    it("clears executionRunId on the issue when a stale run is reaped", async () => {
      await seedTestData();

      // Confirm executionRunId is set before reaping
      const { runId } = await createRunWithLease({
        runStatus: "running",
        leaseState: "expired",
        setExecutionRunId: true,
      });

      const [beforeReap] = await db
        .select({ executionRunId: issues.executionRunId })
        .from(issues)
        .where(eq(issues.id, issueId));
      expect(beforeReap.executionRunId).toBe(runId);

      await heartbeat.reapStaleLeaseRuns();

      const [afterReap] = await db
        .select({
          executionRunId: issues.executionRunId,
          executionAgentNameKey: issues.executionAgentNameKey,
          executionLockedAt: issues.executionLockedAt,
        })
        .from(issues)
        .where(eq(issues.id, issueId));
      expect(afterReap.executionRunId).toBeNull();
      expect(afterReap.executionAgentNameKey).toBeNull();
      expect(afterReap.executionLockedAt).toBeNull();
    });

    it("handles run not linked to any issue via executionRunId", async () => {
      await seedTestData();
      const { runId } = await createRunWithLease({
        runStatus: "running",
        leaseState: "expired",
        setExecutionRunId: false,
      });

      // Should not throw
      const result = await heartbeat.reapStaleLeaseRuns();
      expect(result.reaped).toBe(1);

      // Issue should be unaffected
      const [issue] = await db
        .select({ executionRunId: issues.executionRunId })
        .from(issues)
        .where(eq(issues.id, issueId));
      expect(issue.executionRunId).toBeNull();
    });
  });

  // ─── VAL-HARD-052: Reaper emits events for cancelled stale runs ───────────

  describe("VAL-HARD-052: Reaper emits events for cancelled stale runs", () => {
    it("emits run_cancelled event to control_plane_events", async () => {
      await seedTestData();
      const { runId, leaseId } = await createRunWithLease({
        runStatus: "running",
        leaseState: "expired",
      });

      await heartbeat.reapStaleLeaseRuns();

      const events = await db
        .select()
        .from(controlPlaneEvents)
        .where(eq(controlPlaneEvents.eventType, "run_cancelled"));

      expect(events.length).toBeGreaterThanOrEqual(1);
      const runEvent = events.find(
        (e) => e.entityId === runId && e.entityType === "run",
      );
      expect(runEvent).toBeDefined();
      expect(runEvent!.companyId).toBe(companyId);
      expect(runEvent!.payload).toBeDefined();
      const payload = runEvent!.payload as Record<string, unknown>;
      expect(payload.runId).toBe(runId);
      expect(payload.leaseId).toBe(leaseId);
      expect(payload.reason).toBe("lease_expired");
    });

    it("emits lease_expired event to control_plane_events", async () => {
      await seedTestData();
      const { runId, leaseId } = await createRunWithLease({
        runStatus: "running",
        leaseState: "expired",
      });

      await heartbeat.reapStaleLeaseRuns();

      const events = await db
        .select()
        .from(controlPlaneEvents)
        .where(eq(controlPlaneEvents.eventType, "lease_expired"));

      expect(events.length).toBeGreaterThanOrEqual(1);
      const leaseEvent = events.find(
        (e) => e.entityId === leaseId && e.entityType === "lease",
      );
      expect(leaseEvent).toBeDefined();
      expect(leaseEvent!.companyId).toBe(companyId);
      const payload = leaseEvent!.payload as Record<string, unknown>;
      expect(payload.leaseId).toBe(leaseId);
      expect(payload.runId).toBe(runId);
      expect(payload.agentId).toBe(agentId);
      expect(payload.issueId).toBe(issueId);
    });

    it("emits both run_cancelled and lease_expired events for each reaped run", async () => {
      await seedTestData();
      const { runId, leaseId } = await createRunWithLease({
        runStatus: "running",
        leaseState: "expired",
      });

      await heartbeat.reapStaleLeaseRuns();

      const allEvents = await db.select().from(controlPlaneEvents);
      const runCancelled = allEvents.filter((e) => e.eventType === "run_cancelled");
      const leaseExpired = allEvents.filter((e) => e.eventType === "lease_expired");

      expect(runCancelled.length).toBe(1);
      expect(leaseExpired.length).toBe(1);
    });
  });

  // ─── VAL-HARD-053: Reaper increments pickup failure count ─────────────────

  describe("VAL-HARD-053: Reaper increments pickupFailCount on checkout timeout", () => {
    it("increments pickupFailCount when run never checked out the issue", async () => {
      await seedTestData();

      // Ensure pickupFailCount starts at 0
      const [before] = await db
        .select({ pickupFailCount: issues.pickupFailCount })
        .from(issues)
        .where(eq(issues.id, issueId));
      expect(before.pickupFailCount).toBe(0);

      await createRunWithLease({
        runStatus: "running",
        leaseState: "expired",
        setExecutionRunId: true,
        setCheckoutRunId: false, // no checkout
      });

      await heartbeat.reapStaleLeaseRuns();

      const [after] = await db
        .select({
          pickupFailCount: issues.pickupFailCount,
          lastPickupFailureAt: issues.lastPickupFailureAt,
        })
        .from(issues)
        .where(eq(issues.id, issueId));
      expect(after.pickupFailCount).toBe(1);
      expect(after.lastPickupFailureAt).toBeInstanceOf(Date);
    });

    it("does NOT increment pickupFailCount when run checked out the issue", async () => {
      await seedTestData();

      await createRunWithLease({
        runStatus: "running",
        leaseState: "expired",
        setExecutionRunId: true,
        setCheckoutRunId: true, // has checkout
      });

      await heartbeat.reapStaleLeaseRuns();

      const [after] = await db
        .select({ pickupFailCount: issues.pickupFailCount })
        .from(issues)
        .where(eq(issues.id, issueId));
      expect(after.pickupFailCount).toBe(0);
    });

    it("increments pickupFailCount cumulatively on repeated failures", async () => {
      await seedTestData();

      // First failure
      const { runId: runId1 } = await createRunWithLease({
        runStatus: "running",
        leaseState: "expired",
        setExecutionRunId: true,
        setCheckoutRunId: false,
      });

      await heartbeat.reapStaleLeaseRuns();

      const [after1] = await db
        .select({ pickupFailCount: issues.pickupFailCount })
        .from(issues)
        .where(eq(issues.id, issueId));
      expect(after1.pickupFailCount).toBe(1);

      // Reset executionRunId for second failure
      const runId2 = randomUUID();
      await db.insert(heartbeatRuns).values({
        id: runId2,
        companyId,
        agentId,
        invocationSource: "scheduler",
        status: "running",
      });
      await db
        .update(issues)
        .set({
          executionRunId: runId2,
          executionAgentNameKey: "testagent",
          executionLockedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(issues.id, issueId));
      await db.insert(executionLeases).values({
        leaseType: "issue_execution_lease",
        issueId,
        agentId,
        runId: runId2,
        state: "expired",
        companyId,
        grantedAt: new Date(Date.now() - 600_000),
        expiresAt: new Date(Date.now() - 100),
      });

      await heartbeat.reapStaleLeaseRuns();

      const [after2] = await db
        .select({ pickupFailCount: issues.pickupFailCount })
        .from(issues)
        .where(eq(issues.id, issueId));
      expect(after2.pickupFailCount).toBe(2);
    });

    it("sets lastPickupFailureAt when incrementing pickupFailCount", async () => {
      await seedTestData();

      await createRunWithLease({
        runStatus: "running",
        leaseState: "expired",
        setExecutionRunId: true,
        setCheckoutRunId: false,
      });

      const beforeTime = new Date();
      await heartbeat.reapStaleLeaseRuns();

      const [after] = await db
        .select({ lastPickupFailureAt: issues.lastPickupFailureAt })
        .from(issues)
        .where(eq(issues.id, issueId));
      expect(after.lastPickupFailureAt).toBeInstanceOf(Date);
      expect(after.lastPickupFailureAt!.getTime()).toBeGreaterThanOrEqual(
        beforeTime.getTime() - 1000,
      );
    });
  });

  // ─── Edge cases ───────────────────────────────────────────────────────────

  describe("edge cases", () => {
    it("handles run linked to lease on a different issue (via lease.issueId)", async () => {
      await seedTestData();

      const runId = randomUUID();
      await db.insert(heartbeatRuns).values({
        id: runId,
        companyId,
        agentId,
        invocationSource: "scheduler",
        status: "running",
      });

      // Don't set executionRunId, but lease has issueId
      await db.insert(executionLeases).values({
        leaseType: "issue_execution_lease",
        issueId,
        agentId,
        runId,
        state: "expired",
        companyId,
        grantedAt: new Date(Date.now() - 600_000),
        expiresAt: new Date(Date.now() - 100),
      });

      const result = await heartbeat.reapStaleLeaseRuns();
      expect(result.reaped).toBe(1);

      // pickupFailCount should be incremented via lease.issueId fallback
      const [issue] = await db
        .select({ pickupFailCount: issues.pickupFailCount })
        .from(issues)
        .where(eq(issues.id, issueId));
      expect(issue.pickupFailCount).toBe(1);
    });

    it("idempotent: calling reaper twice does not double-reap", async () => {
      await seedTestData();
      await createRunWithLease({
        runStatus: "running",
        leaseState: "expired",
      });

      const result1 = await heartbeat.reapStaleLeaseRuns();
      expect(result1.reaped).toBe(1);

      const result2 = await heartbeat.reapStaleLeaseRuns();
      expect(result2.reaped).toBe(0);
    });

    it("processes duplicate expired lease rows for one run only once", async () => {
      await seedTestData();

      const runId = randomUUID();
      await db.insert(heartbeatRuns).values({
        id: runId,
        companyId,
        agentId,
        invocationSource: "scheduler",
        status: "running",
      });
      await db
        .update(issues)
        .set({
          executionRunId: runId,
          executionAgentNameKey: "testagent",
          executionLockedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(issues.id, issueId));

      await db.insert(executionLeases).values([
        {
          id: randomUUID(),
          leaseType: "issue_execution_lease",
          issueId,
          agentId,
          runId,
          state: "expired",
          companyId,
          grantedAt: new Date(Date.now() - 600_000),
          expiresAt: new Date(Date.now() - 100),
        },
        {
          id: randomUUID(),
          leaseType: "issue_execution_lease",
          issueId,
          agentId,
          runId,
          state: "expired",
          companyId,
          grantedAt: new Date(Date.now() - 600_000),
          expiresAt: new Date(Date.now() - 100),
        },
      ]);

      const result = await heartbeat.reapStaleLeaseRuns();
      expect(result.reaped).toBe(1);
      expect(result.runIds).toEqual([runId]);

      const [issue] = await db
        .select({ pickupFailCount: issues.pickupFailCount })
        .from(issues)
        .where(eq(issues.id, issueId));
      expect(issue.pickupFailCount).toBe(1);

      const runCancelledEvents = await db
        .select()
        .from(controlPlaneEvents)
        .where(eq(controlPlaneEvents.eventType, "run_cancelled"));
      expect(runCancelledEvents).toHaveLength(1);
    });

    it("ignores malformed expired lease rows from another company for the same run", async () => {
      await seedTestData();

      const otherCompanyId = randomUUID();
      const otherAgentId = randomUUID();
      const runId = randomUUID();

      await db.insert(companies).values({
        id: otherCompanyId,
        name: "OtherCo",
        issuePrefix: `O${otherCompanyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
        requireBoardApprovalForNewAgents: false,
      });

      await db.insert(agents).values({
        id: otherAgentId,
        companyId: otherCompanyId,
        name: "OtherAgent",
        role: "engineer",
        status: "active",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      });

      await db.insert(heartbeatRuns).values({
        id: runId,
        companyId,
        agentId,
        invocationSource: "scheduler",
        status: "running",
      });

      await db
        .update(issues)
        .set({
          executionRunId: runId,
          executionAgentNameKey: "testagent",
          executionLockedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(issues.id, issueId));

      await db.insert(executionLeases).values({
        id: randomUUID(),
        leaseType: "issue_execution_lease",
        issueId,
        agentId: otherAgentId,
        runId,
        state: "expired",
        companyId: otherCompanyId,
        grantedAt: new Date(Date.now() - 600_000),
        expiresAt: new Date(Date.now() - 100),
      });

      const result = await heartbeat.reapStaleLeaseRuns();

      expect(result.reaped).toBe(0);
      expect(result.runIds).toEqual([]);

      const [run] = await db
        .select({
          status: heartbeatRuns.status,
          errorCode: heartbeatRuns.errorCode,
        })
        .from(heartbeatRuns)
        .where(eq(heartbeatRuns.id, runId));
      expect(run.status).toBe("running");
      expect(run.errorCode).toBeNull();

      const events = await db
        .select({
          entityId: controlPlaneEvents.entityId,
          companyId: controlPlaneEvents.companyId,
          eventType: controlPlaneEvents.eventType,
        })
        .from(controlPlaneEvents);

      expect(events).toEqual([]);
    });
  });
});
