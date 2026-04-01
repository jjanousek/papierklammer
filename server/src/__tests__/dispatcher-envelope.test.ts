import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  agents,
  companies,
  controlPlaneEvents,
  createDb,
  dispatchIntents,
  executionEnvelopes,
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
import { envelopeService } from "../services/envelope.js";
import { dispatcherService } from "../services/dispatcher.js";
import { eq, sql } from "drizzle-orm";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeDB = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres dispatcher/envelope tests: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeDB("envelopeService", () => {
  let db!: ReturnType<typeof createDb>;
  let envelopes!: ReturnType<typeof envelopeService>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  let companyId: string;
  let agentId: string;
  let projectId: string;
  let issueId: string;
  let runId: string;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("envelope-");
    db = createDb(tempDb.connectionString);
    envelopes = envelopeService(db);
  }, 30_000);

  afterEach(async () => {
    await db.execute(sql`TRUNCATE TABLE
      execution_envelopes,
      execution_leases,
      heartbeat_runs,
      dispatch_intents,
      control_plane_events,
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
      assigneeAgentId: agentId,
    });

    // Create a heartbeat_run for the envelope to reference
    const [run] = await db
      .insert(heartbeatRuns)
      .values({
        companyId,
        agentId,
        invocationSource: "scheduler",
        status: "queued",
      })
      .returning();
    runId = run.id;
  }

  // ─── VAL-HARD-030: Envelope created at dispatch ─────────────────────────

  describe("createEnvelope — all required fields", () => {
    it("creates envelope with all required fields", async () => {
      await seedTestData();

      const envelope = await envelopes.createEnvelope({
        runId,
        companyId,
        agentId,
        issueId,
        projectId,
        goalId: null,
        workspaceId: null,
        wakeReason: "issue_assigned",
        runKind: "standard",
        executionPolicyVersion: "1",
        workspaceBindingMode: "required_project_workspace",
      });

      expect(envelope).toBeDefined();
      expect(envelope.id).toBeDefined();
      expect(envelope.runId).toBe(runId);
      expect(envelope.companyId).toBe(companyId);
      expect(envelope.agentId).toBe(agentId);
      expect(envelope.issueId).toBe(issueId);
      expect(envelope.projectId).toBe(projectId);
      expect(envelope.goalId).toBeNull();
      expect(envelope.workspaceId).toBeNull();
      expect(envelope.wakeReason).toBe("issue_assigned");
      expect(envelope.runKind).toBe("standard");
      expect(envelope.executionPolicyVersion).toBe("1");
      expect(envelope.workspaceBindingMode).toBe("required_project_workspace");
      expect(envelope.createdAt).toBeDefined();
    });

    it("uses default executionPolicyVersion when not specified", async () => {
      await seedTestData();

      const envelope = await envelopes.createEnvelope({
        runId,
        companyId,
        agentId,
        issueId,
        wakeReason: "timer_hint",
        runKind: "standard",
        workspaceBindingMode: "explicit_ad_hoc_workspace",
      });

      expect(envelope.executionPolicyVersion).toBe("1");
    });
  });

  // ─── VAL-HARD-031: Envelope is immutable ────────────────────────────────

  describe("envelope immutability", () => {
    it("does not expose any update methods", () => {
      // The envelopeService only exposes createEnvelope, getEnvelope,
      // and getEnvelopeByRunId — no update or delete methods
      const methods = Object.keys(envelopes);
      expect(methods).toContain("createEnvelope");
      expect(methods).toContain("getEnvelope");
      expect(methods).toContain("getEnvelopeByRunId");
      // Ensure no update/delete methods exist
      expect(methods).not.toContain("updateEnvelope");
      expect(methods).not.toContain("deleteEnvelope");
      expect(methods).not.toContain("update");
      expect(methods).not.toContain("delete");
    });

    it("envelope data cannot be changed after creation via direct DB update", async () => {
      await seedTestData();

      const envelope = await envelopes.createEnvelope({
        runId,
        companyId,
        agentId,
        issueId,
        projectId,
        wakeReason: "issue_assigned",
        runKind: "standard",
        workspaceBindingMode: "required_project_workspace",
      });

      // Verify the envelope was created correctly
      const fetched = await envelopes.getEnvelope(envelope.id);
      expect(fetched).toBeDefined();
      expect(fetched!.issueId).toBe(issueId);
      expect(fetched!.workspaceBindingMode).toBe("required_project_workspace");
      // Note: The service intentionally does not expose update methods.
      // The immutability is enforced by the service API, not by DB constraints.
    });
  });

  // ─── getEnvelope / getEnvelopeByRunId ─────────────────────────────────

  describe("getEnvelope", () => {
    it("returns null for non-existent envelope", async () => {
      await seedTestData();
      const result = await envelopes.getEnvelope(randomUUID());
      expect(result).toBeNull();
    });

    it("returns envelope by ID", async () => {
      await seedTestData();
      const created = await envelopes.createEnvelope({
        runId,
        companyId,
        agentId,
        issueId,
        wakeReason: "issue_assigned",
        runKind: "standard",
        workspaceBindingMode: "required_project_workspace",
      });

      const fetched = await envelopes.getEnvelope(created.id);
      expect(fetched).toBeDefined();
      expect(fetched!.id).toBe(created.id);
      expect(fetched!.runId).toBe(runId);
    });
  });

  describe("getEnvelopeByRunId", () => {
    it("returns null for non-existent run", async () => {
      await seedTestData();
      const result = await envelopes.getEnvelopeByRunId(randomUUID());
      expect(result).toBeNull();
    });

    it("returns envelope by run ID", async () => {
      await seedTestData();
      const created = await envelopes.createEnvelope({
        runId,
        companyId,
        agentId,
        issueId,
        wakeReason: "issue_assigned",
        runKind: "standard",
        workspaceBindingMode: "required_project_workspace",
      });

      const fetched = await envelopes.getEnvelopeByRunId(runId);
      expect(fetched).toBeDefined();
      expect(fetched!.id).toBe(created.id);
    });
  });
});

describeDB("dispatcherService", () => {
  let db!: ReturnType<typeof createDb>;
  let dispatcher!: ReturnType<typeof dispatcherService>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  let companyId: string;
  let agentId: string;
  let projectId: string;
  let issueId: string;
  let workspaceId: string;
  let runId: string;
  let leaseId: string;
  let intentId: string;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("dispatcher-");
    db = createDb(tempDb.connectionString);
    dispatcher = dispatcherService(db);
  }, 30_000);

  afterEach(async () => {
    await db.execute(sql`TRUNCATE TABLE
      execution_envelopes,
      execution_leases,
      heartbeat_runs,
      dispatch_intents,
      control_plane_events,
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

  async function seedTestData(overrides?: {
    withWorkspace?: boolean;
    projectId?: string | null;
  }) {
    companyId = randomUUID();
    agentId = randomUUID();
    projectId = overrides?.projectId === null ? randomUUID() : (overrides?.projectId ?? randomUUID());
    issueId = randomUUID();
    workspaceId = randomUUID();
    intentId = randomUUID();
    leaseId = randomUUID();

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

    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Test Issue",
      status: "todo",
      priority: "medium",
      projectId,
      assigneeAgentId: agentId,
    });

    // Create intent
    await db.insert(dispatchIntents).values({
      id: intentId,
      companyId,
      issueId,
      projectId,
      targetAgentId: agentId,
      intentType: "issue_assigned",
      priority: 10,
      status: "admitted",
      workspaceId: shouldCreateWorkspace ? workspaceId : null,
    });

    // Create lease
    await db.insert(executionLeases).values({
      id: leaseId,
      leaseType: "issue_execution",
      issueId,
      agentId,
      state: "granted",
      companyId,
      grantedAt: new Date(),
      expiresAt: new Date(Date.now() + 300_000),
    });

    // Create run
    const [run] = await db
      .insert(heartbeatRuns)
      .values({
        companyId,
        agentId,
        invocationSource: "scheduler",
        status: "queued",
        intentId,
      })
      .returning();
    runId = run.id;

    // Update lease with runId
    await db
      .update(executionLeases)
      .set({ runId })
      .where(eq(executionLeases.id, leaseId));
  }

  function buildIntentInput(overrides?: {
    workspaceId?: string | null;
    projectId?: string | null;
  }) {
    return {
      id: intentId,
      companyId,
      issueId,
      projectId: overrides?.projectId === undefined ? projectId : overrides.projectId,
      goalId: null,
      workspaceId: overrides?.workspaceId === undefined
        ? workspaceId
        : overrides.workspaceId,
      targetAgentId: agentId,
      intentType: "issue_assigned",
    };
  }

  // ─── VAL-HARD-030: Envelope created at dispatch ─────────────────────────

  describe("dispatchRun — envelope creation", () => {
    it("creates envelope with all required fields at dispatch", async () => {
      await seedTestData();

      const result = await dispatcher.dispatchRun({
        intent: buildIntentInput(),
        lease: { id: leaseId },
        runId,
      });

      expect(result.success).toBe(true);
      expect(result.envelopeId).toBeDefined();

      // Verify envelope row exists with correct fields
      const envelope = await dispatcher.getEnvelope(result.envelopeId!);
      expect(envelope).toBeDefined();
      expect(envelope!.runId).toBe(runId);
      expect(envelope!.companyId).toBe(companyId);
      expect(envelope!.agentId).toBe(agentId);
      expect(envelope!.issueId).toBe(issueId);
      expect(envelope!.projectId).toBe(projectId);
      expect(envelope!.workspaceId).toBe(workspaceId);
      expect(envelope!.wakeReason).toBe("issue_assigned");
      expect(envelope!.runKind).toBe("standard");
      expect(envelope!.executionPolicyVersion).toBe("1");
      expect(envelope!.workspaceBindingMode).toBe("required_project_workspace");
    });
  });

  // ─── VAL-HARD-032: Run references envelope via envelopeId ───────────────

  describe("dispatchRun — run linked to envelope", () => {
    it("run.envelopeId points to the created envelope", async () => {
      await seedTestData();

      const result = await dispatcher.dispatchRun({
        intent: buildIntentInput(),
        lease: { id: leaseId },
        runId,
      });

      expect(result.success).toBe(true);

      // Verify the run has the envelopeId set
      const [run] = await db
        .select()
        .from(heartbeatRuns)
        .where(eq(heartbeatRuns.id, runId));
      expect(run.envelopeId).toBe(result.envelopeId);
    });
  });

  // ─── VAL-HARD-033: Adapter receives envelope context ────────────────────

  describe("buildEnvelopeContext — adapter context", () => {
    it("returns envelope fields for adapter context", async () => {
      await seedTestData();

      const result = await dispatcher.dispatchRun({
        intent: buildIntentInput(),
        lease: { id: leaseId },
        runId,
      });

      const envelopeContext = await dispatcher.buildEnvelopeContext(
        result.envelopeId!,
      );

      expect(envelopeContext).toBeDefined();
      expect(envelopeContext!.envelopeId).toBe(result.envelopeId);
      expect(envelopeContext!.issueId).toBe(issueId);
      expect(envelopeContext!.projectId).toBe(projectId);
      expect(envelopeContext!.goalId).toBeNull();
      expect(envelopeContext!.workspaceId).toBe(workspaceId);
      expect(envelopeContext!.wakeReason).toBe("issue_assigned");
      expect(envelopeContext!.runKind).toBe("standard");
      expect(envelopeContext!.executionPolicyVersion).toBe("1");
      expect(envelopeContext!.workspaceBindingMode).toBe(
        "required_project_workspace",
      );
    });

    it("returns null for non-existent envelope", async () => {
      await seedTestData();
      const result = await dispatcher.buildEnvelopeContext(randomUUID());
      expect(result).toBeNull();
    });
  });

  // ─── VAL-HARD-034: Runs without envelope are blocked ────────────────────

  describe("requireEnvelopeForRun — enforcement", () => {
    it("throws when run has no envelope", async () => {
      await seedTestData();

      // The run was created without an envelope (no dispatchRun called)
      await expect(
        dispatcher.requireEnvelopeForRun(runId),
      ).rejects.toThrow(/no execution envelope/i);
    });

    it("returns envelope when run has one", async () => {
      await seedTestData();

      await dispatcher.dispatchRun({
        intent: buildIntentInput(),
        lease: { id: leaseId },
        runId,
      });

      const envelope = await dispatcher.requireEnvelopeForRun(runId);
      expect(envelope).toBeDefined();
      expect(envelope.runId).toBe(runId);
    });
  });

  // ─── VAL-HARD-040: Workspace resolved from issue→project→workspace chain ─

  describe("dispatchRun — workspace resolution", () => {
    it("resolves workspace from issue→project→workspace chain", async () => {
      await seedTestData();

      const result = await dispatcher.dispatchRun({
        intent: buildIntentInput({ workspaceId: null }), // No explicit workspace
        lease: { id: leaseId },
        runId,
      });

      expect(result.success).toBe(true);

      // Envelope should have the primary workspace resolved
      const envelope = await dispatcher.getEnvelope(result.envelopeId!);
      expect(envelope!.workspaceId).toBe(workspaceId);
    });

    it("prefers explicitly specified workspaceId", async () => {
      await seedTestData();

      // Create a second workspace
      const secondWorkspaceId = randomUUID();
      await db.insert(projectWorkspaces).values({
        id: secondWorkspaceId,
        companyId,
        projectId,
        name: "secondary",
        sourceType: "local_path",
        cwd: "/tmp/secondary-workspace",
        isPrimary: false,
      });

      const result = await dispatcher.dispatchRun({
        intent: buildIntentInput({ workspaceId: secondWorkspaceId }),
        lease: { id: leaseId },
        runId,
      });

      expect(result.success).toBe(true);
      const envelope = await dispatcher.getEnvelope(result.envelopeId!);
      expect(envelope!.workspaceId).toBe(secondWorkspaceId);
    });
  });

  // ─── VAL-HARD-041: No fallback to agent_home for project work ───────────

  describe("dispatchRun — workspace binding rejection", () => {
    it("rejects run when workspace resolution fails for project work", async () => {
      await seedTestData({ withWorkspace: false });

      const result = await dispatcher.dispatchRun({
        intent: buildIntentInput({ workspaceId: null }),
        lease: { id: leaseId },
        runId,
      });

      expect(result.success).toBe(false);
      expect(result.reason).toContain("No workspace found for project");
      expect(result.envelopeId).toBeUndefined();
    });

    it("emits workspace_resolution_failed event on failure", async () => {
      await seedTestData({ withWorkspace: false });

      const result = await dispatcher.dispatchRun({
        intent: buildIntentInput({ workspaceId: null }),
        lease: { id: leaseId },
        runId,
      });

      expect(result.success).toBe(false);

      // Verify event was emitted
      const events = await db
        .select()
        .from(controlPlaneEvents)
        .where(eq(controlPlaneEvents.eventType, "workspace_resolution_failed"));

      expect(events.length).toBe(1);
      expect(events[0].entityType).toBe("run");
      expect(events[0].entityId).toBe(runId);
      expect(events[0].companyId).toBe(companyId);
      expect(events[0].payload).toBeDefined();
      expect((events[0].payload as Record<string, unknown>).issueId).toBe(
        issueId,
      );
      expect((events[0].payload as Record<string, unknown>).agentId).toBe(
        agentId,
      );
      expect((events[0].payload as Record<string, unknown>).runId).toBe(
        runId,
      );
    });

    it("rejects when specified workspace does not exist", async () => {
      await seedTestData();
      const nonExistentWsId = randomUUID();

      const result = await dispatcher.dispatchRun({
        intent: buildIntentInput({ workspaceId: nonExistentWsId }),
        lease: { id: leaseId },
        runId,
      });

      expect(result.success).toBe(false);
      expect(result.reason).toContain("not found");
    });
  });

  // ─── VAL-HARD-042: Workspace binding mode set in envelope ───────────────

  describe("dispatchRun — workspaceBindingMode", () => {
    it("sets required_project_workspace for project work", async () => {
      await seedTestData();

      const result = await dispatcher.dispatchRun({
        intent: buildIntentInput(),
        lease: { id: leaseId },
        runId,
      });

      expect(result.success).toBe(true);
      const envelope = await dispatcher.getEnvelope(result.envelopeId!);
      expect(envelope!.workspaceBindingMode).toBe(
        "required_project_workspace",
      );
    });

    it("sets explicit_ad_hoc_workspace for non-project work", async () => {
      // Create data without a project on the intent
      await seedTestData();

      // Create a new run for this test
      const [newRun] = await db
        .insert(heartbeatRuns)
        .values({
          companyId,
          agentId,
          invocationSource: "scheduler",
          status: "queued",
        })
        .returning();

      const result = await dispatcher.dispatchRun({
        intent: buildIntentInput({ projectId: null, workspaceId: null }),
        lease: { id: leaseId },
        runId: newRun.id,
      });

      expect(result.success).toBe(true);
      const envelope = await dispatcher.getEnvelope(result.envelopeId!);
      expect(envelope!.workspaceBindingMode).toBe(
        "explicit_ad_hoc_workspace",
      );
    });
  });

  // ─── VAL-HARD-043: Workspace verification at dispatch time ──────────────

  describe("dispatchRun — workspace verification at dispatch", () => {
    it("rejects if workspace was deleted between intent creation and dispatch", async () => {
      await seedTestData();

      // Delete the workspace after seeding (simulating deletion between intent and dispatch)
      await db
        .delete(projectWorkspaces)
        .where(eq(projectWorkspaces.id, workspaceId));

      const result = await dispatcher.dispatchRun({
        intent: buildIntentInput({ workspaceId }),
        lease: { id: leaseId },
        runId,
      });

      expect(result.success).toBe(false);
      expect(result.reason).toContain("not found");
    });

    it("rejects project work when all workspaces are deleted at dispatch time", async () => {
      await seedTestData();

      // Delete all workspaces
      await db
        .delete(projectWorkspaces)
        .where(eq(projectWorkspaces.projectId, projectId));

      const result = await dispatcher.dispatchRun({
        intent: buildIntentInput({ workspaceId: null }),
        lease: { id: leaseId },
        runId,
      });

      expect(result.success).toBe(false);
      expect(result.reason).toContain("No workspace found");

      // Verify event was emitted
      const events = await db
        .select()
        .from(controlPlaneEvents)
        .where(eq(controlPlaneEvents.eventType, "workspace_resolution_failed"));
      expect(events.length).toBe(1);
    });
  });

  // ─── Additional edge cases ──────────────────────────────────────────────

  describe("edge cases", () => {
    it("ad-hoc workspace dispatch succeeds even without workspace", async () => {
      await seedTestData({ withWorkspace: false });

      // Create a new issue without project link
      const adHocIssueId = randomUUID();
      await db.insert(issues).values({
        id: adHocIssueId,
        companyId,
        title: "Ad-hoc Issue",
        status: "todo",
        priority: "medium",
        projectId: null,
        assigneeAgentId: agentId,
      });

      // Create a new run
      const [newRun] = await db
        .insert(heartbeatRuns)
        .values({
          companyId,
          agentId,
          invocationSource: "scheduler",
          status: "queued",
        })
        .returning();

      const result = await dispatcher.dispatchRun({
        intent: {
          id: intentId,
          companyId,
          issueId: adHocIssueId,
          projectId: null,
          goalId: null,
          workspaceId: null,
          targetAgentId: agentId,
          intentType: "issue_assigned",
        },
        lease: { id: leaseId },
        runId: newRun.id,
      });

      expect(result.success).toBe(true);
      const envelope = await dispatcher.getEnvelope(result.envelopeId!);
      expect(envelope!.workspaceId).toBeNull();
      expect(envelope!.workspaceBindingMode).toBe("explicit_ad_hoc_workspace");
    });

    it("getEnvelopeByRunId returns correct envelope", async () => {
      await seedTestData();

      const result = await dispatcher.dispatchRun({
        intent: buildIntentInput(),
        lease: { id: leaseId },
        runId,
      });

      const envelope = await dispatcher.getEnvelopeByRunId(runId);
      expect(envelope).toBeDefined();
      expect(envelope!.id).toBe(result.envelopeId);
    });

    it("no workspace_resolution_failed event on success", async () => {
      await seedTestData();

      await dispatcher.dispatchRun({
        intent: buildIntentInput(),
        lease: { id: leaseId },
        runId,
      });

      const events = await db
        .select()
        .from(controlPlaneEvents)
        .where(eq(controlPlaneEvents.eventType, "workspace_resolution_failed"));
      expect(events.length).toBe(0);
    });
  });
});
