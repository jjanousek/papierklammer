import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  agents,
  companies,
  createDb,
  dispatchIntents,
  executionLeases,
  heartbeatRuns,
  issues,
  projectWorkspaces,
  projects,
} from "@papierklammer/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import {
  intentQueueService,
  INTENT_PRIORITY_MAP,
  getIntentPriority,
  INTENT_TYPES,
} from "../services/intent-queue.js";
import { schedulerService } from "../services/scheduler.js";
import { eq, sql, asc } from "drizzle-orm";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeDB = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres event-driven-wake tests: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeDB("event-driven wake model", () => {
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
    tempDb = await startEmbeddedPostgresTestDatabase("event-wake-");
    db = createDb(tempDb.connectionString);
    scheduler = schedulerService(db);
    intentQueue = intentQueueService(db);
  }, 30_000);

  afterEach(async () => {
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
    pickupFailCount?: number;
    agentRuntimeConfig?: Record<string, unknown>;
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
      status: "active",
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
      status: overrides?.issueStatus ?? "todo",
      priority: "medium",
      projectId,
      assigneeAgentId: agentId,
      pickupFailCount: overrides?.pickupFailCount ?? 0,
    });
  }

  // ─── Priority levels for intent types ─────────────────────────────────────

  describe("INTENT_PRIORITY_MAP", () => {
    it("defines correct priority for each intent type", () => {
      expect(INTENT_PRIORITY_MAP.manager_escalation).toBe(50);
      expect(INTENT_PRIORITY_MAP.issue_assigned).toBe(40);
      expect(INTENT_PRIORITY_MAP.issue_comment_mentioned).toBe(30);
      expect(INTENT_PRIORITY_MAP.dependency_unblocked).toBe(30);
      expect(INTENT_PRIORITY_MAP.approval_resolved).toBe(30);
      expect(INTENT_PRIORITY_MAP.retry_after_failure).toBe(20);
      expect(INTENT_PRIORITY_MAP.timer_hint).toBe(0);
    });

    it("timer_hint has the lowest priority of all intent types", () => {
      const timerPriority = INTENT_PRIORITY_MAP.timer_hint;
      for (const intentType of INTENT_TYPES) {
        expect(INTENT_PRIORITY_MAP[intentType]).toBeGreaterThanOrEqual(timerPriority);
      }
      // And at least one is strictly greater
      expect(INTENT_PRIORITY_MAP.issue_assigned).toBeGreaterThan(timerPriority);
    });

    it("getIntentPriority returns correct priority for known types", () => {
      expect(getIntentPriority("manager_escalation")).toBe(50);
      expect(getIntentPriority("timer_hint")).toBe(0);
    });

    it("getIntentPriority returns 0 for unknown types", () => {
      expect(getIntentPriority("unknown_type")).toBe(0);
    });
  });

  // ─── Intent creation auto-assigns priority from type ──────────────────────

  describe("intent creation auto-assigns priority from type", () => {
    it("auto-assigns priority=40 for issue_assigned when no explicit priority", async () => {
      await seedTestData();
      const intent = await intentQueue.createIntent({
        companyId,
        issueId,
        projectId,
        targetAgentId: agentId,
        intentType: "issue_assigned",
        workspaceId,
      });
      expect(intent.priority).toBe(40);
    });

    it("auto-assigns priority=0 for timer_hint when no explicit priority", async () => {
      await seedTestData();
      const intent = await intentQueue.createIntent({
        companyId,
        issueId,
        projectId,
        targetAgentId: agentId,
        intentType: "timer_hint",
        workspaceId,
      });
      expect(intent.priority).toBe(0);
    });

    it("auto-assigns priority=50 for manager_escalation when no explicit priority", async () => {
      await seedTestData();
      const intent = await intentQueue.createIntent({
        companyId,
        issueId,
        projectId,
        targetAgentId: agentId,
        intentType: "manager_escalation",
        workspaceId,
      });
      expect(intent.priority).toBe(50);
    });

    it("allows explicit priority override", async () => {
      await seedTestData();
      const intent = await intentQueue.createIntent({
        companyId,
        issueId,
        projectId,
        targetAgentId: agentId,
        intentType: "timer_hint",
        priority: 99,
        workspaceId,
      });
      expect(intent.priority).toBe(99);
    });
  });

  // ─── VAL-THRU-006: Timer hints have lowest priority ──────────────────────

  describe("VAL-THRU-006: Timer hints have lowest priority", () => {
    it("scheduler processes event-driven intents before timer hints", async () => {
      await seedTestData({
        agentRuntimeConfig: { heartbeat: { maxConcurrentRuns: 5 } },
      });

      // Create a second issue for the second intent
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

      // Create timer_hint first (lower priority)
      const timerHint = await intentQueue.createIntent({
        companyId,
        issueId: issueId2,
        projectId,
        targetAgentId: agentId,
        intentType: "timer_hint",
        workspaceId,
      });

      // Small delay so createdAt differs
      await new Promise((r) => setTimeout(r, 10));

      // Create issue_assigned second (higher priority)
      const issueAssigned = await intentQueue.createIntent({
        companyId,
        issueId,
        projectId,
        targetAgentId: agentId,
        intentType: "issue_assigned",
        workspaceId,
      });

      // Process all queued intents
      const result = await scheduler.processQueuedIntents(companyId);

      expect(result.admitted).toBe(2);

      // Both should be admitted
      const timerIntent = await intentQueue.getIntent(timerHint.id);
      expect(timerIntent!.status).toBe("admitted");
      const assignedIntent = await intentQueue.getIntent(issueAssigned.id);
      expect(assignedIntent!.status).toBe("admitted");

      // The issue_assigned run should have been created first
      // (processed in priority order: 40 > 0)
      const runs = await db.select().from(heartbeatRuns).orderBy(asc(heartbeatRuns.createdAt));
      expect(runs.length).toBe(2);
      expect(runs[0].intentId).toBe(issueAssigned.id);
      expect(runs[1].intentId).toBe(timerHint.id);
    });

    it("creates mixed intents with correct default priorities", async () => {
      await seedTestData();

      // Create intents of different types without explicit priority
      const timerIntent = await intentQueue.createIntent({
        companyId,
        issueId,
        projectId,
        targetAgentId: agentId,
        intentType: "timer_hint",
        workspaceId,
        dedupeKey: "key-timer",
      });
      const assignedIntent = await intentQueue.createIntent({
        companyId,
        issueId,
        projectId,
        targetAgentId: agentId,
        intentType: "issue_assigned",
        workspaceId,
        dedupeKey: "key-assigned",
      });
      const escalationIntent = await intentQueue.createIntent({
        companyId,
        issueId,
        projectId,
        targetAgentId: agentId,
        intentType: "manager_escalation",
        workspaceId,
        dedupeKey: "key-escalation",
      });

      expect(timerIntent.priority).toBe(0);
      expect(assignedIntent.priority).toBe(40);
      expect(escalationIntent.priority).toBe(50);

      // Query queued intents — should be in priority order
      const queued = await intentQueue.findQueuedIntents({ companyId });
      expect(queued.length).toBe(3);
      // Sorted by priority desc: escalation(50), assigned(40), timer(0)
      expect(queued[0].intentType).toBe("manager_escalation");
      expect(queued[1].intentType).toBe("issue_assigned");
      expect(queued[2].intentType).toBe("timer_hint");
    });
  });

  // ─── VAL-THRU-007: Timer hints dropped when better intent exists ─────────

  describe("VAL-THRU-007: Timer hints dropped when better intent exists", () => {
    it("timer_hint is superseded when a higher-priority intent exists for same issue", async () => {
      await seedTestData();

      // First, create a high-priority issue_assigned intent
      const highPriority = await intentQueue.createIntent({
        companyId,
        issueId,
        projectId,
        targetAgentId: agentId,
        intentType: "issue_assigned",
        workspaceId,
        dedupeKey: `issue:${issueId}`,
      });

      expect(highPriority.status).toBe("queued");

      // Now create a timer_hint with the same dedupeKey — it should be auto-superseded
      const timerHint = await intentQueue.createIntent({
        companyId,
        issueId,
        projectId,
        targetAgentId: agentId,
        intentType: "timer_hint",
        workspaceId,
        dedupeKey: `issue:${issueId}`,
      });

      // Timer hint should be immediately superseded
      expect(timerHint.status).toBe("superseded");

      // High-priority intent should still be queued
      const highIntent = await intentQueue.getIntent(highPriority.id);
      expect(highIntent!.status).toBe("queued");
    });

    it("timer_hint is NOT superseded when no higher-priority intent exists", async () => {
      await seedTestData();

      // Create a timer_hint with a unique dedupeKey — no higher-priority exists
      const timerHint = await intentQueue.createIntent({
        companyId,
        issueId,
        projectId,
        targetAgentId: agentId,
        intentType: "timer_hint",
        workspaceId,
        dedupeKey: `issue:${issueId}`,
      });

      expect(timerHint.status).toBe("queued");
    });

    it("higher-priority intent supersedes existing timer_hint via standard dedup", async () => {
      await seedTestData();

      // First, create a timer_hint
      const timerHint = await intentQueue.createIntent({
        companyId,
        issueId,
        projectId,
        targetAgentId: agentId,
        intentType: "timer_hint",
        workspaceId,
        dedupeKey: `issue:${issueId}`,
      });

      expect(timerHint.status).toBe("queued");

      // Now create an issue_assigned with the same dedupeKey — the timer_hint
      // gets superseded by the standard dedup mechanism
      const assigned = await intentQueue.createIntent({
        companyId,
        issueId,
        projectId,
        targetAgentId: agentId,
        intentType: "issue_assigned",
        workspaceId,
        dedupeKey: `issue:${issueId}`,
      });

      expect(assigned.status).toBe("queued");

      // The original timer_hint should now be superseded
      const updatedTimer = await intentQueue.getIntent(timerHint.id);
      expect(updatedTimer!.status).toBe("superseded");
    });
  });

  // ─── VAL-THRU-008: Timer hints disabled for agents with repeated failures ─

  describe("VAL-THRU-008: Timer hints disabled for agents with repeated failures", () => {
    it("rejects timer_hint when issue pickupFailCount >= 5", async () => {
      await seedTestData({ pickupFailCount: 5 });

      const intent = await intentQueue.createIntent({
        companyId,
        issueId,
        projectId,
        targetAgentId: agentId,
        intentType: "timer_hint",
        workspaceId,
      });

      const result = await scheduler.processIntent(intent.id);

      expect(result.admitted).toBe(false);
      expect(result.reason).toContain("timer_hint disabled");
      expect(result.reason).toContain("pickupFailCount");

      // Intent should be rejected
      const updated = await intentQueue.getIntent(intent.id);
      expect(updated!.status).toBe("rejected");
    });

    it("rejects timer_hint when issue pickupFailCount exceeds threshold (e.g. 10)", async () => {
      await seedTestData({ pickupFailCount: 10 });

      const intent = await intentQueue.createIntent({
        companyId,
        issueId,
        projectId,
        targetAgentId: agentId,
        intentType: "timer_hint",
        workspaceId,
      });

      const result = await scheduler.processIntent(intent.id);

      expect(result.admitted).toBe(false);
      expect(result.reason).toContain("timer_hint disabled");
    });

    it("still admits timer_hint when issue pickupFailCount is below threshold", async () => {
      await seedTestData({ pickupFailCount: 4 });

      const intent = await intentQueue.createIntent({
        companyId,
        issueId,
        projectId,
        targetAgentId: agentId,
        intentType: "timer_hint",
        workspaceId,
      });

      const result = await scheduler.processIntent(intent.id);

      expect(result.admitted).toBe(true);
    });

    it("still admits non-timer_hint intents even when pickupFailCount is high", async () => {
      await seedTestData({ pickupFailCount: 10 });

      const intent = await intentQueue.createIntent({
        companyId,
        issueId,
        projectId,
        targetAgentId: agentId,
        intentType: "issue_assigned",
        workspaceId,
      });

      const result = await scheduler.processIntent(intent.id);

      expect(result.admitted).toBe(true);
    });

    it("rejects timer_hint in batch processing when pickupFailCount >= threshold", async () => {
      await seedTestData({ pickupFailCount: 6 });

      await intentQueue.createIntent({
        companyId,
        issueId,
        projectId,
        targetAgentId: agentId,
        intentType: "timer_hint",
        workspaceId,
      });

      const result = await scheduler.processQueuedIntents(companyId);

      expect(result.total).toBe(1);
      expect(result.rejected).toBe(1);
      expect(result.admitted).toBe(0);
    });
  });

  // ─── Priority ordering in batch processing ────────────────────────────────

  describe("priority ordering in batch processing", () => {
    it("processes manager_escalation before issue_assigned before timer_hint", async () => {
      await seedTestData({
        agentRuntimeConfig: { heartbeat: { maxConcurrentRuns: 10 } },
      });

      // Create 3 issues for 3 intents
      const issueId2 = randomUUID();
      const issueId3 = randomUUID();
      await db.insert(issues).values([
        {
          id: issueId2,
          companyId,
          title: "Issue 2",
          status: "todo",
          priority: "medium",
          projectId,
          assigneeAgentId: agentId,
        },
        {
          id: issueId3,
          companyId,
          title: "Issue 3",
          status: "todo",
          priority: "medium",
          projectId,
          assigneeAgentId: agentId,
        },
      ]);

      // Create intents in reverse priority order
      const timer = await intentQueue.createIntent({
        companyId,
        issueId: issueId3,
        projectId,
        targetAgentId: agentId,
        intentType: "timer_hint",
        workspaceId,
      });

      await new Promise((r) => setTimeout(r, 10));

      const assigned = await intentQueue.createIntent({
        companyId,
        issueId: issueId2,
        projectId,
        targetAgentId: agentId,
        intentType: "issue_assigned",
        workspaceId,
      });

      await new Promise((r) => setTimeout(r, 10));

      const escalation = await intentQueue.createIntent({
        companyId,
        issueId,
        projectId,
        targetAgentId: agentId,
        intentType: "manager_escalation",
        workspaceId,
      });

      const result = await scheduler.processQueuedIntents(companyId);
      expect(result.admitted).toBe(3);

      // Verify processing order by checking run creation order
      const runs = await db.select().from(heartbeatRuns).orderBy(asc(heartbeatRuns.createdAt));
      expect(runs.length).toBe(3);
      expect(runs[0].intentId).toBe(escalation.id); // priority 50 first
      expect(runs[1].intentId).toBe(assigned.id);   // priority 40 second
      expect(runs[2].intentId).toBe(timer.id);       // priority 0 last
    });
  });
});
