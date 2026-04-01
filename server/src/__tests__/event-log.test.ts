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
import { eventLogService, EVENT_TYPES } from "../services/event-log.js";
import { intentQueueService } from "../services/intent-queue.js";
import { schedulerService } from "../services/scheduler.js";
import { leaseManagerService } from "../services/lease-manager.js";
import { eq, sql } from "drizzle-orm";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeDB = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres event log tests: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeDB("eventLogService", () => {
  let db!: ReturnType<typeof createDb>;
  let eventLog!: ReturnType<typeof eventLogService>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  // Shared test data IDs
  let companyId: string;
  let agentId: string;
  let projectId: string;
  let issueId: string;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("event-log-");
    db = createDb(tempDb.connectionString);
    eventLog = eventLogService(db);
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
      status: "in_progress",
    });

    await db.insert(issues).values({
      id: issueId,
      companyId,
      projectId,
      title: "Test Issue",
      status: "todo",
      priority: "medium",
      assigneeAgentId: agentId,
      identifier: `T-${Date.now()}`,
      issueNumber: 1,
    });
  }

  // ──────────────────────────────────────────────────────────
  // Core emit/query tests
  // ──────────────────────────────────────────────────────────

  describe("emit()", () => {
    it("inserts a new event with all required fields", async () => {
      await seedTestData();

      const event = await eventLog.emit({
        companyId,
        entityType: "intent",
        entityId: randomUUID(),
        eventType: "intent_created",
        payload: { intentType: "issue_assigned", agentId },
      });

      expect(event).toBeDefined();
      expect(event.companyId).toBe(companyId);
      expect(event.entityType).toBe("intent");
      expect(event.eventType).toBe("intent_created");
      expect(event.payload).toEqual({ intentType: "issue_assigned", agentId });
      expect(event.createdAt).toBeInstanceOf(Date);
      expect(typeof event.id).toBe("number");
    });

    it("inserts event with null payload when not provided", async () => {
      await seedTestData();

      const event = await eventLog.emit({
        companyId,
        entityType: "run",
        entityId: randomUUID(),
        eventType: "run_started",
      });

      expect(event.payload).toBeNull();
    });

    it("is append-only — no update or delete methods exist", () => {
      // Verify the service API has only emit and query
      const methods = Object.keys(eventLog);
      expect(methods).toContain("emit");
      expect(methods).toContain("query");
      expect(methods).not.toContain("update");
      expect(methods).not.toContain("delete");
      expect(methods).not.toContain("remove");
      expect(methods).not.toContain("modify");
    });
  });

  describe("query()", () => {
    it("returns events filtered by companyId", async () => {
      await seedTestData();

      const entityId = randomUUID();
      await eventLog.emit({ companyId, entityType: "run", entityId, eventType: "run_started" });
      await eventLog.emit({ companyId, entityType: "run", entityId, eventType: "run_completed" });

      // Create event for a different company (should not appear)
      const otherCompanyId = randomUUID();
      await db.insert(companies).values({
        id: otherCompanyId,
        name: "OtherCo",
        issuePrefix: `O${otherCompanyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
        requireBoardApprovalForNewAgents: false,
      });
      await eventLog.emit({ companyId: otherCompanyId, entityType: "run", entityId: randomUUID(), eventType: "run_started" });

      const events = await eventLog.query({ companyId });
      expect(events.length).toBe(2);
      expect(events.every((e) => e.companyId === companyId)).toBe(true);
    });

    it("filters by entityType", async () => {
      await seedTestData();

      await eventLog.emit({ companyId, entityType: "intent", entityId: randomUUID(), eventType: "intent_created" });
      await eventLog.emit({ companyId, entityType: "run", entityId: randomUUID(), eventType: "run_started" });
      await eventLog.emit({ companyId, entityType: "lease", entityId: randomUUID(), eventType: "lease_allocated" });

      const intentEvents = await eventLog.query({ companyId, entityType: "intent" });
      expect(intentEvents.length).toBe(1);
      expect(intentEvents[0].entityType).toBe("intent");
    });

    it("filters by entityId", async () => {
      await seedTestData();

      const targetEntityId = randomUUID();
      await eventLog.emit({ companyId, entityType: "run", entityId: targetEntityId, eventType: "run_started" });
      await eventLog.emit({ companyId, entityType: "run", entityId: targetEntityId, eventType: "run_completed" });
      await eventLog.emit({ companyId, entityType: "run", entityId: randomUUID(), eventType: "run_started" });

      const events = await eventLog.query({ companyId, entityId: targetEntityId });
      expect(events.length).toBe(2);
      expect(events.every((e) => e.entityId === targetEntityId)).toBe(true);
    });

    it("filters by eventType", async () => {
      await seedTestData();

      await eventLog.emit({ companyId, entityType: "run", entityId: randomUUID(), eventType: "run_started" });
      await eventLog.emit({ companyId, entityType: "run", entityId: randomUUID(), eventType: "run_completed" });
      await eventLog.emit({ companyId, entityType: "run", entityId: randomUUID(), eventType: "run_failed" });

      const failedEvents = await eventLog.query({ companyId, eventType: "run_failed" });
      expect(failedEvents.length).toBe(1);
      expect(failedEvents[0].eventType).toBe("run_failed");
    });

    it("filters by since timestamp", async () => {
      await seedTestData();

      // Insert first event well in the past
      const pastTime = new Date(Date.now() - 60_000).toISOString();
      await db.execute(
        sql`INSERT INTO control_plane_events (company_id, entity_type, entity_id, event_type, created_at)
            VALUES (${companyId}, 'run', ${randomUUID()}, 'run_started', ${pastTime}::timestamptz)`,
      );

      // The threshold is between the two events
      const threshold = new Date(Date.now() - 30_000);

      // Insert second event recently (default now())
      await eventLog.emit({ companyId, entityType: "run", entityId: randomUUID(), eventType: "run_completed" });

      const recentEvents = await eventLog.query({ companyId, since: threshold });
      expect(recentEvents.length).toBe(1);
      expect(recentEvents[0].eventType).toBe("run_completed");
    });

    it("respects limit parameter", async () => {
      await seedTestData();

      for (let i = 0; i < 5; i++) {
        await eventLog.emit({ companyId, entityType: "run", entityId: randomUUID(), eventType: "run_started" });
      }

      const limited = await eventLog.query({ companyId, limit: 3 });
      expect(limited.length).toBe(3);
    });

    it("orders results by createdAt descending (newest first)", async () => {
      await seedTestData();

      const id1 = randomUUID();
      const id2 = randomUUID();
      const id3 = randomUUID();

      await eventLog.emit({ companyId, entityType: "run", entityId: id1, eventType: "run_started" });
      await new Promise((r) => setTimeout(r, 5));
      await eventLog.emit({ companyId, entityType: "run", entityId: id2, eventType: "run_completed" });
      await new Promise((r) => setTimeout(r, 5));
      await eventLog.emit({ companyId, entityType: "run", entityId: id3, eventType: "run_failed" });

      const events = await eventLog.query({ companyId });
      expect(events.length).toBe(3);
      // Newest first
      expect(events[0].eventType).toBe("run_failed");
      expect(events[2].eventType).toBe("run_started");
    });

    it("combines multiple filters", async () => {
      await seedTestData();

      const targetEntityId = randomUUID();
      await eventLog.emit({ companyId, entityType: "run", entityId: targetEntityId, eventType: "run_started" });
      await eventLog.emit({ companyId, entityType: "run", entityId: targetEntityId, eventType: "run_completed" });
      await eventLog.emit({ companyId, entityType: "intent", entityId: randomUUID(), eventType: "intent_created" });

      const events = await eventLog.query({ companyId, entityType: "run", entityId: targetEntityId, eventType: "run_completed" });
      expect(events.length).toBe(1);
      expect(events[0].eventType).toBe("run_completed");
    });
  });

  // ──────────────────────────────────────────────────────────
  // Event type and entity structure tests
  // ──────────────────────────────────────────────────────────

  describe("event types coverage", () => {
    it("supports all 15 defined event types", () => {
      expect(EVENT_TYPES).toContain("intent_created");
      expect(EVENT_TYPES).toContain("intent_admitted");
      expect(EVENT_TYPES).toContain("intent_rejected");
      expect(EVENT_TYPES).toContain("run_started");
      expect(EVENT_TYPES).toContain("run_completed");
      expect(EVENT_TYPES).toContain("run_failed");
      expect(EVENT_TYPES).toContain("run_cancelled");
      expect(EVENT_TYPES).toContain("lease_allocated");
      expect(EVENT_TYPES).toContain("lease_renewed");
      expect(EVENT_TYPES).toContain("lease_expired");
      expect(EVENT_TYPES).toContain("checkout_acquired");
      expect(EVENT_TYPES).toContain("checkout_conflict");
      expect(EVENT_TYPES).toContain("issue_status_changed");
      expect(EVENT_TYPES).toContain("workspace_resolution_failed");
      expect(EVENT_TYPES).toContain("auto_escalation_created");
      expect(EVENT_TYPES.length).toBe(15);
    });
  });

  describe("entity type/id correctness", () => {
    it("intent events use entityType=intent and entityId=intentId", async () => {
      await seedTestData();
      const intentId = randomUUID();

      const event = await eventLog.emit({
        companyId,
        entityType: "intent",
        entityId: intentId,
        eventType: "intent_created",
        payload: { intentType: "issue_assigned", issueId, agentId },
      });

      expect(event.entityType).toBe("intent");
      expect(event.entityId).toBe(intentId);
    });

    it("run events use entityType=run and entityId=runId", async () => {
      await seedTestData();
      const runId = randomUUID();

      const event = await eventLog.emit({
        companyId,
        entityType: "run",
        entityId: runId,
        eventType: "run_started",
        payload: { runId, agentId, issueId },
      });

      expect(event.entityType).toBe("run");
      expect(event.entityId).toBe(runId);
    });

    it("lease events use entityType=lease and entityId=leaseId", async () => {
      await seedTestData();
      const leaseId = randomUUID();

      const event = await eventLog.emit({
        companyId,
        entityType: "lease",
        entityId: leaseId,
        eventType: "lease_allocated",
        payload: { leaseId, issueId, agentId },
      });

      expect(event.entityType).toBe("lease");
      expect(event.entityId).toBe(leaseId);
    });

    it("issue events use entityType=issue and entityId=issueId", async () => {
      await seedTestData();

      const event = await eventLog.emit({
        companyId,
        entityType: "issue",
        entityId: issueId,
        eventType: "issue_status_changed",
        payload: { issueId, from: "todo", to: "in_progress" },
      });

      expect(event.entityType).toBe("issue");
      expect(event.entityId).toBe(issueId);
    });
  });

  describe("structured payload verification", () => {
    it("intent_created payload includes intentType, issueId, agentId", async () => {
      await seedTestData();

      const event = await eventLog.emit({
        companyId,
        entityType: "intent",
        entityId: randomUUID(),
        eventType: "intent_created",
        payload: {
          intentType: "issue_assigned",
          issueId,
          agentId,
          projectId,
        },
      });

      const payload = event.payload as Record<string, unknown>;
      expect(payload.intentType).toBe("issue_assigned");
      expect(payload.issueId).toBe(issueId);
      expect(payload.agentId).toBe(agentId);
    });

    it("run_started payload includes runId, agentId, issueId", async () => {
      await seedTestData();
      const runId = randomUUID();

      const event = await eventLog.emit({
        companyId,
        entityType: "run",
        entityId: runId,
        eventType: "run_started",
        payload: { runId, agentId, issueId },
      });

      const payload = event.payload as Record<string, unknown>;
      expect(payload.runId).toBe(runId);
      expect(payload.agentId).toBe(agentId);
      expect(payload.issueId).toBe(issueId);
    });

    it("lease_allocated payload includes leaseId, issueId, agentId, ttlSeconds", async () => {
      await seedTestData();
      const leaseId = randomUUID();

      const event = await eventLog.emit({
        companyId,
        entityType: "lease",
        entityId: leaseId,
        eventType: "lease_allocated",
        payload: {
          leaseId,
          issueId,
          agentId,
          ttlSeconds: 300,
        },
      });

      const payload = event.payload as Record<string, unknown>;
      expect(payload.leaseId).toBe(leaseId);
      expect(payload.issueId).toBe(issueId);
      expect(payload.agentId).toBe(agentId);
      expect(payload.ttlSeconds).toBe(300);
    });

    it("checkout_acquired payload includes issueId, agentId, runId", async () => {
      await seedTestData();
      const runId = randomUUID();

      const event = await eventLog.emit({
        companyId,
        entityType: "issue",
        entityId: issueId,
        eventType: "checkout_acquired",
        payload: { issueId, agentId, runId },
      });

      const payload = event.payload as Record<string, unknown>;
      expect(payload.issueId).toBe(issueId);
      expect(payload.agentId).toBe(agentId);
      expect(payload.runId).toBe(runId);
    });

    it("issue_status_changed payload includes from and to statuses", async () => {
      await seedTestData();

      const event = await eventLog.emit({
        companyId,
        entityType: "issue",
        entityId: issueId,
        eventType: "issue_status_changed",
        payload: {
          issueId,
          from: "todo",
          to: "in_progress",
          agentId,
        },
      });

      const payload = event.payload as Record<string, unknown>;
      expect(payload.from).toBe("todo");
      expect(payload.to).toBe("in_progress");
    });

    it("workspace_resolution_failed payload includes issueId, reason", async () => {
      await seedTestData();
      const runId = randomUUID();

      const event = await eventLog.emit({
        companyId,
        entityType: "run",
        entityId: runId,
        eventType: "workspace_resolution_failed",
        payload: {
          issueId,
          agentId,
          runId,
          reason: "No workspace found for project",
        },
      });

      const payload = event.payload as Record<string, unknown>;
      expect(payload.reason).toBeDefined();
      expect(payload.issueId).toBe(issueId);
    });
  });

  // ──────────────────────────────────────────────────────────
  // Integration tests: verify events emitted at lifecycle points
  // ──────────────────────────────────────────────────────────

  describe("intent lifecycle events", () => {
    it("intent_created event is emitted when createIntent is called", async () => {
      await seedTestData();

      // Add a workspace so intent creation doesn't fail
      await db.insert(projectWorkspaces).values({
        id: randomUUID(),
        companyId,
        projectId,
        name: "test-workspace",
        cwd: "/tmp/test",
        isPrimary: true,
      });

      const intentQueue = intentQueueService(db);
      const intent = await intentQueue.createIntent({
        companyId,
        issueId,
        projectId,
        targetAgentId: agentId,
        intentType: "issue_assigned",
        dedupeKey: `issue:${issueId}`,
      });

      // Check that intent_created event was emitted
      const events = await eventLog.query({
        companyId,
        eventType: "intent_created",
        entityId: intent.id,
      });

      expect(events.length).toBe(1);
      expect(events[0].entityType).toBe("intent");
      expect(events[0].entityId).toBe(intent.id);

      const payload = events[0].payload as Record<string, unknown>;
      expect(payload.intentType).toBe("issue_assigned");
      expect(payload.issueId).toBe(issueId);
      expect(payload.agentId).toBe(agentId);
    });

    it("intent_admitted event is emitted when scheduler admits an intent", async () => {
      await seedTestData();

      await db.insert(projectWorkspaces).values({
        id: randomUUID(),
        companyId,
        projectId,
        name: "test-workspace",
        cwd: "/tmp/test",
        isPrimary: true,
      });

      const intentQueue = intentQueueService(db);
      const intent = await intentQueue.createIntent({
        companyId,
        issueId,
        projectId,
        targetAgentId: agentId,
        intentType: "issue_assigned",
      });

      const scheduler = schedulerService(db);
      const result = await scheduler.processIntent(intent.id);
      expect(result.admitted).toBe(true);

      const events = await eventLog.query({
        companyId,
        eventType: "intent_admitted",
        entityId: intent.id,
      });

      expect(events.length).toBe(1);
      expect(events[0].entityType).toBe("intent");

      const payload = events[0].payload as Record<string, unknown>;
      expect(payload.intentId).toBe(intent.id);
    });

    it("intent_rejected event is emitted when scheduler rejects an intent", async () => {
      await seedTestData();

      // Close the issue so the intent gets rejected
      await db.update(issues).set({ status: "done" }).where(eq(issues.id, issueId));

      const intentQueue = intentQueueService(db);
      const intent = await intentQueue.createIntent({
        companyId,
        issueId,
        projectId,
        targetAgentId: agentId,
        intentType: "issue_assigned",
      });

      const scheduler = schedulerService(db);
      const result = await scheduler.processIntent(intent.id);
      expect(result.admitted).toBe(false);

      const events = await eventLog.query({
        companyId,
        eventType: "intent_rejected",
        entityId: intent.id,
      });

      expect(events.length).toBe(1);
      expect(events[0].entityType).toBe("intent");

      const payload = events[0].payload as Record<string, unknown>;
      expect(payload.intentId).toBe(intent.id);
      expect(payload.reason).toContain("issue closed");
    });
  });

  describe("lease lifecycle events", () => {
    it("lease_allocated event is emitted when scheduler grants a lease", async () => {
      await seedTestData();

      await db.insert(projectWorkspaces).values({
        id: randomUUID(),
        companyId,
        projectId,
        name: "test-workspace",
        cwd: "/tmp/test",
        isPrimary: true,
      });

      const intentQueue = intentQueueService(db);
      const intent = await intentQueue.createIntent({
        companyId,
        issueId,
        projectId,
        targetAgentId: agentId,
        intentType: "issue_assigned",
      });

      const scheduler = schedulerService(db);
      const result = await scheduler.processIntent(intent.id);
      expect(result.admitted).toBe(true);
      expect(result.leaseId).toBeDefined();

      const events = await eventLog.query({
        companyId,
        eventType: "lease_allocated",
        entityId: result.leaseId!,
      });

      expect(events.length).toBe(1);
      expect(events[0].entityType).toBe("lease");

      const payload = events[0].payload as Record<string, unknown>;
      expect(payload.leaseId).toBe(result.leaseId);
      expect(payload.issueId).toBe(issueId);
      expect(payload.agentId).toBe(agentId);
    });

    it("lease_renewed event is emitted when a lease is renewed", async () => {
      await seedTestData();

      const leaseManager = leaseManagerService(db);
      const lease = await leaseManager.grantLease({
        leaseType: "issue_execution",
        issueId,
        agentId,
        companyId,
        ttlSeconds: 300,
      });

      await leaseManager.renewLease(lease.id);

      const events = await eventLog.query({
        companyId,
        eventType: "lease_renewed",
        entityId: lease.id,
      });

      expect(events.length).toBe(1);
      expect(events[0].entityType).toBe("lease");

      const payload = events[0].payload as Record<string, unknown>;
      expect(payload.leaseId).toBe(lease.id);
    });

    it("lease_expired events are emitted when leases expire", async () => {
      await seedTestData();

      const leaseManager = leaseManagerService(db);
      // Create a lease with very short TTL that's already expired
      const lease = await leaseManager.grantLease({
        leaseType: "issue_execution",
        issueId,
        agentId,
        companyId,
        ttlSeconds: 1,
      });

      // Manually set expiresAt to the past
      await db
        .update(executionLeases)
        .set({ expiresAt: new Date(Date.now() - 10000) })
        .where(eq(executionLeases.id, lease.id));

      const expiredIds = await leaseManager.expireLeases();
      expect(expiredIds).toContain(lease.id);

      const events = await eventLog.query({
        companyId,
        eventType: "lease_expired",
        entityId: lease.id,
      });

      expect(events.length).toBe(1);
      expect(events[0].entityType).toBe("lease");

      const payload = events[0].payload as Record<string, unknown>;
      expect(payload.leaseId).toBe(lease.id);
    });
  });

  describe("run lifecycle events", () => {
    it("run_started event is emitted when scheduler creates a run", async () => {
      await seedTestData();

      await db.insert(projectWorkspaces).values({
        id: randomUUID(),
        companyId,
        projectId,
        name: "test-workspace",
        cwd: "/tmp/test",
        isPrimary: true,
      });

      const intentQueue = intentQueueService(db);
      const intent = await intentQueue.createIntent({
        companyId,
        issueId,
        projectId,
        targetAgentId: agentId,
        intentType: "issue_assigned",
      });

      const scheduler = schedulerService(db);
      const result = await scheduler.processIntent(intent.id);
      expect(result.admitted).toBe(true);
      expect(result.runId).toBeDefined();

      const events = await eventLog.query({
        companyId,
        eventType: "run_started",
        entityId: result.runId!,
      });

      expect(events.length).toBe(1);
      expect(events[0].entityType).toBe("run");

      const payload = events[0].payload as Record<string, unknown>;
      expect(payload.runId).toBe(result.runId);
      expect(payload.agentId).toBe(agentId);
      expect(payload.issueId).toBe(issueId);
    });
  });
});
