import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  agents,
  companies,
  controlPlaneEvents,
  createDb,
  dispatchIntents,
  heartbeatRuns,
  issues,
  projects,
} from "@papierklammer/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { intentQueueService } from "../services/intent-queue.js";
import { and, eq } from "drizzle-orm";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeDB = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres intent-timer-integration tests: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeDB("intent-timer-integration", () => {
  let db!: ReturnType<typeof createDb>;
  let svc!: ReturnType<typeof intentQueueService>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  let companyId: string;
  let agentId: string;
  let projectId: string;
  let issueId: string;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("intent-timer-");
    db = createDb(tempDb.connectionString);
    svc = intentQueueService(db);
  }, 30_000);

  afterEach(async () => {
    await db.delete(controlPlaneEvents);
    await db.delete(dispatchIntents);
    await db.delete(heartbeatRuns);
    await db.delete(issues);
    await db.delete(projects);
    await db.delete(agents);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  /** Helper: seed company + agent + project + issue */
  async function seedTestData(opts?: {
    companyStatus?: "active" | "paused" | "archived";
    agentStatus?: string;
    heartbeatEnabled?: boolean;
    intervalSec?: number;
    issueStatus?: string;
    lastHeartbeatAt?: Date;
  }) {
    companyId = randomUUID();
    agentId = randomUUID();
    projectId = randomUUID();
    issueId = randomUUID();

    await db.insert(companies).values({
      id: companyId,
      name: "TestCo",
      status: opts?.companyStatus ?? "active",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });

    const heartbeatConfig = {
      heartbeat: {
        enabled: opts?.heartbeatEnabled ?? true,
        intervalSec: opts?.intervalSec ?? 60,
        wakeOnDemand: true,
        maxConcurrentRuns: 1,
      },
    };

    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "TestAgent",
      role: "engineer",
      status: opts?.agentStatus ?? "active",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: heartbeatConfig,
      permissions: {},
      lastHeartbeatAt: opts?.lastHeartbeatAt ?? new Date(Date.now() - 120_000), // 2 minutes ago by default
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
      status: opts?.issueStatus ?? "todo",
      priority: "medium",
      projectId,
      assigneeAgentId: agentId,
    });
  }

  // ─── VAL-HARD-007: Timer tick creates intents not runs ────────────────────

  describe("tickTimers creates timer_hint intents", () => {
    it("creates timer_hint dispatch_intent for each open assigned issue", async () => {
      await seedTestData({ intervalSec: 60, lastHeartbeatAt: new Date(Date.now() - 120_000) });

      // Import and call tickTimers — it should create intents, not runs
      const { tickTimers } = await import("../services/timer-intent-bridge.js");
      const result = await tickTimers(db, svc, new Date());

      expect(result.checked).toBeGreaterThanOrEqual(1);
      expect(result.intentsCreated).toBeGreaterThanOrEqual(1);

      // Verify a dispatch_intent was created with timer_hint type
      const intents = await db
        .select()
        .from(dispatchIntents)
        .where(
          and(
            eq(dispatchIntents.intentType, "timer_hint"),
            eq(dispatchIntents.issueId, issueId),
          ),
        );
      expect(intents.length).toBe(1);
      expect(intents[0].priority).toBe(0);
      expect(intents[0].targetAgentId).toBe(agentId);
      expect(intents[0].companyId).toBe(companyId);
      expect(intents[0].projectId).toBe(projectId);
      expect(intents[0].status).toBe("queued");

      // Verify NO heartbeat_run was created
      const runs = await db
        .select()
        .from(heartbeatRuns)
        .where(eq(heartbeatRuns.agentId, agentId));
      expect(runs.length).toBe(0);
    });

    it("skips agents with disabled heartbeat", async () => {
      await seedTestData({ heartbeatEnabled: false });

      const { tickTimers } = await import("../services/timer-intent-bridge.js");
      const result = await tickTimers(db, svc, new Date());

      const intents = await db
        .select()
        .from(dispatchIntents)
        .where(eq(dispatchIntents.targetAgentId, agentId));
      expect(intents.length).toBe(0);
    });

    it("skips agents whose interval has not elapsed", async () => {
      await seedTestData({
        intervalSec: 300,
        lastHeartbeatAt: new Date(), // just now
      });

      const { tickTimers } = await import("../services/timer-intent-bridge.js");
      const result = await tickTimers(db, svc, new Date());

      const intents = await db
        .select()
        .from(dispatchIntents)
        .where(eq(dispatchIntents.targetAgentId, agentId));
      expect(intents.length).toBe(0);
    });

    it("skips paused/terminated agents", async () => {
      await seedTestData({ agentStatus: "paused" });

      const { tickTimers } = await import("../services/timer-intent-bridge.js");
      const result = await tickTimers(db, svc, new Date());

      const intents = await db
        .select()
        .from(dispatchIntents)
        .where(eq(dispatchIntents.targetAgentId, agentId));
      expect(intents.length).toBe(0);
    });

    it("skips paused companies", async () => {
      await seedTestData({ companyStatus: "paused" });

      const { tickTimers } = await import("../services/timer-intent-bridge.js");
      await tickTimers(db, svc, new Date());

      const intents = await db
        .select()
        .from(dispatchIntents)
        .where(eq(dispatchIntents.targetAgentId, agentId));
      expect(intents.length).toBe(0);
    });

    it("skips archived companies", async () => {
      await seedTestData({ companyStatus: "archived" });

      const { tickTimers } = await import("../services/timer-intent-bridge.js");
      await tickTimers(db, svc, new Date());

      const intents = await db
        .select()
        .from(dispatchIntents)
        .where(eq(dispatchIntents.targetAgentId, agentId));
      expect(intents.length).toBe(0);
    });

    it("does not create intents for issues in backlog status", async () => {
      await seedTestData({ issueStatus: "backlog" });

      const { tickTimers } = await import("../services/timer-intent-bridge.js");
      const result = await tickTimers(db, svc, new Date());

      const intents = await db
        .select()
        .from(dispatchIntents)
        .where(eq(dispatchIntents.issueId, issueId));
      expect(intents.length).toBe(0);
    });

    it("does not create intents for closed issues (done/cancelled)", async () => {
      await seedTestData({ issueStatus: "done" });

      const { tickTimers } = await import("../services/timer-intent-bridge.js");
      const result = await tickTimers(db, svc, new Date());

      const intents = await db
        .select()
        .from(dispatchIntents)
        .where(eq(dispatchIntents.issueId, issueId));
      expect(intents.length).toBe(0);
    });

    it("uses dedupeKey 'issue:<issueId>' for deduplication", async () => {
      await seedTestData({ intervalSec: 60, lastHeartbeatAt: new Date(Date.now() - 120_000) });

      const { tickTimers } = await import("../services/timer-intent-bridge.js");
      await tickTimers(db, svc, new Date());

      const intents = await db
        .select()
        .from(dispatchIntents)
        .where(eq(dispatchIntents.issueId, issueId));
      expect(intents.length).toBe(1);
      expect(intents[0].dedupeKey).toBe(`issue:${issueId}`);
    });
  });

  // ─── VAL-HARD-008: Timer hints superseded by event-driven intents ─────────

  describe("timer_hint superseded by event-driven intents", () => {
    it("supersedes existing timer_hint when issue_assigned intent is created with same dedupeKey", async () => {
      await seedTestData();

      // Create a timer_hint intent first
      const timerHint = await svc.createIntent({
        companyId,
        issueId,
        projectId,
        targetAgentId: agentId,
        intentType: "timer_hint",
        priority: 0,
        dedupeKey: `issue:${issueId}`,
      });
      expect(timerHint.status).toBe("queued");

      // Create a higher-priority issue_assigned intent with same dedupeKey
      const assigned = await svc.createIntent({
        companyId,
        issueId,
        projectId,
        targetAgentId: agentId,
        intentType: "issue_assigned",
        priority: 40,
        dedupeKey: `issue:${issueId}`,
      });
      expect(assigned.status).toBe("queued");

      // Timer hint should now be superseded
      const timerHintRow = await svc.getIntent(timerHint.id);
      expect(timerHintRow!.status).toBe("superseded");
    });

    it("auto-supersedes timer_hint when higher-priority intent already exists", async () => {
      await seedTestData();

      // Create a higher-priority intent first
      await svc.createIntent({
        companyId,
        issueId,
        projectId,
        targetAgentId: agentId,
        intentType: "issue_assigned",
        priority: 40,
        dedupeKey: `issue:${issueId}`,
      });

      // Now create a timer_hint with the same dedupeKey — it should be auto-superseded
      const timerHint = await svc.createIntent({
        companyId,
        issueId,
        projectId,
        targetAgentId: agentId,
        intentType: "timer_hint",
        priority: 0,
        dedupeKey: `issue:${issueId}`,
      });

      // The timer_hint should be superseded because a higher-priority intent exists
      // (the dedup logic supersedes the old one; the higher-priority intent remains)
      // Actually, the existing dedup logic supersedes the *older* one.
      // Since the issue_assigned was created first, it gets superseded by the timer_hint.
      // This is wrong — we need to check priority and auto-supersede the lower-priority new intent.
      // This test verifies the *new* behavior where timer_hint is auto-superseded
      // when a higher-priority intent already exists.
      const timerHintRow = await svc.getIntent(timerHint.id);
      expect(timerHintRow!.status).toBe("superseded");
    });

    it("timer_hint priority is always 0 (lowest)", async () => {
      await seedTestData();

      const { tickTimers } = await import("../services/timer-intent-bridge.js");
      await tickTimers(db, svc, new Date());

      const intents = await db
        .select()
        .from(dispatchIntents)
        .where(
          and(
            eq(dispatchIntents.intentType, "timer_hint"),
            eq(dispatchIntents.issueId, issueId),
          ),
        );
      expect(intents.length).toBe(1);
      expect(intents[0].priority).toBe(0);
    });
  });

  // ─── Issue assignment creates issue_assigned intent ───────────────────────

  describe("queueIssueAssignmentWakeup creates issue_assigned intent", () => {
    it("creates issue_assigned dispatch_intent instead of calling heartbeat.wakeup()", async () => {
      await seedTestData();

      const { queueIssueAssignmentIntent } = await import(
        "../services/issue-assignment-wakeup.js"
      );

      await queueIssueAssignmentIntent({
        db,
        intentQueue: svc,
        issue: { id: issueId, assigneeAgentId: agentId, status: "todo", companyId, projectId },
        reason: "issue_assigned",
      });

      // Verify a dispatch_intent was created
      const intents = await db
        .select()
        .from(dispatchIntents)
        .where(
          and(
            eq(dispatchIntents.intentType, "issue_assigned"),
            eq(dispatchIntents.issueId, issueId),
          ),
        );
      expect(intents.length).toBe(1);
      expect(intents[0].targetAgentId).toBe(agentId);
      expect(intents[0].companyId).toBe(companyId);
      expect(intents[0].projectId).toBe(projectId);
      expect(intents[0].priority).toBeGreaterThanOrEqual(10);
      expect(intents[0].status).toBe("queued");
    });

    it("does not create intent when issue has no assignee", async () => {
      await seedTestData();

      const { queueIssueAssignmentIntent } = await import(
        "../services/issue-assignment-wakeup.js"
      );

      await queueIssueAssignmentIntent({
        db,
        intentQueue: svc,
        issue: { id: issueId, assigneeAgentId: null, status: "todo", companyId, projectId },
        reason: "issue_assigned",
      });

      const intents = await db
        .select()
        .from(dispatchIntents)
        .where(eq(dispatchIntents.issueId, issueId));
      expect(intents.length).toBe(0);
    });

    it("does not create intent for issues in backlog status", async () => {
      await seedTestData();

      const { queueIssueAssignmentIntent } = await import(
        "../services/issue-assignment-wakeup.js"
      );

      await queueIssueAssignmentIntent({
        db,
        intentQueue: svc,
        issue: { id: issueId, assigneeAgentId: agentId, status: "backlog", companyId, projectId },
        reason: "issue_assigned",
      });

      const intents = await db
        .select()
        .from(dispatchIntents)
        .where(eq(dispatchIntents.issueId, issueId));
      expect(intents.length).toBe(0);
    });

    it("uses dedupeKey 'issue:<issueId>'", async () => {
      await seedTestData();

      const { queueIssueAssignmentIntent } = await import(
        "../services/issue-assignment-wakeup.js"
      );

      await queueIssueAssignmentIntent({
        db,
        intentQueue: svc,
        issue: { id: issueId, assigneeAgentId: agentId, status: "todo", companyId, projectId },
        reason: "issue_assigned",
      });

      const intents = await db
        .select()
        .from(dispatchIntents)
        .where(eq(dispatchIntents.issueId, issueId));
      expect(intents.length).toBe(1);
      expect(intents[0].dedupeKey).toBe(`issue:${issueId}`);
    });

    it("does not create issue_assigned intents for paused companies", async () => {
      await seedTestData({ companyStatus: "paused" });

      const { queueIssueAssignmentIntent } = await import(
        "../services/issue-assignment-wakeup.js"
      );

      await queueIssueAssignmentIntent({
        db,
        intentQueue: svc,
        issue: { id: issueId, assigneeAgentId: agentId, status: "todo", companyId, projectId },
        reason: "issue_assigned",
      });

      const intents = await db
        .select()
        .from(dispatchIntents)
        .where(eq(dispatchIntents.issueId, issueId));
      expect(intents.length).toBe(0);
    });

    it("does not create issue_assigned intents for archived companies", async () => {
      await seedTestData({ companyStatus: "archived" });

      const { queueIssueAssignmentIntent } = await import(
        "../services/issue-assignment-wakeup.js"
      );

      await queueIssueAssignmentIntent({
        db,
        intentQueue: svc,
        issue: { id: issueId, assigneeAgentId: agentId, status: "todo", companyId, projectId },
        reason: "issue_assigned",
      });

      const intents = await db
        .select()
        .from(dispatchIntents)
        .where(eq(dispatchIntents.issueId, issueId));
      expect(intents.length).toBe(0);
    });
  });
});
