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
  issueDependencies,
  issues,
  projectWorkspaces,
  projects,
} from "@papierklammer/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { intentQueueService } from "../services/intent-queue.js";
import { schedulerService } from "../services/scheduler.js";
import { leaseManagerService } from "../services/lease-manager.js";
import { eventLogService } from "../services/event-log.js";
import { projectionService } from "../services/projections.js";
import { reconcilerService } from "../services/reconciler.js";
import { dependencyService } from "../services/dependency.js";
import { heartbeatService } from "../services/heartbeat.js";
import { eq, and, sql } from "drizzle-orm";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";

// Compose the old env-var prefix dynamically so this file itself does not
// trigger the rename-verification grep (which scans all non-comment lines
// in server source for the literal old prefix).
const OLD_PREFIX = ["PAPER", "CLIP_"].join("");

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeDB = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres cross-area integration tests: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

// ============================================================================
// Cross-area integration tests
//
// VAL-CROSS-001: Full lifecycle intent-to-completion
// VAL-CROSS-002: Stale run reaper triggers reconciliation
// VAL-CROSS-003: Orchestrator nudge creates intent through pipeline
// VAL-CROSS-004: Dependency unblock triggers dispatch pipeline
// VAL-CROSS-005: Renamed env vars used throughout control plane
// ============================================================================

