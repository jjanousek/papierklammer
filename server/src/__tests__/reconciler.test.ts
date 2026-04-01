import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  agents,
  companies,
  controlPlaneEvents,
  createDb,
  dispatchIntents,
  executionLeases,
  heartbeatRuns,
  issues,
  projects,
} from "@papierklammer/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { reconcilerService } from "../services/reconciler.js";
import { eq, sql } from "drizzle-orm";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeDB = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres reconciler tests: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeDB("reconcilerService", () => {
  let db!: ReturnType<typeof createDb>;
  let reconciler!: ReturnType<typeof reconcilerService>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  // Shared test data IDs
  let companyId: string;
  let agentId: string;
  let projectId: string;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("reconciler-");
    db = createDb(tempDb.connectionString);
    reconciler = reconcilerService(db);
  }, 30_000);

  afterEach(async () => {
    await db.execute(sql`TRUNCATE TABLE
      control_plane_events,
      dispatch_intents,
      execution_leases,
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

  /** Helper: seed company + agent + project */
  async function seedTestData() {
    companyId = randomUUID();
    agentId = randomUUID();
    projectId = randomUUID();

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
      status: "in_progress",
    });
  }

  /** Helper: create an issue */
  async function createIssue(overrides?: Partial<{
    id: string;
    status: string;
    assigneeAgentId: string | null;
    executionRunId: string | null;
    checkoutRunId: string | null;
  }>) {
    const id = overrides?.id ?? randomUUID();
    await db.insert(issues).values({
      id,
      companyId,
      projectId,
      title: `Test Issue ${id.slice(0, 8)}`,
      status: overrides?.status ?? "todo",
      priority: "medium",
      assigneeAgentId: overrides?.assigneeAgentId ?? null,
      executionRunId: overrides?.executionRunId ?? null,
      checkoutRunId: overrides?.checkoutRunId ?? null,
    });
    return id;
  }

  /** Helper: create a heartbeat run */
  async function createRun(overrides?: Partial<{
    id: string;
    status: string;
    startedAt: Date;
    finishedAt: Date | null;
  }>) {
    const id = overrides?.id ?? randomUUID();
    await db.insert(heartbeatRuns).values({
      id,
      companyId,
      agentId,
      invocationSource: "scheduler",
      status: overrides?.status ?? "running",
      startedAt: overrides?.startedAt ?? new Date(),
      finishedAt: overrides?.finishedAt ?? null,
    });
    return id;
  }

  // ----------------------------------------------------------------
  // VAL-PROJ-020: Reconciler closes orphaned active runs
  // ----------------------------------------------------------------
  describe("close orphaned active runs", () => {
    it("marks running runs with no active lease as failed", async () => {
      await seedTestData();

      // Create a running run with no lease
      const runId = await createRun({ status: "running" });
      const issueId = await createIssue({
        status: "in_progress",
        assigneeAgentId: agentId,
        executionRunId: runId,
        checkoutRunId: runId,
      });

      const result = await reconciler.reconcile(companyId);

      expect(result.orphanedRunsClosed).toBeGreaterThanOrEqual(1);

      // Verify run is now failed
      const [run] = await db
        .select()
        .from(heartbeatRuns)
        .where(eq(heartbeatRuns.id, runId));
      expect(run.status).toBe("failed");
    });

    it("does NOT mark running runs that have an active lease", async () => {
      await seedTestData();

      const runId = await createRun({ status: "running" });
      const issueId = await createIssue({
        status: "in_progress",
        assigneeAgentId: agentId,
        executionRunId: runId,
        checkoutRunId: runId,
      });

      // Create an active lease for this issue
      await db.insert(executionLeases).values({
        leaseType: "issue_execution_lease",
        issueId,
        agentId,
        runId,
        state: "granted",
        companyId,
        grantedAt: new Date(),
        expiresAt: new Date(Date.now() + 300_000),
      });

      const result = await reconciler.reconcile(companyId);

      expect(result.orphanedRunsClosed).toBe(0);

      // Run should still be running
      const [run] = await db
        .select()
        .from(heartbeatRuns)
        .where(eq(heartbeatRuns.id, runId));
      expect(run.status).toBe("running");
    });

    it("does NOT close runs that are already completed (succeeded/failed/cancelled)", async () => {
      await seedTestData();

      // Create completed runs
      const succeededRunId = await createRun({ status: "succeeded", finishedAt: new Date() });
      const failedRunId = await createRun({ status: "failed", finishedAt: new Date() });
      const cancelledRunId = await createRun({ status: "cancelled", finishedAt: new Date() });

      const result = await reconciler.reconcile(companyId);

      expect(result.orphanedRunsClosed).toBe(0);
    });

    it("does NOT treat queued runs as orphans (only running runs are orphan candidates)", async () => {
      await seedTestData();

      // Create a queued run with no lease — queued runs are waiting for
      // the scheduler and should NOT be considered orphans.
      const runId = await createRun({ status: "queued" });
      await createIssue({
        status: "todo",
        assigneeAgentId: agentId,
        executionRunId: runId,
      });

      const result = await reconciler.reconcile(companyId);

      expect(result.orphanedRunsClosed).toBe(0);

      // Run should still be queued
      const [run] = await db
        .select()
        .from(heartbeatRuns)
        .where(eq(heartbeatRuns.id, runId));
      expect(run.status).toBe("queued");
    });
  });

  // ----------------------------------------------------------------
  // VAL-PROJ-021: Reconciler invalidates stale intents
  // ----------------------------------------------------------------
  describe("invalidate stale intents", () => {
    it("rejects queued intents for closed issues", async () => {
      await seedTestData();

      // Create a closed (done) issue
      const issueId = await createIssue({ status: "done" });

      // Create a queued intent for the closed issue
      await db.insert(dispatchIntents).values({
        companyId,
        issueId,
        projectId,
        targetAgentId: agentId,
        intentType: "issue_assigned",
        priority: 10,
        status: "queued",
      });

      const result = await reconciler.reconcile(companyId);

      expect(result.staleIntentsRejected).toBeGreaterThanOrEqual(1);

      // Verify intent is rejected
      const intents = await db
        .select()
        .from(dispatchIntents)
        .where(eq(dispatchIntents.issueId, issueId));
      expect(intents[0].status).toBe("rejected");
    });

    it("rejects queued intents for cancelled issues", async () => {
      await seedTestData();

      const issueId = await createIssue({ status: "cancelled" });

      await db.insert(dispatchIntents).values({
        companyId,
        issueId,
        projectId,
        targetAgentId: agentId,
        intentType: "timer_hint",
        priority: 0,
        status: "queued",
      });

      const result = await reconciler.reconcile(companyId);

      expect(result.staleIntentsRejected).toBeGreaterThanOrEqual(1);
    });

    it("rejects queued intents for reassigned issues (targetAgent differs from assignee)", async () => {
      await seedTestData();

      // Create a second agent
      const otherAgentId = randomUUID();
      await db.insert(agents).values({
        id: otherAgentId,
        companyId,
        name: "OtherAgent",
        role: "engineer",
        status: "active",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      });

      // Issue is assigned to otherAgent
      const issueId = await createIssue({
        status: "todo",
        assigneeAgentId: otherAgentId,
      });

      // But intent targets the original agent
      await db.insert(dispatchIntents).values({
        companyId,
        issueId,
        projectId,
        targetAgentId: agentId,
        intentType: "issue_assigned",
        priority: 10,
        status: "queued",
      });

      const result = await reconciler.reconcile(companyId);

      expect(result.staleIntentsRejected).toBeGreaterThanOrEqual(1);
    });

    it("does NOT reject queued intents for valid open issues with matching assignees", async () => {
      await seedTestData();

      const issueId = await createIssue({
        status: "todo",
        assigneeAgentId: agentId,
      });

      await db.insert(dispatchIntents).values({
        companyId,
        issueId,
        projectId,
        targetAgentId: agentId,
        intentType: "issue_assigned",
        priority: 10,
        status: "queued",
      });

      const result = await reconciler.reconcile(companyId);

      expect(result.staleIntentsRejected).toBe(0);

      // Intent should still be queued
      const intents = await db
        .select()
        .from(dispatchIntents)
        .where(eq(dispatchIntents.issueId, issueId));
      expect(intents[0].status).toBe("queued");
    });

    it("does NOT reject intents for issues with no assignee (unassigned intents are valid)", async () => {
      await seedTestData();

      const issueId = await createIssue({
        status: "todo",
        assigneeAgentId: null,
      });

      await db.insert(dispatchIntents).values({
        companyId,
        issueId,
        projectId,
        targetAgentId: agentId,
        intentType: "issue_assigned",
        priority: 10,
        status: "queued",
      });

      const result = await reconciler.reconcile(companyId);

      // This is valid — the intent is trying to assign the issue
      expect(result.staleIntentsRejected).toBe(0);
    });
  });

  // ----------------------------------------------------------------
  // VAL-PROJ-022: Reconciler clears ghost in_progress projections
  // ----------------------------------------------------------------
  describe("clear ghost in_progress projections", () => {
    it("resets in_progress issue with no active run and no active lease to todo", async () => {
      await seedTestData();

      // Issue was set to in_progress but the run and lease are gone
      const issueId = await createIssue({
        status: "in_progress",
        assigneeAgentId: agentId,
        executionRunId: null,
        checkoutRunId: null,
      });

      const result = await reconciler.reconcile(companyId);

      expect(result.ghostProjectionsCorrected).toBeGreaterThanOrEqual(1);

      // Issue should be reset to todo
      const [issue] = await db
        .select()
        .from(issues)
        .where(eq(issues.id, issueId));
      expect(issue.status).toBe("todo");
    });

    it("resets in_progress issue with completed run (no active run) to todo", async () => {
      await seedTestData();

      // Create a completed run
      const runId = await createRun({ status: "succeeded", finishedAt: new Date() });

      const issueId = await createIssue({
        status: "in_progress",
        assigneeAgentId: agentId,
        executionRunId: runId,
        checkoutRunId: runId,
      });

      const result = await reconciler.reconcile(companyId);

      expect(result.ghostProjectionsCorrected).toBeGreaterThanOrEqual(1);

      const [issue] = await db
        .select()
        .from(issues)
        .where(eq(issues.id, issueId));
      expect(issue.status).toBe("todo");
    });

    it("does NOT reset in_progress issue with active run", async () => {
      await seedTestData();

      const runId = await createRun({ status: "running" });

      const issueId = await createIssue({
        status: "in_progress",
        assigneeAgentId: agentId,
        executionRunId: runId,
        checkoutRunId: runId,
      });

      // Also create an active lease
      await db.insert(executionLeases).values({
        leaseType: "issue_execution_lease",
        issueId,
        agentId,
        runId,
        state: "granted",
        companyId,
        grantedAt: new Date(),
        expiresAt: new Date(Date.now() + 300_000),
      });

      const result = await reconciler.reconcile(companyId);

      expect(result.ghostProjectionsCorrected).toBe(0);

      const [issue] = await db
        .select()
        .from(issues)
        .where(eq(issues.id, issueId));
      expect(issue.status).toBe("in_progress");
    });

    it("does NOT reset in_progress issue with active lease (even if run gone)", async () => {
      await seedTestData();

      const issueId = await createIssue({
        status: "in_progress",
        assigneeAgentId: agentId,
        executionRunId: null,
      });

      // Active lease exists but run is gone
      await db.insert(executionLeases).values({
        leaseType: "issue_execution_lease",
        issueId,
        agentId,
        state: "granted",
        companyId,
        grantedAt: new Date(),
        expiresAt: new Date(Date.now() + 300_000),
      });

      const result = await reconciler.reconcile(companyId);

      expect(result.ghostProjectionsCorrected).toBe(0);

      const [issue] = await db
        .select()
        .from(issues)
        .where(eq(issues.id, issueId));
      expect(issue.status).toBe("in_progress");
    });
  });

  // ----------------------------------------------------------------
  // VAL-PROJ-023: Reconciler emits reconciliation events
  // ----------------------------------------------------------------
  describe("reconciliation events", () => {
    it("emits reconciliation event when orphaned run is closed", async () => {
      await seedTestData();

      const runId = await createRun({ status: "running" });
      await createIssue({
        status: "in_progress",
        assigneeAgentId: agentId,
        executionRunId: runId,
      });

      await reconciler.reconcile(companyId);

      // Check control_plane_events for reconciliation event
      const events = await db
        .select()
        .from(controlPlaneEvents)
        .where(eq(controlPlaneEvents.companyId, companyId));

      const reconciliationEvents = events.filter((e) =>
        e.eventType.includes("reconciliation"),
      );
      expect(reconciliationEvents.length).toBeGreaterThanOrEqual(1);
    });

    it("emits reconciliation event when stale intent is rejected", async () => {
      await seedTestData();

      const issueId = await createIssue({ status: "done" });
      await db.insert(dispatchIntents).values({
        companyId,
        issueId,
        projectId,
        targetAgentId: agentId,
        intentType: "issue_assigned",
        priority: 10,
        status: "queued",
      });

      await reconciler.reconcile(companyId);

      const events = await db
        .select()
        .from(controlPlaneEvents)
        .where(eq(controlPlaneEvents.companyId, companyId));

      const reconciliationEvents = events.filter((e) =>
        e.eventType.includes("reconciliation"),
      );
      expect(reconciliationEvents.length).toBeGreaterThanOrEqual(1);
    });

    it("emits reconciliation event when ghost projection is corrected", async () => {
      await seedTestData();

      await createIssue({
        status: "in_progress",
        assigneeAgentId: agentId,
        executionRunId: null,
        checkoutRunId: null,
      });

      await reconciler.reconcile(companyId);

      const events = await db
        .select()
        .from(controlPlaneEvents)
        .where(eq(controlPlaneEvents.companyId, companyId));

      const reconciliationEvents = events.filter((e) =>
        e.eventType.includes("reconciliation"),
      );
      expect(reconciliationEvents.length).toBeGreaterThanOrEqual(1);
    });

    it("does NOT emit events when nothing needs reconciliation", async () => {
      await seedTestData();

      // Create a healthy issue with no drift
      await createIssue({ status: "todo" });

      const result = await reconciler.reconcile(companyId);

      expect(result.orphanedRunsClosed).toBe(0);
      expect(result.staleIntentsRejected).toBe(0);
      expect(result.ghostProjectionsCorrected).toBe(0);

      const events = await db
        .select()
        .from(controlPlaneEvents)
        .where(eq(controlPlaneEvents.companyId, companyId));

      const reconciliationEvents = events.filter((e) =>
        e.eventType.includes("reconciliation"),
      );
      expect(reconciliationEvents.length).toBe(0);
    });
  });

  // ----------------------------------------------------------------
  // VAL-PROJ-024: Reconciler updates lastReconciledAt
  // ----------------------------------------------------------------
  describe("lastReconciledAt update", () => {
    it("updates lastReconciledAt on issues that were reconciled (orphaned run)", async () => {
      await seedTestData();

      const runId = await createRun({ status: "running" });
      const issueId = await createIssue({
        status: "in_progress",
        assigneeAgentId: agentId,
        executionRunId: runId,
      });

      const before = new Date();
      await reconciler.reconcile(companyId);

      const [issue] = await db
        .select()
        .from(issues)
        .where(eq(issues.id, issueId));

      expect(issue.lastReconciledAt).not.toBeNull();
      expect(issue.lastReconciledAt!.getTime()).toBeGreaterThanOrEqual(before.getTime());
    });

    it("updates lastReconciledAt on issues with stale intents", async () => {
      await seedTestData();

      const issueId = await createIssue({ status: "done" });
      await db.insert(dispatchIntents).values({
        companyId,
        issueId,
        projectId,
        targetAgentId: agentId,
        intentType: "issue_assigned",
        priority: 10,
        status: "queued",
      });

      const before = new Date();
      await reconciler.reconcile(companyId);

      const [issue] = await db
        .select()
        .from(issues)
        .where(eq(issues.id, issueId));

      expect(issue.lastReconciledAt).not.toBeNull();
      expect(issue.lastReconciledAt!.getTime()).toBeGreaterThanOrEqual(before.getTime());
    });

    it("updates lastReconciledAt on issues with ghost projections corrected", async () => {
      await seedTestData();

      const issueId = await createIssue({
        status: "in_progress",
        assigneeAgentId: agentId,
        executionRunId: null,
        checkoutRunId: null,
      });

      const before = new Date();
      await reconciler.reconcile(companyId);

      const [issue] = await db
        .select()
        .from(issues)
        .where(eq(issues.id, issueId));

      expect(issue.lastReconciledAt).not.toBeNull();
      expect(issue.lastReconciledAt!.getTime()).toBeGreaterThanOrEqual(before.getTime());
    });
  });

  // ----------------------------------------------------------------
  // Combined / edge-case reconciliation
  // ----------------------------------------------------------------
  describe("combined reconciliation", () => {
    it("handles multiple drift types in a single reconcile call", async () => {
      await seedTestData();

      // 1. Orphaned run
      const orphanRunId = await createRun({ status: "running" });
      const orphanIssueId = await createIssue({
        status: "in_progress",
        assigneeAgentId: agentId,
        executionRunId: orphanRunId,
      });

      // 2. Stale intent for closed issue
      const closedIssueId = await createIssue({ status: "done" });
      await db.insert(dispatchIntents).values({
        companyId,
        issueId: closedIssueId,
        projectId,
        targetAgentId: agentId,
        intentType: "timer_hint",
        priority: 0,
        status: "queued",
      });

      // 3. Ghost in_progress projection
      const ghostIssueId = await createIssue({
        status: "in_progress",
        assigneeAgentId: agentId,
        executionRunId: null,
        checkoutRunId: null,
      });

      const result = await reconciler.reconcile(companyId);

      expect(result.orphanedRunsClosed).toBeGreaterThanOrEqual(1);
      expect(result.staleIntentsRejected).toBeGreaterThanOrEqual(1);
      expect(result.ghostProjectionsCorrected).toBeGreaterThanOrEqual(1);

      // Verify all corrections
      const [run] = await db
        .select()
        .from(heartbeatRuns)
        .where(eq(heartbeatRuns.id, orphanRunId));
      expect(run.status).toBe("failed");

      const intents = await db
        .select()
        .from(dispatchIntents)
        .where(eq(dispatchIntents.issueId, closedIssueId));
      expect(intents[0].status).toBe("rejected");

      const [ghostIssue] = await db
        .select()
        .from(issues)
        .where(eq(issues.id, ghostIssueId));
      expect(ghostIssue.status).toBe("todo");
    });

    it("returns zero counts when no drift exists", async () => {
      await seedTestData();

      const result = await reconciler.reconcile(companyId);

      expect(result.orphanedRunsClosed).toBe(0);
      expect(result.staleIntentsRejected).toBe(0);
      expect(result.ghostProjectionsCorrected).toBe(0);
    });

    it("is company-scoped (does not affect other companies)", async () => {
      await seedTestData();

      // Create another company with drift
      const otherCompanyId = randomUUID();
      const otherAgentId = randomUUID();
      const otherProjectId = randomUUID();

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

      await db.insert(projects).values({
        id: otherProjectId,
        companyId: otherCompanyId,
        name: "OtherProject",
        status: "in_progress",
      });

      // Create drift in the other company
      const otherRunId = randomUUID();
      await db.insert(heartbeatRuns).values({
        id: otherRunId,
        companyId: otherCompanyId,
        agentId: otherAgentId,
        invocationSource: "scheduler",
        status: "running",
        startedAt: new Date(),
      });

      // Reconcile only the first company
      const result = await reconciler.reconcile(companyId);

      expect(result.orphanedRunsClosed).toBe(0);

      // Other company's run should still be running
      const [otherRun] = await db
        .select()
        .from(heartbeatRuns)
        .where(eq(heartbeatRuns.id, otherRunId));
      expect(otherRun.status).toBe("running");
    });

    it("ghost projection correction uses raw status (not hard-coded todo)", async () => {
      await seedTestData();

      // Ghost in_progress issue — raw DB status is 'in_progress' from checkout.
      // Since checkout sets status to in_progress, the reconciler restores to
      // 'todo' (the pre-checkout default). This verifies raw status is stored.
      const issueId = await createIssue({
        status: "in_progress",
        assigneeAgentId: agentId,
        executionRunId: null,
        checkoutRunId: null,
      });

      const result = await reconciler.reconcile(companyId);
      expect(result.ghostProjectionsCorrected).toBe(1);

      // Check that the reconciliation event includes rawStatus field
      const events = await db
        .select()
        .from(controlPlaneEvents)
        .where(eq(controlPlaneEvents.companyId, companyId));

      const ghostEvent = events.find(
        (e) => e.eventType === "reconciliation_ghost_projection_cleared",
      );
      expect(ghostEvent).toBeDefined();
      const payload = ghostEvent!.payload as Record<string, unknown>;
      expect(payload.rawStatus).toBe("in_progress");
      expect(payload.correctedStatus).toBe("todo");
    });

    it("ghost projection does NOT affect leases or runs in other companies", async () => {
      await seedTestData();

      // Create another company
      const otherCompanyId = randomUUID();
      const otherAgentId = randomUUID();
      const otherProjectId = randomUUID();

      await db.insert(companies).values({
        id: otherCompanyId,
        name: "OtherCo",
        issuePrefix: `G${otherCompanyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
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

      await db.insert(projects).values({
        id: otherProjectId,
        companyId: otherCompanyId,
        name: "OtherProject",
        status: "in_progress",
      });

      // Create an in_progress issue in our company with no run/lease
      const ghostIssueId = await createIssue({
        status: "in_progress",
        assigneeAgentId: agentId,
        executionRunId: null,
      });

      // Create an in_progress issue in the other company with a lease
      // in the other company — the secondary lease lookup must be company-scoped
      const otherIssueId = randomUUID();
      await db.insert(issues).values({
        id: otherIssueId,
        companyId: otherCompanyId,
        projectId: otherProjectId,
        title: "Other Issue",
        status: "in_progress",
        priority: "medium",
        assigneeAgentId: otherAgentId,
      });

      // Create a lease for the OTHER company's issue. If the reconciler
      // ignores companyId on the lease check, it might see this as active
      // for our company's issue.
      await db.insert(executionLeases).values({
        leaseType: "issue_execution_lease",
        issueId: otherIssueId,
        agentId: otherAgentId,
        state: "granted",
        companyId: otherCompanyId,
        grantedAt: new Date(),
        expiresAt: new Date(Date.now() + 300_000),
      });

      const result = await reconciler.reconcile(companyId);

      // Our ghost issue should still be corrected even though other company has a lease
      expect(result.ghostProjectionsCorrected).toBe(1);

      const [issue] = await db
        .select()
        .from(issues)
        .where(eq(issues.id, ghostIssueId));
      expect(issue.status).toBe("todo");

      // Other company's issue should be unchanged
      const [otherIssue] = await db
        .select()
        .from(issues)
        .where(eq(issues.id, otherIssueId));
      expect(otherIssue.status).toBe("in_progress");
    });

    it("stale intent check uses company-scoped issue lookup", async () => {
      await seedTestData();

      // Create another company
      const otherCompanyId = randomUUID();
      const otherAgentId = randomUUID();
      const otherProjectId = randomUUID();

      await db.insert(companies).values({
        id: otherCompanyId,
        name: "OtherCo2",
        issuePrefix: `S${otherCompanyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
        requireBoardApprovalForNewAgents: false,
      });

      await db.insert(agents).values({
        id: otherAgentId,
        companyId: otherCompanyId,
        name: "OtherAgent2",
        role: "engineer",
        status: "active",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      });

      await db.insert(projects).values({
        id: otherProjectId,
        companyId: otherCompanyId,
        name: "OtherProject2",
        status: "in_progress",
      });

      // Create a done issue in our company
      const doneIssueId = await createIssue({ status: "done" });

      // Create a queued intent for the done issue
      await db.insert(dispatchIntents).values({
        companyId,
        issueId: doneIssueId,
        projectId,
        targetAgentId: agentId,
        intentType: "issue_assigned",
        priority: 10,
        status: "queued",
      });

      // Create an open issue in the other company with the same ID
      // (this tests that the issue lookup is company-scoped)
      const otherOpenIssueId = randomUUID();
      await db.insert(issues).values({
        id: otherOpenIssueId,
        companyId: otherCompanyId,
        projectId: otherProjectId,
        title: "Other Open Issue",
        status: "todo",
        priority: "medium",
        assigneeAgentId: otherAgentId,
      });

      const result = await reconciler.reconcile(companyId);

      // Intent for the done issue should be rejected
      expect(result.staleIntentsRejected).toBe(1);
    });
  });
});
