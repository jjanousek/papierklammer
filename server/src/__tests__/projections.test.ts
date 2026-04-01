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
  projectWorkspaces,
} from "@papierklammer/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { projectionService } from "../services/projections.js";
import { intentQueueService } from "../services/intent-queue.js";
import { leaseManagerService } from "../services/lease-manager.js";
import { eq, sql } from "drizzle-orm";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeDB = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres projection tests: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeDB("projectionService", () => {
  let db!: ReturnType<typeof createDb>;
  let projection!: ReturnType<typeof projectionService>;
  let intentQueue!: ReturnType<typeof intentQueueService>;
  let leaseMgr!: ReturnType<typeof leaseManagerService>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  // Shared test data IDs
  let companyId: string;
  let agentId: string;
  let projectId: string;
  let issueId: string;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("projections-");
    db = createDb(tempDb.connectionString);
    projection = projectionService(db);
    intentQueue = intentQueueService(db);
    leaseMgr = leaseManagerService(db);
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

  /** Helper: seed company + agent + project + issue */
  async function seedTestData(overrides?: { issueStatus?: string }) {
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
      status: "in_progress",
    });

    await db.insert(issues).values({
      id: issueId,
      companyId,
      projectId,
      title: "Test Issue",
      status: overrides?.issueStatus ?? "todo",
      priority: "medium",
    });
  }

  // ----------------------------------------------------------------
  // VAL-PROJ-010: Issue with active run+checkout projects to in_progress
  // ----------------------------------------------------------------
  describe("projectIssueStatus (pure function)", () => {
    it("returns in_progress when issue has active run with checkout", () => {
      const issue = {
        id: "issue-1",
        status: "todo",
        pickupFailCount: 0,
        lastReconciledAt: null,
      } as any;

      const activeRun = {
        id: "run-1",
        status: "running",
      } as any;

      const activeLease = {
        id: "lease-1",
        state: "granted",
      } as any;

      const checkoutRunId = "run-1";

      const result = projection.projectIssueStatus(
        issue,
        activeRun,
        activeLease,
        checkoutRunId,
      );
      expect(result.projectedStatus).toBe("in_progress");
      expect(result.activeRunId).toBe("run-1");
      expect(result.activeLeaseId).toBe("lease-1");
    });

    // VAL-PROJ-011: Issue with cancelled run stays at raw status
    it("returns raw status when run is cancelled without checkout", () => {
      const issue = {
        id: "issue-1",
        status: "todo",
        pickupFailCount: 0,
        lastReconciledAt: null,
      } as any;

      const cancelledRun = {
        id: "run-1",
        status: "cancelled",
      } as any;

      const result = projection.projectIssueStatus(
        issue,
        cancelledRun,
        null,
        null,
      );
      expect(result.projectedStatus).toBe("todo");
      expect(result.activeRunId).toBeNull();
      expect(result.activeLeaseId).toBeNull();
    });

    it("returns done when issue status is done", () => {
      const issue = {
        id: "issue-1",
        status: "done",
        pickupFailCount: 0,
        lastReconciledAt: null,
      } as any;

      const result = projection.projectIssueStatus(issue, null, null, null);
      expect(result.projectedStatus).toBe("done");
    });

    it("returns raw status when no active run or lease", () => {
      const issue = {
        id: "issue-1",
        status: "backlog",
        pickupFailCount: 2,
        lastReconciledAt: new Date("2025-01-01"),
      } as any;

      const result = projection.projectIssueStatus(issue, null, null, null);
      expect(result.projectedStatus).toBe("backlog");
      expect(result.pickupFailCount).toBe(2);
      expect(result.lastReconciledAt).toEqual(new Date("2025-01-01"));
    });

    it("returns raw status when run is running but no checkout", () => {
      const issue = {
        id: "issue-1",
        status: "todo",
        pickupFailCount: 0,
        lastReconciledAt: null,
      } as any;

      const activeRun = {
        id: "run-1",
        status: "running",
      } as any;

      const activeLease = {
        id: "lease-1",
        state: "granted",
      } as any;

      // No checkoutRunId — run exists but hasn't checked out yet
      const result = projection.projectIssueStatus(
        issue,
        activeRun,
        activeLease,
        null,
      );
      // Still show raw status since checkout hasn't happened
      expect(result.projectedStatus).toBe("todo");
      // But metadata should show active run/lease
      expect(result.activeRunId).toBe("run-1");
      expect(result.activeLeaseId).toBe("lease-1");
    });
  });

  // ----------------------------------------------------------------
  // VAL-PROJ-010: getIssueProjection with active run+checkout
  // ----------------------------------------------------------------
  describe("getIssueProjection", () => {
    it("returns projected in_progress when issue has active run with checkout", async () => {
      await seedTestData();

      // Create a running heartbeat run
      const runId = randomUUID();
      await db.insert(heartbeatRuns).values({
        id: runId,
        companyId,
        agentId,
        invocationSource: "scheduler",
        status: "running",
        startedAt: new Date(),
      });

      // Link run to issue and set checkout
      await db
        .update(issues)
        .set({
          executionRunId: runId,
          checkoutRunId: runId,
          status: "in_progress",
          assigneeAgentId: agentId,
        })
        .where(eq(issues.id, issueId));

      // Create an active lease
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

      const proj = await projection.getIssueProjection(issueId);

      expect(proj).not.toBeNull();
      expect(proj!.projectedStatus).toBe("in_progress");
      expect(proj!.activeRunId).toBe(runId);
      expect(proj!.activeLeaseId).toBeDefined();
      expect(proj!.pickupFailCount).toBe(0);
    });

    // VAL-PROJ-011: Cancelled run → stays at raw status
    it("returns raw status when run is cancelled without checkout", async () => {
      await seedTestData();

      // Create a cancelled run
      const runId = randomUUID();
      await db.insert(heartbeatRuns).values({
        id: runId,
        companyId,
        agentId,
        invocationSource: "scheduler",
        status: "cancelled",
        startedAt: new Date(),
        finishedAt: new Date(),
      });

      // Link run to issue but no checkout
      await db
        .update(issues)
        .set({
          executionRunId: runId,
          assigneeAgentId: agentId,
        })
        .where(eq(issues.id, issueId));

      const proj = await projection.getIssueProjection(issueId);

      expect(proj).not.toBeNull();
      expect(proj!.projectedStatus).toBe("todo");
      expect(proj!.activeRunId).toBeNull();
    });

    // VAL-PROJ-013: Projection includes metadata
    it("includes metadata fields (activeRunId, activeLeaseId, pickupFailCount, lastReconciledAt)", async () => {
      await seedTestData();

      // Set some metadata on the issue
      const reconciledAt = new Date("2025-06-01T12:00:00Z");
      await db
        .update(issues)
        .set({
          pickupFailCount: 3,
          lastReconciledAt: reconciledAt,
        })
        .where(eq(issues.id, issueId));

      const proj = await projection.getIssueProjection(issueId);

      expect(proj).not.toBeNull();
      expect(proj!.pickupFailCount).toBe(3);
      expect(proj!.lastReconciledAt).toEqual(reconciledAt);
      expect(proj!.activeRunId).toBeNull();
      expect(proj!.activeLeaseId).toBeNull();
    });

    it("returns null for non-existent issue", async () => {
      await seedTestData();
      const proj = await projection.getIssueProjection(randomUUID());
      expect(proj).toBeNull();
    });
  });

  // ----------------------------------------------------------------
  // VAL-PROJ-012: Issue done → intents rejected, leases released
  // ----------------------------------------------------------------
  describe("invalidateOnDone", () => {
    it("rejects all queued intents and releases all active leases when issue goes to done", async () => {
      await seedTestData();

      // Create some queued intents for the issue
      const intent1 = await intentQueue.createIntent({
        companyId,
        issueId,
        projectId,
        targetAgentId: agentId,
        intentType: "issue_assigned",
        priority: 10,
      });

      const intent2 = await intentQueue.createIntent({
        companyId,
        issueId,
        projectId,
        targetAgentId: agentId,
        intentType: "timer_hint",
        priority: 0,
      });

      // Create an active lease
      const lease = await leaseMgr.grantLease({
        leaseType: "issue_execution_lease",
        issueId,
        agentId,
        companyId,
        ttlSeconds: 300,
      });

      // Invalidate on done
      const result = await projection.invalidateOnDone(issueId, companyId);

      expect(result.rejectedIntents).toBeGreaterThanOrEqual(1);
      expect(result.releasedLeases).toBe(1);

      // Verify intents are rejected
      const updatedIntent1 = await intentQueue.getIntent(intent1.id);
      expect(updatedIntent1!.status).toBe("rejected");

      // Verify lease is released
      const updatedLease = await leaseMgr.getActiveLease(issueId);
      expect(updatedLease).toBeNull();
    });

    it("handles case with no intents or leases gracefully", async () => {
      await seedTestData();

      const result = await projection.invalidateOnDone(issueId, companyId);

      expect(result.rejectedIntents).toBe(0);
      expect(result.releasedLeases).toBe(0);
    });
  });

  // ----------------------------------------------------------------
  // projectIssuesList — batch projection for issue lists
  // ----------------------------------------------------------------
  describe("projectIssuesList", () => {
    it("enriches a list of issues with projection metadata", async () => {
      await seedTestData();

      // Create a running run with checkout for the issue
      const runId = randomUUID();
      await db.insert(heartbeatRuns).values({
        id: runId,
        companyId,
        agentId,
        invocationSource: "scheduler",
        status: "running",
        startedAt: new Date(),
      });

      await db
        .update(issues)
        .set({
          executionRunId: runId,
          checkoutRunId: runId,
          status: "in_progress",
          assigneeAgentId: agentId,
        })
        .where(eq(issues.id, issueId));

      // Create active lease
      const leaseId = randomUUID();
      await db.insert(executionLeases).values({
        id: leaseId,
        leaseType: "issue_execution_lease",
        issueId,
        agentId,
        runId,
        state: "granted",
        companyId,
        grantedAt: new Date(),
        expiresAt: new Date(Date.now() + 300_000),
      });

      // Get the issues from DB
      const issueRows = await db.select().from(issues).where(eq(issues.companyId, companyId));

      const projected = await projection.projectIssuesList(issueRows);

      expect(projected).toHaveLength(1);
      expect(projected[0].projectedStatus).toBe("in_progress");
      expect(projected[0].activeRunId).toBe(runId);
      expect(projected[0].activeLeaseId).toBe(leaseId);
    });

    it("handles empty list", async () => {
      const projected = await projection.projectIssuesList([]);
      expect(projected).toHaveLength(0);
    });

    it("handles issues with no runs or leases", async () => {
      await seedTestData();
      const issueRows = await db.select().from(issues).where(eq(issues.companyId, companyId));
      const projected = await projection.projectIssuesList(issueRows);
      expect(projected).toHaveLength(1);
      expect(projected[0].projectedStatus).toBe("todo");
      expect(projected[0].activeRunId).toBeNull();
      expect(projected[0].activeLeaseId).toBeNull();
    });
  });
});