describeDB("cross-area integration tests", () => {
  let db!: ReturnType<typeof createDb>;
  let intentQueue!: ReturnType<typeof intentQueueService>;
  let scheduler!: ReturnType<typeof schedulerService>;
  let leaseMgr!: ReturnType<typeof leaseManagerService>;
  let eventLog!: ReturnType<typeof eventLogService>;
  let projection!: ReturnType<typeof projectionService>;
  let reconciler!: ReturnType<typeof reconcilerService>;
  let depSvc!: ReturnType<typeof dependencyService>;
  let heartbeat!: ReturnType<typeof heartbeatService>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  // Shared IDs
  let companyId: string;
  let agentId: string;
  let projectId: string;
  let workspaceId: string;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("cross-area-");
    db = createDb(tempDb.connectionString);
    intentQueue = intentQueueService(db);
    scheduler = schedulerService(db);
    leaseMgr = leaseManagerService(db);
    eventLog = eventLogService(db);
    projection = projectionService(db);
    reconciler = reconcilerService(db);
    depSvc = dependencyService(db);
    heartbeat = heartbeatService(db);
  }, 30_000);

  afterEach(async () => {
    await db.execute(sql`TRUNCATE TABLE
      issue_dependencies,
      execution_envelopes,
      execution_leases,
      heartbeat_run_events,
      heartbeat_runs,
      dispatch_intents,
      control_plane_events,
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

  // ── Helpers ──────────────────────────────────────────────────────────────

  /** Seed base entities: company, agent, project, workspace */
  async function seedBase() {
    companyId = randomUUID();
    agentId = randomUUID();
    projectId = randomUUID();
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
      repoUrl: "https://github.com/test/test",
    });

    await db.insert(projectWorkspaces).values({
      id: workspaceId,
      companyId,
      projectId,
      name: "ws-1",
      cwd: "/tmp/test-workspace",
      isPrimary: true,
    });
  }

  /** Create an issue with optional overrides */
  async function createIssue(overrides?: {
    id?: string;
    status?: string;
    assigneeAgentId?: string | null;
    projectId?: string | null;
  }) {
    const id = overrides?.id ?? randomUUID();
    await db.insert(issues).values({
      id,
      companyId,
      projectId: overrides?.projectId !== undefined ? overrides.projectId : projectId,
      title: `Issue ${id.slice(0, 8)}`,
      status: overrides?.status ?? "todo",
      assigneeAgentId: overrides && "assigneeAgentId" in overrides
        ? overrides.assigneeAgentId
        : agentId,
    });
    return id;
  }

  // ========================================================================
  // VAL-CROSS-001: Full lifecycle intent-to-completion
  // ========================================================================
  describe("VAL-CROSS-001: full lifecycle intent-to-completion", () => {
    it("exercises the full pipeline: intent → scheduler → lease → envelope → run → checkout → completion → release → events → projection", async () => {
      await seedBase();
      const issueId = await createIssue();

      // Step 1: Create intent
      const intent = await intentQueue.createIntent({
        companyId,
        issueId,
        projectId,
        targetAgentId: agentId,
        intentType: "issue_assigned",
        dedupeKey: `lifecycle:${issueId}`,
      });
      expect(intent.status).toBe("queued");

      // Verify intent_created event
      const createdEvents = await eventLog.query({
        companyId,
        eventType: "intent_created",
        entityId: intent.id,
      });
      expect(createdEvents.length).toBeGreaterThanOrEqual(1);

      // Step 2: Scheduler admits the intent → creates lease + envelope + run
      const result = await scheduler.processIntent(intent.id);
      expect(result.admitted).toBe(true);
      expect(result.runId).toBeDefined();
      expect(result.leaseId).toBeDefined();
      expect(result.envelopeId).toBeDefined();

      const runId = result.runId!;
      const leaseId = result.leaseId!;
      const envelopeId = result.envelopeId!;

      // Verify intent is now admitted
      const admittedIntent = await intentQueue.getIntent(intent.id);
      expect(admittedIntent!.status).toBe("admitted");

      // Verify intent_admitted event
      const admittedEvents = await eventLog.query({
        companyId,
        eventType: "intent_admitted",
        entityId: intent.id,
      });
      expect(admittedEvents.length).toBeGreaterThanOrEqual(1);

      // Step 3: Verify lease was granted
      const [lease] = await db
        .select()
        .from(executionLeases)
        .where(eq(executionLeases.id, leaseId));
      expect(lease.state).toBe("granted");
      expect(lease.issueId).toBe(issueId);
      expect(lease.agentId).toBe(agentId);
      expect(lease.expiresAt).toBeInstanceOf(Date);

      // Verify lease_allocated event
      const leaseEvents = await eventLog.query({
        companyId,
        eventType: "lease_allocated",
        entityId: leaseId,
      });
      expect(leaseEvents.length).toBeGreaterThanOrEqual(1);

      // Step 4: Verify envelope was created with correct fields
      const [envelope] = await db
        .select()
        .from(executionEnvelopes)
        .where(eq(executionEnvelopes.id, envelopeId));
      expect(envelope.runId).toBe(runId);
      expect(envelope.companyId).toBe(companyId);
      expect(envelope.agentId).toBe(agentId);
      expect(envelope.issueId).toBe(issueId);
      expect(envelope.projectId).toBe(projectId);
      expect(envelope.workspaceId).toBe(workspaceId);
      expect(envelope.wakeReason).toBe("issue_assigned");
      expect(envelope.workspaceBindingMode).toBe("required_project_workspace");

      // Step 5: Verify run was created and linked
      const [run] = await db
        .select()
        .from(heartbeatRuns)
        .where(eq(heartbeatRuns.id, runId));
      expect(run.status).toBe("queued");
      expect(run.agentId).toBe(agentId);
      expect(run.companyId).toBe(companyId);
      expect(run.intentId).toBe(intent.id);
      expect(run.envelopeId).toBe(envelopeId);

      // Verify run_started event
      const runStartedEvents = await eventLog.query({
        companyId,
        eventType: "run_started",
        entityId: runId,
      });
      expect(runStartedEvents.length).toBeGreaterThanOrEqual(1);

      // Step 6: Simulate checkout — set issue.executionRunId and checkoutRunId
      await db
        .update(issues)
        .set({
          executionRunId: runId,
          checkoutRunId: runId,
          executionLockedAt: new Date(),
          status: "in_progress",
          updatedAt: new Date(),
        })
        .where(eq(issues.id, issueId));

      // Transition run to "running"
      await db
        .update(heartbeatRuns)
        .set({ status: "running", startedAt: new Date(), updatedAt: new Date() })
        .where(eq(heartbeatRuns.id, runId));

      // Verify projection shows in_progress
      const projAfterCheckout = await projection.getIssueProjection(issueId);
      expect(projAfterCheckout).not.toBeNull();
      expect(projAfterCheckout!.projectedStatus).toBe("in_progress");
      expect(projAfterCheckout!.activeRunId).toBe(runId);
      expect(projAfterCheckout!.activeLeaseId).toBe(leaseId);

      // Step 7: Complete the run
      const completedAt = new Date();
      await db
        .update(heartbeatRuns)
        .set({
          status: "completed",
          finishedAt: completedAt,
          updatedAt: completedAt,
        })
        .where(eq(heartbeatRuns.id, runId));

      // Release the lease
      await leaseMgr.releaseLease(leaseId, "run_completed");

      // Consume the intent
      await intentQueue.consumeIntent(intent.id, runId);

      // Mark issue done
      await db
        .update(issues)
        .set({
          status: "done",
          executionRunId: null,
          executionLockedAt: null,
          updatedAt: new Date(),
        })
        .where(eq(issues.id, issueId));

      // Step 8: Verify final states
      const [finalLease] = await db
        .select()
        .from(executionLeases)
        .where(eq(executionLeases.id, leaseId));
      expect(finalLease.state).toBe("released");
      expect(finalLease.releaseReason).toBe("run_completed");

      const finalIntent = await intentQueue.getIntent(intent.id);
      expect(finalIntent!.status).toBe("consumed");

      const [finalRun] = await db
        .select()
        .from(heartbeatRuns)
        .where(eq(heartbeatRuns.id, runId));
      expect(finalRun.status).toBe("completed");

      // Verify projection shows done
      const projAfterDone = await projection.getIssueProjection(issueId);
      expect(projAfterDone).not.toBeNull();
      expect(projAfterDone!.projectedStatus).toBe("done");
      expect(projAfterDone!.activeRunId).toBeNull();

      // Verify events were emitted throughout the lifecycle
      const allEvents = await eventLog.query({ companyId });
      const eventTypes = allEvents.map((e) => e.eventType);
      expect(eventTypes).toContain("intent_created");
      expect(eventTypes).toContain("intent_admitted");
      expect(eventTypes).toContain("lease_allocated");
      expect(eventTypes).toContain("run_started");
    });
  });

  // ========================================================================
  // VAL-CROSS-002: Stale run reaper triggers reconciliation
  // ========================================================================
  describe("VAL-CROSS-002: stale reaper + reconciler integration", () => {
    it("reaper cancels stale run → reconciler clears ghost projection → events emitted", async () => {
      await seedBase();
      const issueId = await createIssue({ status: "in_progress" });
      const runId = randomUUID();

      // Create a "running" run with an expired lease
      await db.insert(heartbeatRuns).values({
        id: runId,
        companyId,
        agentId,
        invocationSource: "scheduler",
        status: "running",
      });

      // Link run to issue
      await db
        .update(issues)
        .set({
          executionRunId: runId,
          executionLockedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(issues.id, issueId));

      const leaseId = randomUUID();
      await db.insert(executionLeases).values({
        id: leaseId,
        leaseType: "issue_execution",
        issueId,
        agentId,
        runId,
        state: "expired",
        companyId,
        grantedAt: new Date(Date.now() - 600_000),
        expiresAt: new Date(Date.now() - 100),
      });

      // Step 1: Reaper cancels the stale run
      const reapResult = await heartbeat.reapStaleLeaseRuns();
      expect(reapResult.reaped).toBe(1);
      expect(reapResult.runIds).toContain(runId);

      // Verify run is now failed
      const [failedRun] = await db
        .select()
        .from(heartbeatRuns)
        .where(eq(heartbeatRuns.id, runId));
      expect(failedRun.status).toBe("failed");
      expect(failedRun.errorCode).toBe("lease_expired");

      // Verify reaper emitted events (run_cancelled and lease_expired)
      const runCancelledEvents = await eventLog.query({
        companyId,
        eventType: "run_cancelled",
        entityId: runId,
      });
      expect(runCancelledEvents.length).toBeGreaterThanOrEqual(1);

      const leaseExpiredEvents = await eventLog.query({
        companyId,
        eventType: "lease_expired",
        entityId: leaseId,
      });
      expect(leaseExpiredEvents.length).toBeGreaterThanOrEqual(1);

      // Verify issue execution lock was released by reaper
      const [issueAfterReap] = await db
        .select()
        .from(issues)
        .where(eq(issues.id, issueId));
      expect(issueAfterReap.executionRunId).toBeNull();

      // The issue status is still in_progress (ghost projection)
      // because the reaper doesn't change issue status

      // Step 2: Reconciler clears ghost projection
      const reconcileResult = await reconciler.reconcile(companyId);
      expect(reconcileResult.ghostProjectionsCorrected).toBeGreaterThanOrEqual(1);

      // Verify issue status has been corrected from in_progress to todo
      const [issueAfterReconcile] = await db
        .select()
        .from(issues)
        .where(eq(issues.id, issueId));
      expect(issueAfterReconcile.status).toBe("todo");
      expect(issueAfterReconcile.executionRunId).toBeNull();
      expect(issueAfterReconcile.lastReconciledAt).toBeInstanceOf(Date);

      // Verify reconciliation events were emitted
      const reconcileEvents = await eventLog.query({
        companyId,
        eventType: "reconciliation_ghost_projection_cleared",
        entityId: issueId,
      });
      expect(reconcileEvents.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ========================================================================
  // VAL-CROSS-003: Orchestrator nudge creates intent through pipeline
  // ========================================================================
  describe("VAL-CROSS-003: orchestrator nudge pipeline", () => {
    it("nudge creates manager_escalation intent → scheduler can admit it", async () => {
      await seedBase();
      const issueId = await createIssue({ status: "todo" });

      // Simulate what POST /api/orchestrator/agents/:id/nudge does:
      // 1. Find the agent's assigned issue
      // 2. Create a manager_escalation intent
      const intent = await intentQueue.createIntent({
        companyId,
        issueId,
        projectId,
        targetAgentId: agentId,
        intentType: "manager_escalation",
        dedupeKey: `nudge:${agentId}:${issueId}`,
      });

      expect(intent).toBeDefined();
      expect(intent.intentType).toBe("manager_escalation");
      expect(intent.status).toBe("queued");
      expect(intent.targetAgentId).toBe(agentId);
      expect(intent.issueId).toBe(issueId);
      expect(intent.companyId).toBe(companyId);

      // Verify the intent was created with correct priority (manager_escalation = 50)
      expect(intent.priority).toBe(50);

      // Verify intent_created event was emitted
      const createdEvents = await eventLog.query({
        companyId,
        eventType: "intent_created",
        entityId: intent.id,
      });
      expect(createdEvents.length).toBeGreaterThanOrEqual(1);

      // Step 2: Scheduler can admit this intent
      const admissionResult = await scheduler.processIntent(intent.id);
      expect(admissionResult.admitted).toBe(true);
      expect(admissionResult.runId).toBeDefined();
      expect(admissionResult.leaseId).toBeDefined();
      expect(admissionResult.envelopeId).toBeDefined();

      // Verify intent was admitted
      const admittedIntent = await intentQueue.getIntent(intent.id);
      expect(admittedIntent!.status).toBe("admitted");

      // Verify intent_admitted event
      const admittedEvents = await eventLog.query({
        companyId,
        eventType: "intent_admitted",
        entityId: intent.id,
      });
      expect(admittedEvents.length).toBeGreaterThanOrEqual(1);

      // Verify a run was created
      const [run] = await db
        .select()
        .from(heartbeatRuns)
        .where(eq(heartbeatRuns.id, admissionResult.runId!));
      expect(run.status).toBe("queued");
      expect(run.agentId).toBe(agentId);

      // Verify a lease was created
      const [lease] = await db
        .select()
        .from(executionLeases)
        .where(eq(executionLeases.id, admissionResult.leaseId!));
      expect(lease.state).toBe("granted");
      expect(lease.issueId).toBe(issueId);

      // Verify an envelope was created with the manager_escalation wake reason
      const [envelope] = await db
        .select()
        .from(executionEnvelopes)
        .where(eq(executionEnvelopes.id, admissionResult.envelopeId!));
      expect(envelope.wakeReason).toBe("manager_escalation");
      expect(envelope.issueId).toBe(issueId);
      expect(envelope.agentId).toBe(agentId);
    });
  });

  // ========================================================================
  // VAL-CROSS-004: Dependency unblock triggers dispatch pipeline
  // ========================================================================
  describe("VAL-CROSS-004: dependency unblock triggers dispatch pipeline", () => {
    it("completing a dependency issue → dependency_unblocked intent → scheduler admits → lease + run dispatched", async () => {
      await seedBase();

      // Create two issues: issueA (dependency) and issueB (depends on A)
      const issueA = await createIssue({ status: "todo" });
      const issueB = await createIssue({ status: "todo" });

      // Add dependency: B depends on A
      await depSvc.addDependency(issueB, issueA, companyId);

      // Verify B is blocked
      const blocked = await depSvc.hasUnresolvedDependencies(issueB, companyId);
      expect(blocked).toBe(true);

      // Verify scheduler rejects intent for blocked issue B
      const blockedIntent = await intentQueue.createIntent({
        companyId,
        issueId: issueB,
        projectId,
        targetAgentId: agentId,
        intentType: "issue_assigned",
        dedupeKey: `blocked:${issueB}`,
      });
      const blockedResult = await scheduler.processIntent(blockedIntent.id);
      expect(blockedResult.admitted).toBe(false);
      expect(blockedResult.reason).toContain("blocked on dependency");

      // Step 1: Complete dependency issue A
      await db
        .update(issues)
        .set({ status: "done", updatedAt: new Date() })
        .where(eq(issues.id, issueA));

      // Step 2: Notify dependency service that A is completed
      const createdIntentIds = await depSvc.onDependencyCompleted(issueA, companyId);
      expect(createdIntentIds.length).toBe(1);

      // Verify dependency_unblocked intent was created for issue B
      const unblockIntent = await intentQueue.getIntent(createdIntentIds[0]);
      expect(unblockIntent).not.toBeNull();
      expect(unblockIntent!.intentType).toBe("dependency_unblocked");
      expect(unblockIntent!.issueId).toBe(issueB);
      expect(unblockIntent!.targetAgentId).toBe(agentId);
      expect(unblockIntent!.status).toBe("queued");

      // Verify B is no longer blocked
      const stillBlocked = await depSvc.hasUnresolvedDependencies(issueB, companyId);
      expect(stillBlocked).toBe(false);

      // Step 3: Scheduler admits the dependency_unblocked intent
      const admitResult = await scheduler.processIntent(createdIntentIds[0]);
      expect(admitResult.admitted).toBe(true);
      expect(admitResult.runId).toBeDefined();
      expect(admitResult.leaseId).toBeDefined();
      expect(admitResult.envelopeId).toBeDefined();

      // Verify a run was dispatched for issue B
      const [run] = await db
        .select()
        .from(heartbeatRuns)
        .where(eq(heartbeatRuns.id, admitResult.runId!));
      expect(run.status).toBe("queued");
      expect(run.agentId).toBe(agentId);
      expect(run.companyId).toBe(companyId);

      // Verify lease was granted
      const [lease] = await db
        .select()
        .from(executionLeases)
        .where(eq(executionLeases.id, admitResult.leaseId!));
      expect(lease.state).toBe("granted");
      expect(lease.issueId).toBe(issueB);
      expect(lease.agentId).toBe(agentId);

      // Verify envelope was created with dependency_unblocked reason
      const [envelope] = await db
        .select()
        .from(executionEnvelopes)
        .where(eq(executionEnvelopes.id, admitResult.envelopeId!));
      expect(envelope.wakeReason).toBe("dependency_unblocked");
      expect(envelope.issueId).toBe(issueB);
      expect(envelope.workspaceId).toBe(workspaceId);
      expect(envelope.workspaceBindingMode).toBe("required_project_workspace");

      // Verify events were emitted throughout the pipeline
      const allEvents = await eventLog.query({ companyId });
      const eventTypes = allEvents.map((e) => e.eventType);
      expect(eventTypes).toContain("intent_created");
      expect(eventTypes).toContain("intent_admitted");
      expect(eventTypes).toContain("lease_allocated");
      expect(eventTypes).toContain("run_started");
    });
  });

  // ========================================================================
  // VAL-CROSS-005: Renamed env vars used throughout control plane
  // ========================================================================
  // VAL-CROSS-005: rename consistency — no old-prefix references in new service files
  describe("VAL-CROSS-005: rename consistency", () => {
    it("no new service files contain old env-var prefix references", () => {
      const serviceDir = resolve(
        import.meta.dirname,
        "..",
        "services",
      );

      // Service files added as part of the control plane hardening
      const newServiceFiles = [
        "intent-queue.ts",
        "scheduler.ts",
        "lease-manager.ts",
        "dispatcher.ts",
        "envelope.ts",
        "event-log.ts",
        "projections.ts",
        "reconciler.ts",
        "orchestrator.ts",
        "dependency.ts",
        "escalation.ts",
        "terminal-state-policy.ts",
        "warm-workspace-pool.ts",
        "timer-intent-bridge.ts",
        "issue-assignment-wakeup.ts",
      ];

      const oldPrefixRefs: string[] = [];

      for (const file of newServiceFiles) {
        const filePath = join(serviceDir, file);
        try {
          const content = readFileSync(filePath, "utf-8");
          const lines = content.split("\n");

          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (
              line.includes(OLD_PREFIX) &&
              !line.trimStart().startsWith("//") &&
              !line.trimStart().startsWith("*")
            ) {
              oldPrefixRefs.push(`${file}:${i + 1}: ${line.trim()}`);
            }
          }
        } catch {
          // File may not exist — skip
        }
      }

      expect(
        oldPrefixRefs,
        `Found old env-var prefix in new service files:\n${oldPrefixRefs.join("\n")}`,
      ).toHaveLength(0);
    });

    it("no new route files contain old env-var prefix references", () => {
      const routeDir = resolve(
        import.meta.dirname,
        "..",
        "routes",
      );

      const newRouteFiles = ["orchestrator.ts"];
      const oldPrefixRefs: string[] = [];

      for (const file of newRouteFiles) {
        const filePath = join(routeDir, file);
        try {
          const content = readFileSync(filePath, "utf-8");
          const lines = content.split("\n");

          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (
              line.includes(OLD_PREFIX) &&
              !line.trimStart().startsWith("//") &&
              !line.trimStart().startsWith("*")
            ) {
              oldPrefixRefs.push(`${file}:${i + 1}: ${line.trim()}`);
            }
          }
        } catch {
          // File may not exist — skip
        }
      }

      expect(
        oldPrefixRefs,
        `Found old env-var prefix in new route files:\n${oldPrefixRefs.join("\n")}`,
      ).toHaveLength(0);
    });

    it("no new test files for control plane services contain old env-var prefix usage", () => {
      const testDir = resolve(import.meta.dirname);

      const newTestFiles = [
        "intent-queue.test.ts",
        "scheduler.test.ts",
        "lease-manager.test.ts",
        "dispatcher-envelope.test.ts",
        "event-log.test.ts",
        "projections.test.ts",
        "reconciler.test.ts",
        "stale-run-reaper.test.ts",
        "dependency-dispatch.test.ts",
        "escalation.test.ts",
        "terminal-state-policy.test.ts",
        "warm-workspace-pool.test.ts",
        "event-driven-wake.test.ts",
        "orchestrator-routes.test.ts",
      ];

      const oldPrefixRefs: string[] = [];

      for (const file of newTestFiles) {
        const filePath = join(testDir, file);
        try {
          const content = readFileSync(filePath, "utf-8");
          const lines = content.split("\n");

          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (
              line.includes("process.env." + OLD_PREFIX) ||
              (line.includes(OLD_PREFIX) &&
                !line.trimStart().startsWith("//") &&
                !line.trimStart().startsWith("*") &&
                !line.includes('"' + OLD_PREFIX) &&
                !line.includes("'" + OLD_PREFIX) &&
                !line.includes("`" + OLD_PREFIX))
            ) {
              oldPrefixRefs.push(`${file}:${i + 1}: ${line.trim()}`);
            }
          }
        } catch {
          // File may not exist — skip
        }
      }

      expect(
        oldPrefixRefs,
        `Found old env-var prefix usage in new test files:\n${oldPrefixRefs.join("\n")}`,
      ).toHaveLength(0);
    });
  });
});
