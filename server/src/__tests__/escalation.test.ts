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
import { escalationService } from "../services/escalation.js";
import { eq, sql } from "drizzle-orm";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeDB = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres escalation tests: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeDB("escalation service", () => {
  let db!: ReturnType<typeof createDb>;
  let escalation!: ReturnType<typeof escalationService>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  // Shared test data
  let companyId: string;
  let agentId: string;
  let managerId: string;
  let projectId: string;
  let issueId: string;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("escalation-");
    db = createDb(tempDb.connectionString);
    escalation = escalationService(db);
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

  /** Helper: seed company + manager + agent + project + issue */
  async function seedTestData(opts?: {
    managerReportsTo?: string | null;
    pickupFailCount?: number;
    lastPickupFailureAt?: Date | null;
  }) {
    companyId = randomUUID();
    managerId = randomUUID();
    agentId = randomUUID();
    projectId = randomUUID();
    issueId = randomUUID();

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
      reportsTo: opts?.managerReportsTo ?? null,
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

    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Test Issue",
      status: "todo",
      priority: "medium",
      projectId,
      assigneeAgentId: agentId,
      pickupFailCount: opts?.pickupFailCount ?? 0,
      lastPickupFailureAt: opts?.lastPickupFailureAt ?? null,
    });
  }

  // ─── VAL-REL-001: pickupFailCount incremented on timeout ───────────────────
  // (Already implemented in stale-run-reaper — verify via escalation integration)

  describe("VAL-REL-001: pickupFailCount incremented on timeout", () => {
    it("incrementPickupFailure increments pickupFailCount and sets lastPickupFailureAt", async () => {
      await seedTestData();

      const result = await escalation.incrementPickupFailure(issueId);

      const [issue] = await db
        .select({
          pickupFailCount: issues.pickupFailCount,
          lastPickupFailureAt: issues.lastPickupFailureAt,
        })
        .from(issues)
        .where(eq(issues.id, issueId));

      expect(issue.pickupFailCount).toBe(1);
      expect(issue.lastPickupFailureAt).toBeInstanceOf(Date);
    });

    it("increments cumulatively", async () => {
      await seedTestData({ pickupFailCount: 3 });

      await escalation.incrementPickupFailure(issueId);

      const [issue] = await db
        .select({ pickupFailCount: issues.pickupFailCount })
        .from(issues)
        .where(eq(issues.id, issueId));

      expect(issue.pickupFailCount).toBe(4);
    });
  });

  // ─── VAL-REL-002: lastPickupFailureAt updated on timeout ──────────────────

  describe("VAL-REL-002: lastPickupFailureAt updated on timeout", () => {
    it("updates lastPickupFailureAt to current time", async () => {
      await seedTestData();

      const before = new Date();
      await escalation.incrementPickupFailure(issueId);

      const [issue] = await db
        .select({ lastPickupFailureAt: issues.lastPickupFailureAt })
        .from(issues)
        .where(eq(issues.id, issueId));

      expect(issue.lastPickupFailureAt).toBeInstanceOf(Date);
      expect(issue.lastPickupFailureAt!.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
    });
  });

  // ─── VAL-REL-003: Auto-escalation on 2 failed pickups in 15 min ──────────

  describe("VAL-REL-003: Auto-escalation on 2 failed pickups in 15 minutes", () => {
    it("creates escalation when pickupFailCount reaches 2 within 15 minutes", async () => {
      const recentFailure = new Date(Date.now() - 5 * 60 * 1000); // 5 min ago
      await seedTestData({ pickupFailCount: 2, lastPickupFailureAt: recentFailure });

      const result = await escalation.checkAndEscalatePickupFailures(issueId);

      expect(result.escalated).toBe(true);

      // Verify auto_escalation_created event emitted
      const events = await db
        .select()
        .from(controlPlaneEvents)
        .where(eq(controlPlaneEvents.eventType, "auto_escalation_created"));
      expect(events.length).toBe(1);
      expect((events[0].payload as Record<string, unknown>).reason).toContain("pickup");
      expect((events[0].payload as Record<string, unknown>).targetManagerId).toBe(managerId);
    });

    it("creates a comment on the issue describing the escalation", async () => {
      const recentFailure = new Date(Date.now() - 5 * 60 * 1000);
      await seedTestData({ pickupFailCount: 2, lastPickupFailureAt: recentFailure });

      await escalation.checkAndEscalatePickupFailures(issueId);

      const comments = await db
        .select()
        .from(issueComments)
        .where(eq(issueComments.issueId, issueId));
      expect(comments.length).toBe(1);
      expect(comments[0].body).toContain("pickup");
      expect(comments[0].body).toContain("escalat");
    });

    it("does NOT escalate when pickupFailCount < 2", async () => {
      await seedTestData({ pickupFailCount: 1, lastPickupFailureAt: new Date() });

      const result = await escalation.checkAndEscalatePickupFailures(issueId);

      expect(result.escalated).toBe(false);

      const events = await db
        .select()
        .from(controlPlaneEvents)
        .where(eq(controlPlaneEvents.eventType, "auto_escalation_created"));
      expect(events.length).toBe(0);
    });

    it("does NOT escalate when failures are older than 15 minutes", async () => {
      const oldFailure = new Date(Date.now() - 20 * 60 * 1000); // 20 min ago
      await seedTestData({ pickupFailCount: 3, lastPickupFailureAt: oldFailure });

      const result = await escalation.checkAndEscalatePickupFailures(issueId);

      expect(result.escalated).toBe(false);
    });

    it("targets the agent's manager from chain of command", async () => {
      const recentFailure = new Date(Date.now() - 5 * 60 * 1000);
      await seedTestData({ pickupFailCount: 2, lastPickupFailureAt: recentFailure });

      const result = await escalation.checkAndEscalatePickupFailures(issueId);

      expect(result.escalated).toBe(true);

      const events = await db
        .select()
        .from(controlPlaneEvents)
        .where(eq(controlPlaneEvents.eventType, "auto_escalation_created"));
      expect((events[0].payload as Record<string, unknown>).targetManagerId).toBe(managerId);
    });

    it("still escalates (with system comment) even if agent has no manager", async () => {
      await seedTestData({ pickupFailCount: 2, lastPickupFailureAt: new Date() });

      // Remove agent's manager reference
      await db
        .update(agents)
        .set({ reportsTo: null })
        .where(eq(agents.id, agentId));

      const result = await escalation.checkAndEscalatePickupFailures(issueId);

      // Still escalates — creates comment as system notification
      expect(result.escalated).toBe(true);

      const comments = await db
        .select()
        .from(issueComments)
        .where(eq(issueComments.issueId, issueId));
      expect(comments.length).toBe(1);
    });
  });

  // ─── VAL-REL-004: Auto-escalation on workspace binding failure ────────────

  describe("VAL-REL-004: Auto-escalation on workspace binding failure", () => {
    it("creates escalation event when workspace binding fails", async () => {
      await seedTestData();

      const result = await escalation.escalateWorkspaceBindingFailure({
        companyId,
        issueId,
        agentId,
        runId: randomUUID(),
        reason: "No workspace found for project",
      });

      expect(result.escalated).toBe(true);

      // Verify auto_escalation_created event emitted
      const events = await db
        .select()
        .from(controlPlaneEvents)
        .where(eq(controlPlaneEvents.eventType, "auto_escalation_created"));
      expect(events.length).toBe(1);
      expect((events[0].payload as Record<string, unknown>).reason).toContain("workspace");
    });

    it("creates a comment on the issue about workspace failure", async () => {
      await seedTestData();

      await escalation.escalateWorkspaceBindingFailure({
        companyId,
        issueId,
        agentId,
        runId: randomUUID(),
        reason: "No workspace found for project",
      });

      const comments = await db
        .select()
        .from(issueComments)
        .where(eq(issueComments.issueId, issueId));
      expect(comments.length).toBe(1);
      expect(comments[0].body).toContain("workspace");
    });

    it("targets the agent's manager", async () => {
      await seedTestData();

      await escalation.escalateWorkspaceBindingFailure({
        companyId,
        issueId,
        agentId,
        runId: randomUUID(),
        reason: "No workspace found for project",
      });

      const events = await db
        .select()
        .from(controlPlaneEvents)
        .where(eq(controlPlaneEvents.eventType, "auto_escalation_created"));
      expect((events[0].payload as Record<string, unknown>).targetManagerId).toBe(managerId);
    });
  });

  // ─── VAL-REL-005: Auto-escalation on silent run completion ────────────────

  describe("VAL-REL-005: Auto-escalation on silent run completion", () => {
    it("creates escalation when run completes after checkout with no activity", async () => {
      await seedTestData();

      const runId = randomUUID();
      await db.insert(heartbeatRuns).values({
        id: runId,
        companyId,
        agentId,
        invocationSource: "scheduler",
        status: "running",
      });

      // Set checkout on issue
      await db
        .update(issues)
        .set({
          checkoutRunId: runId,
          executionRunId: runId,
        })
        .where(eq(issues.id, issueId));

      const result = await escalation.escalateSilentRunCompletion({
        companyId,
        issueId,
        agentId,
        runId,
      });

      expect(result.escalated).toBe(true);

      // Verify auto_escalation_created event emitted
      const events = await db
        .select()
        .from(controlPlaneEvents)
        .where(eq(controlPlaneEvents.eventType, "auto_escalation_created"));
      expect(events.length).toBe(1);
      expect((events[0].payload as Record<string, unknown>).reason).toContain("silent");
    });

    it("creates a comment on the issue about silent completion", async () => {
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
          checkoutRunId: runId,
          executionRunId: runId,
        })
        .where(eq(issues.id, issueId));

      await escalation.escalateSilentRunCompletion({
        companyId,
        issueId,
        agentId,
        runId,
      });

      const comments = await db
        .select()
        .from(issueComments)
        .where(eq(issueComments.issueId, issueId));
      expect(comments.length).toBe(1);
      expect(comments[0].body).toContain("completed without");
    });

    it("targets the agent's manager for silent completion escalation", async () => {
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
          checkoutRunId: runId,
          executionRunId: runId,
        })
        .where(eq(issues.id, issueId));

      await escalation.escalateSilentRunCompletion({
        companyId,
        issueId,
        agentId,
        runId,
      });

      const events = await db
        .select()
        .from(controlPlaneEvents)
        .where(eq(controlPlaneEvents.eventType, "auto_escalation_created"));
      expect((events[0].payload as Record<string, unknown>).targetManagerId).toBe(managerId);
    });
  });

  // ─── auto_escalation_created event ────────────────────────────────────────

  describe("auto_escalation_created event emitted", () => {
    it("emits event with correct entity type and payload for pickup failure", async () => {
      const recentFailure = new Date(Date.now() - 5 * 60 * 1000);
      await seedTestData({ pickupFailCount: 2, lastPickupFailureAt: recentFailure });

      await escalation.checkAndEscalatePickupFailures(issueId);

      const events = await db
        .select()
        .from(controlPlaneEvents)
        .where(eq(controlPlaneEvents.eventType, "auto_escalation_created"));

      expect(events.length).toBe(1);
      const event = events[0];
      expect(event.entityType).toBe("issue");
      expect(event.entityId).toBe(issueId);
      expect(event.companyId).toBe(companyId);
      const payload = event.payload as Record<string, unknown>;
      expect(payload.escalationType).toBe("pickup_failure");
      expect(payload.agentId).toBe(agentId);
      expect(payload.issueId).toBe(issueId);
    });

    it("emits event with correct payload for workspace binding failure", async () => {
      await seedTestData();
      const runId = randomUUID();

      await escalation.escalateWorkspaceBindingFailure({
        companyId,
        issueId,
        agentId,
        runId,
        reason: "No workspace found",
      });

      const events = await db
        .select()
        .from(controlPlaneEvents)
        .where(eq(controlPlaneEvents.eventType, "auto_escalation_created"));

      expect(events.length).toBe(1);
      const payload = events[0].payload as Record<string, unknown>;
      expect(payload.escalationType).toBe("workspace_binding_failure");
      expect(payload.runId).toBe(runId);
    });

    it("emits event with correct payload for silent run completion", async () => {
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
        .set({ checkoutRunId: runId, executionRunId: runId })
        .where(eq(issues.id, issueId));

      await escalation.escalateSilentRunCompletion({
        companyId,
        issueId,
        agentId,
        runId,
      });

      const events = await db
        .select()
        .from(controlPlaneEvents)
        .where(eq(controlPlaneEvents.eventType, "auto_escalation_created"));

      expect(events.length).toBe(1);
      const payload = events[0].payload as Record<string, unknown>;
      expect(payload.escalationType).toBe("silent_run_completion");
      expect(payload.runId).toBe(runId);
    });
  });
});
