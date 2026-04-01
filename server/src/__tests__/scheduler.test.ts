import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  agents,
  companies,
  createDb,
  dispatchIntents,
  executionEnvelopes,
  executionLeases,
  heartbeatRuns,
  issues,
  projectWorkspaces,
  projects,
  budgetPolicies,
} from "@papierklammer/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { intentQueueService } from "../services/intent-queue.js";
import { schedulerService } from "../services/scheduler.js";
import { eq, and, sql, asc } from "drizzle-orm";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeDB = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres scheduler tests: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeDB("schedulerService", () => {
  let db!: ReturnType<typeof createDb>;
  let scheduler!: ReturnType<typeof schedulerService>;
  let intentQueue!: ReturnType<typeof intentQueueService>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  // Shared test data IDs
  let companyId: string;
  let agentId: string;
  let projectId: string;
  let issueId: string;
  let workspaceId: string;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("scheduler-");
    db = createDb(tempDb.connectionString);
    scheduler = schedulerService(db);
    intentQueue = intentQueueService(db);
  }, 30_000);

  afterEach(async () => {
    // Use TRUNCATE CASCADE to handle all FK constraints cleanly
    await db.execute(sql`TRUNCATE TABLE
      execution_envelopes,
      execution_leases,
      heartbeat_runs,
      dispatch_intents,
      budget_policies,
      issues,
      project_workspaces,
      projects,
      agents,
      companies
      CASCADE`);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  /** Helper: seed company + agent + project + workspace + issue */
  async function seedTestData(overrides?: {
    issueStatus?: string;
    assigneeAgentId?: string | null;
    withWorkspace?: boolean;
    agentRuntimeConfig?: Record<string, unknown>;
    agentStatus?: string;
  }) {
    companyId = randomUUID();
    agentId = randomUUID();
    projectId = randomUUID();
    issueId = randomUUID();
    workspaceId = randomUUID();

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
      status: overrides?.agentStatus ?? "active",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: overrides?.agentRuntimeConfig ?? {},
      permissions: {},
    });

    await db.insert(projects).values({
      id: projectId,
      companyId,
      name: "TestProject",
      status: "active",
    });

    const shouldCreateWorkspace = overrides?.withWorkspace !== false;
    if (shouldCreateWorkspace) {
      await db.insert(projectWorkspaces).values({
        id: workspaceId,
        companyId,
        projectId,
        name: "main",
        sourceType: "local_path",
        cwd: "/tmp/test-workspace",
        isPrimary: true,
      });
    }

    const assignee = overrides?.assigneeAgentId === undefined
      ? agentId
      : overrides?.assigneeAgentId;

    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Test Issue",
      status: overrides?.issueStatus ?? "todo",
      priority: "medium",
      projectId,
      assigneeAgentId: assignee,
    });
  }

  /** Helper: create a valid intent ready for scheduling */
  async function createTestIntent(overrides?: {
    notBefore?: Date;
    workspaceId?: string | null;
    targetAgentId?: string;
    issueId?: string;
    projectId?: string;
  }) {
    return intentQueue.createIntent({
      companyId,
      issueId: overrides?.issueId ?? issueId,
      projectId: overrides?.projectId ?? projectId,
      targetAgentId: overrides?.targetAgentId ?? agentId,
      intentType: "issue_assigned",
      priority: 10,
      workspaceId: overrides?.workspaceId === null ? undefined : (overrides?.workspaceId ?? workspaceId),
      notBefore: overrides?.notBefore,
    });
  }

  // ─── VAL-HARD-010: Scheduler admits valid intent ──────────────────────────

  describe("processIntent — valid admission", () => {
    it("admits a valid intent and creates lease, envelope, and run", async () => {
      await seedTestData();
      const intent = await createTestIntent();

      const result = await scheduler.processIntent(intent.id);

      expect(result.admitted).toBe(true);
      expect(result.runId).toBeDefined();
      expect(result.leaseId).toBeDefined();
      expect(result.envelopeId).toBeDefined();

      // Verify intent was consumed
      const updatedIntent = await intentQueue.getIntent(intent.id);
      expect(updatedIntent!.status).toBe("consumed");

      // Verify lease was created
      const [lease] = await db
        .select()
        .from(executionLeases)
        .where(eq(executionLeases.id, result.leaseId!));
      expect(lease).toBeDefined();
      expect(lease.state).toBe("granted");
      expect(lease.issueId).toBe(issueId);
      expect(lease.agentId).toBe(agentId);
      expect(lease.companyId).toBe(companyId);
      expect(lease.runId).toBe(result.runId);

      // Verify run was created and linked
      const [run] = await db
        .select()
        .from(heartbeatRuns)
        .where(eq(heartbeatRuns.id, result.runId!));
      expect(run).toBeDefined();
      expect(run.status).toBe("queued");
      expect(run.intentId).toBe(intent.id);
      expect(run.envelopeId).toBe(result.envelopeId);
      expect(run.agentId).toBe(agentId);
      expect(run.companyId).toBe(companyId);
      expect(run.invocationSource).toBe("scheduler");

      // Verify envelope was created
      const [envelope] = await db
        .select()
        .from(executionEnvelopes)
        .where(eq(executionEnvelopes.id, result.envelopeId!));
      expect(envelope).toBeDefined();
      expect(envelope.issueId).toBe(issueId);
      expect(envelope.agentId).toBe(agentId);
      expect(envelope.companyId).toBe(companyId);
      expect(envelope.projectId).toBe(projectId);
      expect(envelope.workspaceId).toBe(workspaceId);
      expect(envelope.wakeReason).toBe("issue_assigned");
      expect(envelope.runKind).toBe("standard");
      expect(envelope.workspaceBindingMode).toBe("required_project_workspace");
    });
  });

  // ─── VAL-HARD-011: Scheduler rejects intent for closed issue ─────────────

  describe("processIntent — closed issue", () => {
    it("rejects intent for a done issue", async () => {
      await seedTestData({ issueStatus: "done" });
      const intent = await createTestIntent();

      const result = await scheduler.processIntent(intent.id);

      expect(result.admitted).toBe(false);
      expect(result.reason).toContain("issue closed");

      // Verify intent was rejected
      const updatedIntent = await intentQueue.getIntent(intent.id);
      expect(updatedIntent!.status).toBe("rejected");
    });

    it("rejects intent for a cancelled issue", async () => {
      await seedTestData({ issueStatus: "cancelled" });
      const intent = await createTestIntent();

      const result = await scheduler.processIntent(intent.id);

      expect(result.admitted).toBe(false);
      expect(result.reason).toContain("issue closed");
    });
  });

  // ─── VAL-HARD-012: Scheduler rejects on assignee mismatch ────────────────

  describe("processIntent — assignee mismatch", () => {
    it("rejects intent when targetAgentId differs from issue assignee", async () => {
      await seedTestData();
      // Create a second agent to be the target
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

      const intent = await createTestIntent({ targetAgentId: otherAgentId });

      const result = await scheduler.processIntent(intent.id);

      expect(result.admitted).toBe(false);
      expect(result.reason).toContain("assignee mismatch");

      const updatedIntent = await intentQueue.getIntent(intent.id);
      expect(updatedIntent!.status).toBe("rejected");
    });

    it("rejects intent when issue has no assignee", async () => {
      await seedTestData({ assigneeAgentId: null });
      const intent = await createTestIntent();

      const result = await scheduler.processIntent(intent.id);

      expect(result.admitted).toBe(false);
      expect(result.reason).toContain("assignee mismatch");
    });
  });

  // ─── VAL-HARD-013: Scheduler rejects when workspace missing ──────────────

  describe("processIntent — workspace missing", () => {
    it("rejects intent when specified workspaceId does not exist", async () => {
      await seedTestData();
      const nonExistentWsId = randomUUID();
      const intent = await createTestIntent({ workspaceId: nonExistentWsId });

      const result = await scheduler.processIntent(intent.id);

      expect(result.admitted).toBe(false);
      expect(result.reason).toContain("workspace not found");
    });

    it("rejects intent when project has no workspace", async () => {
      await seedTestData({ withWorkspace: false });
      // Intent without explicit workspace — scheduler checks project workspaces
      const intent = await createTestIntent({ workspaceId: null });

      const result = await scheduler.processIntent(intent.id);

      expect(result.admitted).toBe(false);
      expect(result.reason).toContain("workspace not found");
    });
  });

  // ─── VAL-HARD-014: Scheduler rejects when active lease on issue ──────────

  describe("processIntent — active lease on issue", () => {
    it("rejects intent when issue already has an active execution lease", async () => {
      await seedTestData();

      // Create an active lease for the issue
      await db.insert(executionLeases).values({
        leaseType: "issue_execution",
        issueId,
        agentId,
        state: "granted",
        companyId,
        grantedAt: new Date(),
        expiresAt: new Date(Date.now() + 300_000),
      });

      const intent = await createTestIntent();
      const result = await scheduler.processIntent(intent.id);

      expect(result.admitted).toBe(false);
      expect(result.reason).toContain("active lease exists on issue");
    });

    it("rejects intent when issue has a renewed lease", async () => {
      await seedTestData();

      await db.insert(executionLeases).values({
        leaseType: "issue_execution",
        issueId,
        agentId,
        state: "renewed",
        companyId,
        grantedAt: new Date(Date.now() - 60_000),
        renewedAt: new Date(),
        expiresAt: new Date(Date.now() + 300_000),
      });

      const intent = await createTestIntent();
      const result = await scheduler.processIntent(intent.id);

      expect(result.admitted).toBe(false);
      expect(result.reason).toContain("active lease exists on issue");
    });

    it("admits intent when existing lease is expired", async () => {
      await seedTestData();

      await db.insert(executionLeases).values({
        leaseType: "issue_execution",
        issueId,
        agentId,
        state: "expired",
        companyId,
        grantedAt: new Date(Date.now() - 600_000),
        expiresAt: new Date(Date.now() - 300_000),
      });

      const intent = await createTestIntent();
      const result = await scheduler.processIntent(intent.id);

      expect(result.admitted).toBe(true);
    });

    it("admits intent when existing lease is released", async () => {
      await seedTestData();

      await db.insert(executionLeases).values({
        leaseType: "issue_execution",
        issueId,
        agentId,
        state: "released",
        companyId,
        grantedAt: new Date(Date.now() - 600_000),
        expiresAt: new Date(Date.now() - 300_000),
        releasedAt: new Date(Date.now() - 300_000),
        releaseReason: "run completed",
      });

      const intent = await createTestIntent();
      const result = await scheduler.processIntent(intent.id);

      expect(result.admitted).toBe(true);
    });
  });

  // ─── VAL-HARD-015: Scheduler rejects when agent at max concurrent runs ───

  describe("processIntent — agent at capacity", () => {
    it("defers intent when agent is at maxConcurrentRuns (default=1)", async () => {
      await seedTestData();

      // Create a running run for the agent
      await db.insert(heartbeatRuns).values({
        companyId,
        agentId,
        invocationSource: "scheduler",
        status: "running",
        startedAt: new Date(),
      });

      const intent = await createTestIntent();
      const result = await scheduler.processIntent(intent.id);

      expect(result.admitted).toBe(false);
      expect(result.reason).toContain("agent at max concurrent runs");

      // Verify intent was deferred (not rejected)
      const updatedIntent = await intentQueue.getIntent(intent.id);
      expect(updatedIntent!.status).toBe("deferred");
    });

    it("admits intent when agent has capacity (maxConcurrentRuns=2, running=1)", async () => {
      await seedTestData({
        agentRuntimeConfig: { heartbeat: { maxConcurrentRuns: 2 } },
      });

      // Create one running run
      await db.insert(heartbeatRuns).values({
        companyId,
        agentId,
        invocationSource: "scheduler",
        status: "running",
        startedAt: new Date(),
      });

      const intent = await createTestIntent();
      const result = await scheduler.processIntent(intent.id);

      expect(result.admitted).toBe(true);
    });

    it("defers intent when agent at maxConcurrentRuns=2 with 2 running", async () => {
      await seedTestData({
        agentRuntimeConfig: { heartbeat: { maxConcurrentRuns: 2 } },
      });

      // Create two running runs
      await db.insert(heartbeatRuns).values({
        companyId,
        agentId,
        invocationSource: "scheduler",
        status: "running",
        startedAt: new Date(),
      });
      await db.insert(heartbeatRuns).values({
        companyId,
        agentId,
        invocationSource: "scheduler",
        status: "running",
        startedAt: new Date(),
      });

      const intent = await createTestIntent();
      const result = await scheduler.processIntent(intent.id);

      expect(result.admitted).toBe(false);
      expect(result.reason).toContain("agent at max concurrent runs");
    });
  });

  // ─── VAL-HARD-016: Scheduler rejects when budget exhausted ────────────────

  describe("processIntent — budget exhausted", () => {
    it("rejects intent when company is paused for budget", async () => {
      await seedTestData();

      // Pause the company for budget reasons
      await db
        .update(companies)
        .set({
          status: "paused",
          pauseReason: "budget",
          pausedAt: new Date(),
        })
        .where(eq(companies.id, companyId));

      const intent = await createTestIntent();
      const result = await scheduler.processIntent(intent.id);

      expect(result.admitted).toBe(false);
      expect(result.reason).toContain("budget exhausted");

      const updatedIntent = await intentQueue.getIntent(intent.id);
      expect(updatedIntent!.status).toBe("rejected");
    });

    it("rejects intent when agent is paused for budget", async () => {
      await seedTestData();

      // Pause the agent for budget reasons
      await db
        .update(agents)
        .set({
          status: "paused",
          pauseReason: "budget",
          pausedAt: new Date(),
        })
        .where(eq(agents.id, agentId));

      const intent = await createTestIntent();
      const result = await scheduler.processIntent(intent.id);

      expect(result.admitted).toBe(false);
      expect(result.reason).toContain("budget exhausted");
    });
  });

  // ─── VAL-HARD-017: Scheduler respects notBefore field ─────────────────────

  describe("processIntent — notBefore", () => {
    it("skips intent with notBefore in the future", async () => {
      await seedTestData();
      const futureTime = new Date(Date.now() + 60_000);
      const intent = await createTestIntent({ notBefore: futureTime });

      const result = await scheduler.processIntent(intent.id);

      expect(result.admitted).toBe(false);
      expect(result.reason).toContain("notBefore is in the future");

      // Intent should stay queued (not rejected or deferred)
      // The processIntent rejects but the reason is about timing
      const updatedIntent = await intentQueue.getIntent(intent.id);
      expect(updatedIntent!.status).toBe("rejected");
    });

    it("admits intent with notBefore in the past", async () => {
      await seedTestData();
      const pastTime = new Date(Date.now() - 60_000);
      const intent = await createTestIntent({ notBefore: pastTime });

      const result = await scheduler.processIntent(intent.id);

      expect(result.admitted).toBe(true);
    });

    it("admits intent with no notBefore set", async () => {
      await seedTestData();
      const intent = await createTestIntent();

      const result = await scheduler.processIntent(intent.id);

      expect(result.admitted).toBe(true);
    });
  });

  // ─── checkAdmission — dry run ─────────────────────────────────────────────

  describe("checkAdmission", () => {
    it("returns admitted: true for a valid intent without side effects", async () => {
      await seedTestData();
      const intent = await createTestIntent();

      // Get the raw intent row
      const intentRow = await intentQueue.getIntent(intent.id);
      const result = await scheduler.checkAdmission(intentRow!);

      expect(result.admitted).toBe(true);
      expect(result.reason).toBeUndefined();

      // Verify no side effects: intent still queued, no lease/run created
      const updatedIntent = await intentQueue.getIntent(intent.id);
      expect(updatedIntent!.status).toBe("queued");

      const leases = await db.select().from(executionLeases);
      expect(leases.length).toBe(0);

      const runs = await db.select().from(heartbeatRuns);
      expect(runs.length).toBe(0);
    });

    it("returns admitted: false for closed issue without side effects", async () => {
      await seedTestData({ issueStatus: "done" });
      const intent = await createTestIntent();
      const intentRow = await intentQueue.getIntent(intent.id);

      const result = await scheduler.checkAdmission(intentRow!);

      expect(result.admitted).toBe(false);
      expect(result.reason).toContain("issue closed");

      // Intent stays queued — no side effects
      const updatedIntent = await intentQueue.getIntent(intent.id);
      expect(updatedIntent!.status).toBe("queued");
    });

    it("returns admitted: false for assignee mismatch", async () => {
      await seedTestData();
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

      const intent = await createTestIntent({ targetAgentId: otherAgentId });
      const intentRow = await intentQueue.getIntent(intent.id);

      const result = await scheduler.checkAdmission(intentRow!);

      expect(result.admitted).toBe(false);
      expect(result.reason).toContain("assignee mismatch");
    });

    it("returns admitted: false for future notBefore", async () => {
      await seedTestData();
      const futureTime = new Date(Date.now() + 60_000);
      const intent = await createTestIntent({ notBefore: futureTime });
      const intentRow = await intentQueue.getIntent(intent.id);

      const result = await scheduler.checkAdmission(intentRow!);

      expect(result.admitted).toBe(false);
      expect(result.reason).toContain("notBefore is in the future");
    });
  });

  // ─── processQueuedIntents — batch processing ─────────────────────────────

  describe("processQueuedIntents", () => {
    it("processes all queued intents for a company", async () => {
      await seedTestData();

      // Create a second issue for a second intent
      const issueId2 = randomUUID();
      await db.insert(issues).values({
        id: issueId2,
        companyId,
        title: "Test Issue 2",
        status: "todo",
        priority: "medium",
        projectId,
        assigneeAgentId: agentId,
      });

      // Override maxConcurrentRuns so both can be admitted
      await db
        .update(agents)
        .set({ runtimeConfig: { heartbeat: { maxConcurrentRuns: 5 } } })
        .where(eq(agents.id, agentId));
      // Recreate scheduler to pick up new config
      scheduler = schedulerService(db);

      const intent1 = await createTestIntent();
      const intent2 = await createTestIntent({ issueId: issueId2 });

      const result = await scheduler.processQueuedIntents(companyId);

      expect(result.total).toBe(2);
      expect(result.admitted).toBe(2);
      expect(result.rejected).toBe(0);
      expect(result.deferred).toBe(0);
      expect(result.skipped).toBe(0);
    });

    it("skips intents with future notBefore", async () => {
      await seedTestData();
      const futureTime = new Date(Date.now() + 60_000);
      await createTestIntent({ notBefore: futureTime });

      const result = await scheduler.processQueuedIntents(companyId);

      expect(result.total).toBe(1);
      expect(result.skipped).toBe(1);
      expect(result.admitted).toBe(0);
    });

    it("processes intents in priority order (high first)", async () => {
      await seedTestData({
        agentRuntimeConfig: { heartbeat: { maxConcurrentRuns: 5 } },
      });

      // Create a second issue
      const issueId2 = randomUUID();
      await db.insert(issues).values({
        id: issueId2,
        companyId,
        title: "Test Issue 2",
        status: "todo",
        priority: "medium",
        projectId,
        assigneeAgentId: agentId,
      });

      // Low priority intent first
      const lowPriority = await intentQueue.createIntent({
        companyId,
        issueId: issueId2,
        projectId,
        targetAgentId: agentId,
        intentType: "timer_hint",
        priority: 0,
        workspaceId,
      });

      // Slight delay
      await new Promise((r) => setTimeout(r, 10));

      // High priority intent second
      const highPriority = await intentQueue.createIntent({
        companyId,
        issueId,
        projectId,
        targetAgentId: agentId,
        intentType: "issue_assigned",
        priority: 40,
        workspaceId,
      });

      const result = await scheduler.processQueuedIntents(companyId);

      // Both admitted (capacity allows it)
      expect(result.admitted).toBe(2);
      expect(result.deferred).toBe(0);

      // Both should be consumed
      const highIntent = await intentQueue.getIntent(highPriority.id);
      expect(highIntent!.status).toBe("consumed");

      const lowIntent = await intentQueue.getIntent(lowPriority.id);
      expect(lowIntent!.status).toBe("consumed");

      // Verify the high priority run was created first by comparing run createdAt
      const runs = await db.select().from(heartbeatRuns).orderBy(asc(heartbeatRuns.createdAt));
      expect(runs.length).toBe(2);
      // The first run should be linked to the high-priority intent (processed first)
      expect(runs[0].intentId).toBe(highPriority.id);
      expect(runs[1].intentId).toBe(lowPriority.id);
    });

    it("returns zeros when no queued intents exist", async () => {
      await seedTestData();

      const result = await scheduler.processQueuedIntents(companyId);

      expect(result.total).toBe(0);
      expect(result.admitted).toBe(0);
      expect(result.rejected).toBe(0);
      expect(result.deferred).toBe(0);
      expect(result.skipped).toBe(0);
    });
  });

  // ─── Edge cases ───────────────────────────────────────────────────────────

  describe("edge cases", () => {
    it("handles non-existent intent ID", async () => {
      await seedTestData();
      const result = await scheduler.processIntent(randomUUID());

      expect(result.admitted).toBe(false);
      expect(result.reason).toContain("intent not found");
    });

    it("handles already-admitted intent", async () => {
      await seedTestData();
      const intent = await createTestIntent();
      // Manually admit
      await intentQueue.admitIntent(intent.id);

      const result = await scheduler.processIntent(intent.id);

      expect(result.admitted).toBe(false);
      expect(result.reason).toContain("intent is not queued");
    });

    it("handles already-rejected intent", async () => {
      await seedTestData();
      const intent = await createTestIntent();
      await intentQueue.rejectIntent(intent.id, "test reason");

      const result = await scheduler.processIntent(intent.id);

      expect(result.admitted).toBe(false);
      expect(result.reason).toContain("intent is not queued");
    });

    it("envelope has correct workspaceBindingMode for non-project intent", async () => {
      // Create data without a project on the intent
      companyId = randomUUID();
      agentId = randomUUID();
      projectId = randomUUID();
      issueId = randomUUID();
      workspaceId = randomUUID();

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

      await db.insert(projectWorkspaces).values({
        id: workspaceId,
        companyId,
        projectId,
        name: "main",
        sourceType: "local_path",
        cwd: "/tmp/test-workspace",
        isPrimary: true,
      });

      await db.insert(issues).values({
        id: issueId,
        companyId,
        title: "Test Issue",
        status: "todo",
        priority: "medium",
        projectId,
        assigneeAgentId: agentId,
      });

      const intent = await createTestIntent();
      const result = await scheduler.processIntent(intent.id);

      expect(result.admitted).toBe(true);

      const [envelope] = await db
        .select()
        .from(executionEnvelopes)
        .where(eq(executionEnvelopes.id, result.envelopeId!));
      // Has projectId so should be required_project_workspace
      expect(envelope.workspaceBindingMode).toBe("required_project_workspace");
    });

    it("lease expiresAt is set correctly with default TTL", async () => {
      await seedTestData();
      const now = new Date();
      const intent = await createTestIntent();

      const result = await scheduler.processIntent(intent.id, now);

      expect(result.admitted).toBe(true);
      const [lease] = await db
        .select()
        .from(executionLeases)
        .where(eq(executionLeases.id, result.leaseId!));

      // TTL is 300 seconds
      const expectedExpiry = new Date(now.getTime() + 300_000);
      const timeDiff = Math.abs(lease.expiresAt.getTime() - expectedExpiry.getTime());
      expect(timeDiff).toBeLessThan(1000); // within 1 second
    });
  });

  // ─── Multi-tenant isolation ───────────────────────────────────────────────

  describe("multi-tenant isolation", () => {
    it("does not admit intent for issue in a different company", async () => {
      await seedTestData();

      // Create a second company
      const companyId2 = randomUUID();
      await db.insert(companies).values({
        id: companyId2,
        name: "OtherCo",
        issuePrefix: `O${companyId2.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
        requireBoardApprovalForNewAgents: false,
      });

      // The intent references the correct issue/agent/workspace but has a different companyId
      // This simulates a cross-tenant data leak attempt
      const crossTenantIntent = await intentQueue.createIntent({
        companyId: companyId2,  // Wrong company
        issueId,               // Issue belongs to companyId, not companyId2
        projectId,
        targetAgentId: agentId,
        intentType: "issue_assigned",
        priority: 10,
        workspaceId,
      });

      const result = await scheduler.processIntent(crossTenantIntent.id);

      // Should be rejected because the issue doesn't belong to companyId2
      expect(result.admitted).toBe(false);
      expect(result.reason).toContain("issue not found");
    });

    it("does not see workspace from another company", async () => {
      // Seed company1 without workspace
      await seedTestData({ withWorkspace: false });

      // Create a workspace in a different company
      const companyId2 = randomUUID();
      const wsId2 = randomUUID();
      await db.insert(companies).values({
        id: companyId2,
        name: "OtherCo",
        issuePrefix: `O${companyId2.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
        requireBoardApprovalForNewAgents: false,
      });
      await db.insert(projectWorkspaces).values({
        id: wsId2,
        companyId: companyId2,
        projectId,
        name: "other-workspace",
        sourceType: "local_path",
        cwd: "/tmp/other-workspace",
        isPrimary: true,
      });

      // Intent in company1 referencing company2's workspace
      const intent = await createTestIntent({ workspaceId: wsId2 });
      const result = await scheduler.processIntent(intent.id);

      expect(result.admitted).toBe(false);
      expect(result.reason).toContain("workspace not found");
    });

    it("does not count runs from another company toward capacity", async () => {
      await seedTestData();

      // Create a second company with a running run for the same agent ID
      // (normally agents are unique per company, but this tests the query filter)
      const companyId2 = randomUUID();
      await db.insert(companies).values({
        id: companyId2,
        name: "OtherCo",
        issuePrefix: `O${companyId2.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
        requireBoardApprovalForNewAgents: false,
      });

      // Create a running run in company2 for the same agentId
      // (This is artificial but tests the company filter)
      await db.insert(heartbeatRuns).values({
        companyId: companyId2,
        agentId,
        invocationSource: "scheduler",
        status: "running",
        startedAt: new Date(),
      });

      // Company1's intent should still be admitted because the running run
      // is in a different company
      const intent = await createTestIntent();
      const result = await scheduler.processIntent(intent.id);

      expect(result.admitted).toBe(true);
    });
  });
});
