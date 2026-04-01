import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  agents,
  companies,
  createDb,
  dispatchIntents,
  issues,
  projects,
} from "@papierklammer/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { intentQueueService } from "../services/intent-queue.js";
import { eq } from "drizzle-orm";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeDB = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres intent queue tests: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeDB("intentQueueService", () => {
  let db!: ReturnType<typeof createDb>;
  let svc!: ReturnType<typeof intentQueueService>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  // Shared test data IDs
  let companyId: string;
  let agentId: string;
  let projectId: string;
  let issueId: string;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("intent-queue-");
    db = createDb(tempDb.connectionString);
    svc = intentQueueService(db);
  }, 30_000);

  afterEach(async () => {
    await db.delete(dispatchIntents);
    await db.delete(issues);
    await db.delete(projects);
    await db.delete(agents);
    await db.delete(companies);
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

  // ─── VAL-HARD-001: createIntent persists all required fields ──────────────

  describe("createIntent", () => {
    it("persists all fields with status=queued", async () => {
      await seedTestData();

      const intent = await svc.createIntent({
        companyId,
        issueId,
        projectId,
        targetAgentId: agentId,
        intentType: "issue_assigned",
        priority: 10,
      });

      expect(intent).toBeDefined();
      expect(intent.id).toBeDefined();
      expect(intent.companyId).toBe(companyId);
      expect(intent.issueId).toBe(issueId);
      expect(intent.projectId).toBe(projectId);
      expect(intent.targetAgentId).toBe(agentId);
      expect(intent.intentType).toBe("issue_assigned");
      expect(intent.priority).toBe(10);
      expect(intent.status).toBe("queued");
      expect(intent.createdAt).toBeInstanceOf(Date);
    });

    it("persists optional fields (goalId, workspaceId, dedupeKey, sourceEventId, notBefore)", async () => {
      await seedTestData();
      const goalId = undefined; // goals require FK - just test nullable fields
      const notBefore = new Date(Date.now() + 60_000);

      const intent = await svc.createIntent({
        companyId,
        issueId,
        projectId,
        targetAgentId: agentId,
        intentType: "timer_hint",
        priority: 0,
        dedupeKey: "timer:issue1",
        sourceEventId: "evt-123",
        notBefore,
      });

      expect(intent.dedupeKey).toBe("timer:issue1");
      expect(intent.sourceEventId).toBe("evt-123");
      expect(intent.notBefore).toEqual(notBefore);
      expect(intent.status).toBe("queued");
    });

    // ─── VAL-HARD-002: Missing required fields throw validation error ───────

    it("rejects missing companyId", async () => {
      await seedTestData();
      await expect(
        svc.createIntent({
          companyId: "",
          issueId,
          projectId,
          targetAgentId: agentId,
          intentType: "issue_assigned",
        }),
      ).rejects.toThrow(/companyId/i);
    });

    it("rejects missing issueId", async () => {
      await seedTestData();
      await expect(
        svc.createIntent({
          companyId,
          issueId: "",
          projectId,
          targetAgentId: agentId,
          intentType: "issue_assigned",
        }),
      ).rejects.toThrow(/issueId/i);
    });

    it("rejects missing projectId", async () => {
      await seedTestData();
      await expect(
        svc.createIntent({
          companyId,
          issueId,
          projectId: "",
          targetAgentId: agentId,
          intentType: "issue_assigned",
        }),
      ).rejects.toThrow(/projectId/i);
    });

    it("rejects missing targetAgentId", async () => {
      await seedTestData();
      await expect(
        svc.createIntent({
          companyId,
          issueId,
          projectId,
          targetAgentId: "",
          intentType: "issue_assigned",
        }),
      ).rejects.toThrow(/targetAgentId/i);
    });

    // ─── VAL-HARD-003: All intent types accepted / unknown rejected ─────────

    it("accepts all known intent types", async () => {
      await seedTestData();

      const knownTypes = [
        "issue_assigned",
        "issue_comment_mentioned",
        "dependency_unblocked",
        "approval_resolved",
        "timer_hint",
        "manager_escalation",
        "retry_after_failure",
      ];

      for (const intentType of knownTypes) {
        const intent = await svc.createIntent({
          companyId,
          issueId,
          projectId,
          targetAgentId: agentId,
          intentType,
          priority: 10,
        });
        expect(intent.intentType).toBe(intentType);
        expect(intent.status).toBe("queued");
      }
    });

    it("rejects unknown intent type", async () => {
      await seedTestData();
      await expect(
        svc.createIntent({
          companyId,
          issueId,
          projectId,
          targetAgentId: agentId,
          intentType: "invalid_type",
        }),
      ).rejects.toThrow(/intentType/i);
    });

    // ─── VAL-HARD-004: Deduplication by dedupeKey ───────────────────────────

    it("supersedes older queued intent with same dedupeKey", async () => {
      await seedTestData();

      const first = await svc.createIntent({
        companyId,
        issueId,
        projectId,
        targetAgentId: agentId,
        intentType: "timer_hint",
        priority: 0,
        dedupeKey: "timer:issue1",
      });

      const second = await svc.createIntent({
        companyId,
        issueId,
        projectId,
        targetAgentId: agentId,
        intentType: "issue_assigned",
        priority: 10,
        dedupeKey: "timer:issue1",
      });

      // First should be superseded
      const [firstRow] = await db
        .select()
        .from(dispatchIntents)
        .where(eq(dispatchIntents.id, first.id));
      expect(firstRow.status).toBe("superseded");

      // Second should be queued
      const [secondRow] = await db
        .select()
        .from(dispatchIntents)
        .where(eq(dispatchIntents.id, second.id));
      expect(secondRow.status).toBe("queued");
    });

    it("does not supersede if no existing queued intent with same dedupeKey", async () => {
      await seedTestData();

      const intent = await svc.createIntent({
        companyId,
        issueId,
        projectId,
        targetAgentId: agentId,
        intentType: "issue_assigned",
        priority: 10,
        dedupeKey: "unique-key",
      });

      expect(intent.status).toBe("queued");
    });

    it("does not supersede already-consumed intents with same dedupeKey", async () => {
      await seedTestData();

      // Create and admit+consume the first intent
      const first = await svc.createIntent({
        companyId,
        issueId,
        projectId,
        targetAgentId: agentId,
        intentType: "timer_hint",
        priority: 0,
        dedupeKey: "timer:issue2",
      });
      await svc.admitIntent(first.id);
      await svc.consumeIntent(first.id, randomUUID());

      // Create second intent with same dedupeKey
      const second = await svc.createIntent({
        companyId,
        issueId,
        projectId,
        targetAgentId: agentId,
        intentType: "issue_assigned",
        priority: 10,
        dedupeKey: "timer:issue2",
      });

      // First should still be consumed (not superseded)
      const [firstRow] = await db
        .select()
        .from(dispatchIntents)
        .where(eq(dispatchIntents.id, first.id));
      expect(firstRow.status).toBe("consumed");

      // Second should be queued
      expect(second.status).toBe("queued");
    });
  });

  // ─── VAL-HARD-005: State transitions ──────────────────────────────────────

  describe("state transitions", () => {
    it("transitions queued → admitted (sets resolvedAt)", async () => {
      await seedTestData();
      const intent = await svc.createIntent({
        companyId,
        issueId,
        projectId,
        targetAgentId: agentId,
        intentType: "issue_assigned",
      });

      const admitted = await svc.admitIntent(intent.id);
      expect(admitted.status).toBe("admitted");
      expect(admitted.resolvedAt).toBeInstanceOf(Date);
    });

    it("transitions queued → rejected", async () => {
      await seedTestData();
      const intent = await svc.createIntent({
        companyId,
        issueId,
        projectId,
        targetAgentId: agentId,
        intentType: "issue_assigned",
      });

      const rejected = await svc.rejectIntent(intent.id, "issue closed");
      expect(rejected.status).toBe("rejected");
      expect(rejected.resolvedAt).toBeInstanceOf(Date);
    });

    it("transitions queued → superseded", async () => {
      await seedTestData();
      const intent = await svc.createIntent({
        companyId,
        issueId,
        projectId,
        targetAgentId: agentId,
        intentType: "timer_hint",
      });

      const superseded = await svc.supersedeIntent(intent.id);
      expect(superseded.status).toBe("superseded");
    });

    it("transitions queued → deferred", async () => {
      await seedTestData();
      const intent = await svc.createIntent({
        companyId,
        issueId,
        projectId,
        targetAgentId: agentId,
        intentType: "issue_assigned",
      });

      const deferred = await svc.deferIntent(intent.id, "agent at capacity");
      expect(deferred.status).toBe("deferred");
    });

    it("transitions admitted → consumed", async () => {
      await seedTestData();
      const intent = await svc.createIntent({
        companyId,
        issueId,
        projectId,
        targetAgentId: agentId,
        intentType: "issue_assigned",
      });

      await svc.admitIntent(intent.id);
      const consumed = await svc.consumeIntent(intent.id, randomUUID());
      expect(consumed.status).toBe("consumed");
    });

    // Invalid transitions

    it("rejects admitting a non-queued intent", async () => {
      await seedTestData();
      const intent = await svc.createIntent({
        companyId,
        issueId,
        projectId,
        targetAgentId: agentId,
        intentType: "issue_assigned",
      });
      await svc.rejectIntent(intent.id, "test");

      await expect(svc.admitIntent(intent.id)).rejects.toThrow();
    });

    it("rejects consuming a non-admitted intent", async () => {
      await seedTestData();
      const intent = await svc.createIntent({
        companyId,
        issueId,
        projectId,
        targetAgentId: agentId,
        intentType: "issue_assigned",
      });

      // Queued → consumed should fail (must go through admitted first)
      await expect(svc.consumeIntent(intent.id, randomUUID())).rejects.toThrow();
    });

    it("rejects superseding a non-queued intent", async () => {
      await seedTestData();
      const intent = await svc.createIntent({
        companyId,
        issueId,
        projectId,
        targetAgentId: agentId,
        intentType: "issue_assigned",
      });
      await svc.admitIntent(intent.id);

      await expect(svc.supersedeIntent(intent.id)).rejects.toThrow();
    });

    it("rejects deferring a non-queued intent", async () => {
      await seedTestData();
      const intent = await svc.createIntent({
        companyId,
        issueId,
        projectId,
        targetAgentId: agentId,
        intentType: "issue_assigned",
      });
      await svc.admitIntent(intent.id);

      await expect(svc.deferIntent(intent.id, "reason")).rejects.toThrow();
    });

    it("rejects rejecting a non-queued intent", async () => {
      await seedTestData();
      const intent = await svc.createIntent({
        companyId,
        issueId,
        projectId,
        targetAgentId: agentId,
        intentType: "issue_assigned",
      });
      await svc.admitIntent(intent.id);

      await expect(svc.rejectIntent(intent.id, "reason")).rejects.toThrow();
    });

    it("rejects transition from consumed to any state", async () => {
      await seedTestData();
      const intent = await svc.createIntent({
        companyId,
        issueId,
        projectId,
        targetAgentId: agentId,
        intentType: "issue_assigned",
      });
      await svc.admitIntent(intent.id);
      await svc.consumeIntent(intent.id, randomUUID());

      await expect(svc.admitIntent(intent.id)).rejects.toThrow();
      await expect(svc.rejectIntent(intent.id, "reason")).rejects.toThrow();
      await expect(svc.supersedeIntent(intent.id)).rejects.toThrow();
    });
  });

  // ─── findQueuedIntents ────────────────────────────────────────────────────

  describe("findQueuedIntents", () => {
    it("returns queued intents sorted by priority desc then createdAt asc", async () => {
      await seedTestData();

      // Create intents with different priorities
      const low = await svc.createIntent({
        companyId,
        issueId,
        projectId,
        targetAgentId: agentId,
        intentType: "timer_hint",
        priority: 0,
      });

      // Small delay to ensure different createdAt
      await new Promise((r) => setTimeout(r, 10));

      const high = await svc.createIntent({
        companyId,
        issueId,
        projectId,
        targetAgentId: agentId,
        intentType: "issue_assigned",
        priority: 40,
      });

      await new Promise((r) => setTimeout(r, 10));

      const medium = await svc.createIntent({
        companyId,
        issueId,
        projectId,
        targetAgentId: agentId,
        intentType: "approval_resolved",
        priority: 30,
      });

      const results = await svc.findQueuedIntents({ companyId });
      expect(results.length).toBe(3);
      // highest priority first
      expect(results[0].id).toBe(high.id);
      expect(results[1].id).toBe(medium.id);
      expect(results[2].id).toBe(low.id);
    });

    it("filters by companyId", async () => {
      await seedTestData();

      await svc.createIntent({
        companyId,
        issueId,
        projectId,
        targetAgentId: agentId,
        intentType: "issue_assigned",
      });

      const results = await svc.findQueuedIntents({ companyId: randomUUID() });
      expect(results.length).toBe(0);
    });

    it("filters by agentId", async () => {
      await seedTestData();

      await svc.createIntent({
        companyId,
        issueId,
        projectId,
        targetAgentId: agentId,
        intentType: "issue_assigned",
      });

      const results = await svc.findQueuedIntents({ companyId, agentId });
      expect(results.length).toBe(1);

      const resultsOther = await svc.findQueuedIntents({ companyId, agentId: randomUUID() });
      expect(resultsOther.length).toBe(0);
    });

    it("filters by issueId", async () => {
      await seedTestData();

      await svc.createIntent({
        companyId,
        issueId,
        projectId,
        targetAgentId: agentId,
        intentType: "issue_assigned",
      });

      const results = await svc.findQueuedIntents({ companyId, issueId });
      expect(results.length).toBe(1);

      const resultsOther = await svc.findQueuedIntents({ companyId, issueId: randomUUID() });
      expect(resultsOther.length).toBe(0);
    });

    it("excludes non-queued intents", async () => {
      await seedTestData();

      const intent = await svc.createIntent({
        companyId,
        issueId,
        projectId,
        targetAgentId: agentId,
        intentType: "issue_assigned",
      });
      await svc.admitIntent(intent.id);

      const results = await svc.findQueuedIntents({ companyId });
      expect(results.length).toBe(0);
    });
  });

  // ─── VAL-HARD-006: invalidateForClosedIssue ──────────────────────────────

  describe("invalidateForClosedIssue", () => {
    it("rejects all queued intents for a closed issue", async () => {
      await seedTestData();

      const intent1 = await svc.createIntent({
        companyId,
        issueId,
        projectId,
        targetAgentId: agentId,
        intentType: "issue_assigned",
      });
      const intent2 = await svc.createIntent({
        companyId,
        issueId,
        projectId,
        targetAgentId: agentId,
        intentType: "timer_hint",
        priority: 0,
      });

      const count = await svc.invalidateForClosedIssue(issueId);
      expect(count).toBe(2);

      const [row1] = await db
        .select()
        .from(dispatchIntents)
        .where(eq(dispatchIntents.id, intent1.id));
      expect(row1.status).toBe("rejected");

      const [row2] = await db
        .select()
        .from(dispatchIntents)
        .where(eq(dispatchIntents.id, intent2.id));
      expect(row2.status).toBe("rejected");
    });

    it("does not affect non-queued intents", async () => {
      await seedTestData();

      const intent = await svc.createIntent({
        companyId,
        issueId,
        projectId,
        targetAgentId: agentId,
        intentType: "issue_assigned",
      });
      await svc.admitIntent(intent.id);

      const count = await svc.invalidateForClosedIssue(issueId);
      expect(count).toBe(0);

      const [row] = await db
        .select()
        .from(dispatchIntents)
        .where(eq(dispatchIntents.id, intent.id));
      expect(row.status).toBe("admitted");
    });

    it("returns 0 when no queued intents exist for the issue", async () => {
      await seedTestData();
      const count = await svc.invalidateForClosedIssue(randomUUID());
      expect(count).toBe(0);
    });
  });

  // ─── getIntent ────────────────────────────────────────────────────────────

  describe("getIntent", () => {
    it("returns an intent by id", async () => {
      await seedTestData();
      const created = await svc.createIntent({
        companyId,
        issueId,
        projectId,
        targetAgentId: agentId,
        intentType: "issue_assigned",
      });

      const found = await svc.getIntent(created.id);
      expect(found).toBeDefined();
      expect(found!.id).toBe(created.id);
    });

    it("returns null for non-existent id", async () => {
      await seedTestData();
      const found = await svc.getIntent(randomUUID());
      expect(found).toBeNull();
    });
  });

  // ─── Multi-tenant isolation ───────────────────────────────────────────────

  describe("multi-tenant isolation", () => {
    it("deduplication does not cross company boundaries", async () => {
      await seedTestData();

      // Create a second company with its own data
      const companyId2 = randomUUID();
      const agentId2 = randomUUID();
      const projectId2 = randomUUID();
      const issueId2 = randomUUID();

      await db.insert(companies).values({
        id: companyId2,
        name: "OtherCo",
        issuePrefix: `O${companyId2.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
        requireBoardApprovalForNewAgents: false,
      });
      await db.insert(agents).values({
        id: agentId2,
        companyId: companyId2,
        name: "OtherAgent",
        role: "engineer",
        status: "active",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      });
      await db.insert(projects).values({
        id: projectId2,
        companyId: companyId2,
        name: "OtherProject",
        status: "active",
      });
      await db.insert(issues).values({
        id: issueId2,
        companyId: companyId2,
        title: "Other Issue",
        status: "todo",
        priority: "medium",
        projectId: projectId2,
      });

      // Create intent in company1 with dedupeKey
      const intent1 = await svc.createIntent({
        companyId,
        issueId,
        projectId,
        targetAgentId: agentId,
        intentType: "timer_hint",
        priority: 0,
        dedupeKey: "shared-key",
      });

      // Create intent in company2 with same dedupeKey — should NOT supersede company1's intent
      const intent2 = await svc.createIntent({
        companyId: companyId2,
        issueId: issueId2,
        projectId: projectId2,
        targetAgentId: agentId2,
        intentType: "issue_assigned",
        priority: 10,
        dedupeKey: "shared-key",
      });

      // Company1's intent should still be queued (not superseded)
      const [row1] = await db
        .select()
        .from(dispatchIntents)
        .where(eq(dispatchIntents.id, intent1.id));
      expect(row1.status).toBe("queued");

      // Company2's intent should also be queued
      expect(intent2.status).toBe("queued");
    });

    it("timer hint supersession check is company-scoped", async () => {
      await seedTestData();

      // Create a second company with its own data
      const companyId2 = randomUUID();
      const agentId2 = randomUUID();
      const projectId2 = randomUUID();
      const issueId2 = randomUUID();

      await db.insert(companies).values({
        id: companyId2,
        name: "OtherCo",
        issuePrefix: `O${companyId2.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
        requireBoardApprovalForNewAgents: false,
      });
      await db.insert(agents).values({
        id: agentId2,
        companyId: companyId2,
        name: "OtherAgent",
        role: "engineer",
        status: "active",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      });
      await db.insert(projects).values({
        id: projectId2,
        companyId: companyId2,
        name: "OtherProject",
        status: "active",
      });
      await db.insert(issues).values({
        id: issueId2,
        companyId: companyId2,
        title: "Other Issue",
        status: "todo",
        priority: "medium",
        projectId: projectId2,
      });

      // Create a high-priority intent in company2 with a dedupeKey
      await svc.createIntent({
        companyId: companyId2,
        issueId: issueId2,
        projectId: projectId2,
        targetAgentId: agentId2,
        intentType: "issue_assigned",
        priority: 40,
        dedupeKey: "shared-key",
      });

      // Create a timer_hint in company1 with same dedupeKey
      // Should NOT be auto-superseded because the higher-priority intent is in a different company
      const timerIntent = await svc.createIntent({
        companyId,
        issueId,
        projectId,
        targetAgentId: agentId,
        intentType: "timer_hint",
        priority: 0,
        dedupeKey: "shared-key",
      });

      expect(timerIntent.status).toBe("queued");
    });

    it("invalidateForClosedIssue with companyId is scoped", async () => {
      await seedTestData();

      // Create a second company with its own issue having the same issue ID format
      const companyId2 = randomUUID();
      const agentId2 = randomUUID();
      const projectId2 = randomUUID();
      const issueId2 = randomUUID();

      await db.insert(companies).values({
        id: companyId2,
        name: "OtherCo",
        issuePrefix: `O${companyId2.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
        requireBoardApprovalForNewAgents: false,
      });
      await db.insert(agents).values({
        id: agentId2,
        companyId: companyId2,
        name: "OtherAgent",
        role: "engineer",
        status: "active",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      });
      await db.insert(projects).values({
        id: projectId2,
        companyId: companyId2,
        name: "OtherProject",
        status: "active",
      });
      await db.insert(issues).values({
        id: issueId2,
        companyId: companyId2,
        title: "Other Issue",
        status: "todo",
        priority: "medium",
        projectId: projectId2,
      });

      // Create intents for both companies for their respective issues
      await svc.createIntent({
        companyId,
        issueId,
        projectId,
        targetAgentId: agentId,
        intentType: "issue_assigned",
      });
      await svc.createIntent({
        companyId: companyId2,
        issueId: issueId2,
        projectId: projectId2,
        targetAgentId: agentId2,
        intentType: "issue_assigned",
      });

      // Invalidate with companyId — should only affect company1's intents
      const count = await svc.invalidateForClosedIssue(issueId, companyId);
      expect(count).toBe(1);

      // Company2's intent should still be queued
      const company2Intents = await svc.findQueuedIntents({ companyId: companyId2 });
      expect(company2Intents.length).toBe(1);
    });
  });
});
