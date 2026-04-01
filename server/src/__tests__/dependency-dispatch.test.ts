import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  agents,
  companies,
  createDb,
  dispatchIntents,
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
import { dependencyService } from "../services/dependency.js";
import { intentQueueService } from "../services/intent-queue.js";
import { schedulerService } from "../services/scheduler.js";
import { projectionService } from "../services/projections.js";
import { eq, and, sql } from "drizzle-orm";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeDB = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres dependency-dispatch tests: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeDB("dependency-aware dispatch", () => {
  let db!: ReturnType<typeof createDb>;
  let depSvc!: ReturnType<typeof dependencyService>;
  let intentQueue!: ReturnType<typeof intentQueueService>;
  let scheduler!: ReturnType<typeof schedulerService>;
  let projection!: ReturnType<typeof projectionService>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  // Shared test data IDs
  let companyId: string;
  let agentId: string;
  let projectId: string;
  let workspaceId: string;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("dependency-dispatch-");
    db = createDb(tempDb.connectionString);
    depSvc = dependencyService(db);
    intentQueue = intentQueueService(db);
    scheduler = schedulerService(db);
    projection = projectionService(db);
  }, 30_000);

  afterEach(async () => {
    await db.execute(sql`TRUNCATE TABLE
      issue_dependencies,
      execution_envelopes,
      execution_leases,
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

  /** Helper: seed company + agent + project + workspace */
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

  /** Helper: create an issue */
  async function createIssue(overrides?: {
    status?: string;
    assigneeAgentId?: string | null;
  }) {
    const id = randomUUID();
    await db.insert(issues).values({
      id,
      companyId,
      projectId,
      title: `Issue ${id.slice(0, 8)}`,
      status: overrides?.status ?? "todo",
      assigneeAgentId: overrides && "assigneeAgentId" in overrides
        ? overrides.assigneeAgentId
        : agentId,
    });
    return id;
  }

  // ================================================================
  // Dependency CRUD (VAL-REL-007)
  // ================================================================
  describe("dependency CRUD", () => {
    it("adds a dependency between two issues", async () => {
      await seedBase();
      const issueA = await createIssue();
      const issueB = await createIssue();

      const result = await depSvc.addDependency(issueA, issueB, companyId);
      expect(result).toBeTruthy();

      const deps = await depSvc.getDependencies(issueA, companyId);
      expect(deps).toHaveLength(1);
      expect(deps[0].dependsOnIssueId).toBe(issueB);
    });

    it("getDependencies returns all deps for an issue", async () => {
      await seedBase();
      const issueA = await createIssue();
      const issueB = await createIssue();
      const issueC = await createIssue();

      await depSvc.addDependency(issueA, issueB, companyId);
      await depSvc.addDependency(issueA, issueC, companyId);

      const deps = await depSvc.getDependencies(issueA, companyId);
      expect(deps).toHaveLength(2);
      const depIds = deps.map((d) => d.dependsOnIssueId).sort();
      expect(depIds).toEqual([issueB, issueC].sort());
    });

    it("getDependents returns all issues depending on a given issue", async () => {
      await seedBase();
      const issueA = await createIssue();
      const issueB = await createIssue();
      const issueC = await createIssue();

      await depSvc.addDependency(issueB, issueA, companyId);
      await depSvc.addDependency(issueC, issueA, companyId);

      const dependents = await depSvc.getDependents(issueA, companyId);
      expect(dependents).toHaveLength(2);
      const dependentIds = dependents.map((d) => d.issueId).sort();
      expect(dependentIds).toEqual([issueB, issueC].sort());
    });

    it("removeDependency removes a dependency", async () => {
      await seedBase();
      const issueA = await createIssue();
      const issueB = await createIssue();

      await depSvc.addDependency(issueA, issueB, companyId);
      const removed = await depSvc.removeDependency(issueA, issueB, companyId);
      expect(removed).toBe(true);

      const deps = await depSvc.getDependencies(issueA, companyId);
      expect(deps).toHaveLength(0);
    });

    it("removeDependency returns false when dep doesn't exist", async () => {
      await seedBase();
      const issueA = await createIssue();
      const issueB = await createIssue();

      const removed = await depSvc.removeDependency(issueA, issueB, companyId);
      expect(removed).toBe(false);
    });

    it("addDependency is idempotent (duplicate is ignored)", async () => {
      await seedBase();
      const issueA = await createIssue();
      const issueB = await createIssue();

      await depSvc.addDependency(issueA, issueB, companyId);
      // Second add should not throw and return null (conflict do nothing)
      const result = await depSvc.addDependency(issueA, issueB, companyId);
      expect(result).toBeNull();

      const deps = await depSvc.getDependencies(issueA, companyId);
      expect(deps).toHaveLength(1);
    });

    it("rejects self-dependency", async () => {
      await seedBase();
      const issueA = await createIssue();

      await expect(
        depSvc.addDependency(issueA, issueA, companyId),
      ).rejects.toThrow(/cannot depend on itself/i);
    });

    it("rejects dependency for non-existent issue", async () => {
      await seedBase();
      const issueA = await createIssue();
      const fakeId = randomUUID();

      await expect(
        depSvc.addDependency(issueA, fakeId, companyId),
      ).rejects.toThrow(/not found/i);
    });

    it("rejects dependency for non-existent source issue", async () => {
      await seedBase();
      const issueB = await createIssue();
      const fakeId = randomUUID();

      await expect(
        depSvc.addDependency(fakeId, issueB, companyId),
      ).rejects.toThrow(/not found/i);
    });
  });

  // ================================================================
  // Circular dependency detection (VAL-REL-011)
  // ================================================================
  describe("circular dependency detection", () => {
    it("rejects direct circular dependency A→B→A", async () => {
      await seedBase();
      const issueA = await createIssue();
      const issueB = await createIssue();

      await depSvc.addDependency(issueA, issueB, companyId);

      await expect(
        depSvc.addDependency(issueB, issueA, companyId),
      ).rejects.toThrow(/circular/i);
    });

    it("rejects transitive circular dependency A→B→C→A", async () => {
      await seedBase();
      const issueA = await createIssue();
      const issueB = await createIssue();
      const issueC = await createIssue();

      await depSvc.addDependency(issueA, issueB, companyId);
      await depSvc.addDependency(issueB, issueC, companyId);

      await expect(
        depSvc.addDependency(issueC, issueA, companyId),
      ).rejects.toThrow(/circular/i);
    });

    it("allows non-circular dependency graphs (diamond)", async () => {
      await seedBase();
      const issueA = await createIssue();
      const issueB = await createIssue();
      const issueC = await createIssue();
      const issueD = await createIssue();

      // D depends on B and C; B and C depend on A
      // This is a diamond, not circular
      await depSvc.addDependency(issueB, issueA, companyId);
      await depSvc.addDependency(issueC, issueA, companyId);
      await depSvc.addDependency(issueD, issueB, companyId);
      await depSvc.addDependency(issueD, issueC, companyId);

      // All should succeed without circular detection
      const deps = await depSvc.getDependencies(issueD, companyId);
      expect(deps).toHaveLength(2);
    });
  });

  // ================================================================
  // hasUnresolvedDependencies
  // ================================================================
  describe("hasUnresolvedDependencies", () => {
    it("returns false when issue has no dependencies", async () => {
      await seedBase();
      const issueA = await createIssue();

      const blocked = await depSvc.hasUnresolvedDependencies(issueA, companyId);
      expect(blocked).toBe(false);
    });

    it("returns true when dependency is not done", async () => {
      await seedBase();
      const issueA = await createIssue(); // todo
      const issueB = await createIssue(); // todo

      await depSvc.addDependency(issueA, issueB, companyId);

      const blocked = await depSvc.hasUnresolvedDependencies(issueA, companyId);
      expect(blocked).toBe(true);
    });

    it("returns false when all dependencies are done", async () => {
      await seedBase();
      const issueA = await createIssue();
      const issueB = await createIssue({ status: "done" });

      await depSvc.addDependency(issueA, issueB, companyId);

      const blocked = await depSvc.hasUnresolvedDependencies(issueA, companyId);
      expect(blocked).toBe(false);
    });

    it("returns true when some but not all dependencies are done", async () => {
      await seedBase();
      const issueA = await createIssue();
      const issueB = await createIssue({ status: "done" });
      const issueC = await createIssue(); // still todo

      await depSvc.addDependency(issueA, issueB, companyId);
      await depSvc.addDependency(issueA, issueC, companyId);

      const blocked = await depSvc.hasUnresolvedDependencies(issueA, companyId);
      expect(blocked).toBe(true);
    });
  });

  // ================================================================
  // Blocked projection (VAL-REL-008)
  // ================================================================
  describe("blocked_on_dependency projection", () => {
    it("projects blocked_on_dependency when issue has unresolved deps", async () => {
      await seedBase();
      const issueA = await createIssue();
      const issueB = await createIssue(); // not done

      await depSvc.addDependency(issueA, issueB, companyId);

      const proj = await projection.getIssueProjection(issueA);
      expect(proj).toBeTruthy();
      expect(proj!.projectedStatus).toBe("blocked_on_dependency");
    });

    it("projects raw status when all deps are done", async () => {
      await seedBase();
      const issueA = await createIssue();
      const issueB = await createIssue({ status: "done" });

      await depSvc.addDependency(issueA, issueB, companyId);

      const proj = await projection.getIssueProjection(issueA);
      expect(proj).toBeTruthy();
      expect(proj!.projectedStatus).toBe("todo");
    });

    it("projects raw status when issue has no dependencies", async () => {
      await seedBase();
      const issueA = await createIssue();

      const proj = await projection.getIssueProjection(issueA);
      expect(proj).toBeTruthy();
      expect(proj!.projectedStatus).toBe("todo");
    });

    it("projectIssueStatus pure function respects hasUnresolvedDeps flag", () => {
      const issue = {
        id: randomUUID(),
        status: "todo",
        pickupFailCount: 0,
        lastReconciledAt: null,
      };

      const proj = projection.projectIssueStatus(issue, null, null, null, true);
      expect(proj.projectedStatus).toBe("blocked_on_dependency");

      const projNoDeps = projection.projectIssueStatus(issue, null, null, null, false);
      expect(projNoDeps.projectedStatus).toBe("todo");
    });

    it("batch projectIssuesList includes dependency blocking", async () => {
      await seedBase();
      const issueA = await createIssue();
      const issueB = await createIssue(); // not done

      await depSvc.addDependency(issueA, issueB, companyId);

      // Fetch the issue row in the expected shape
      const [issueRow] = await db
        .select({
          id: issues.id,
          status: issues.status,
          executionRunId: issues.executionRunId,
          checkoutRunId: issues.checkoutRunId,
          pickupFailCount: issues.pickupFailCount,
          lastReconciledAt: issues.lastReconciledAt,
        })
        .from(issues)
        .where(eq(issues.id, issueA));

      const projected = await projection.projectIssuesList([issueRow]);
      expect(projected).toHaveLength(1);
      expect(projected[0].projectedStatus).toBe("blocked_on_dependency");
    });
  });

  // ================================================================
  // Scheduler rejects blocked issues (VAL-REL-009)
  // ================================================================
  describe("scheduler rejects intents for blocked issues", () => {
    it("rejects/defers intent for an issue with unresolved dependencies", async () => {
      await seedBase();
      const issueA = await createIssue();
      const issueB = await createIssue(); // not done

      await depSvc.addDependency(issueA, issueB, companyId);

      // Create an intent for the blocked issue
      const intent = await intentQueue.createIntent({
        companyId,
        issueId: issueA,
        projectId,
        targetAgentId: agentId,
        intentType: "issue_assigned",
        priority: 40,
      });

      // Process the intent through the scheduler
      const result = await scheduler.processIntent(intent.id);
      expect(result.admitted).toBe(false);
      expect(result.reason).toBe("blocked on dependency");

      // Intent should be deferred (not rejected) since deps can resolve later
      const updatedIntent = await intentQueue.getIntent(intent.id);
      expect(updatedIntent?.status).toBe("deferred");
    });

    it("admits intent when all dependencies are resolved", async () => {
      await seedBase();
      const issueA = await createIssue();
      const issueB = await createIssue({ status: "done" });

      await depSvc.addDependency(issueA, issueB, companyId);

      const intent = await intentQueue.createIntent({
        companyId,
        issueId: issueA,
        projectId,
        targetAgentId: agentId,
        intentType: "issue_assigned",
        priority: 40,
      });

      const result = await scheduler.processIntent(intent.id);
      expect(result.admitted).toBe(true);
      expect(result.runId).toBeTruthy();
    });

    it("checkAdmission returns blocked_on_dependency for blocked issue", async () => {
      await seedBase();
      const issueA = await createIssue();
      const issueB = await createIssue(); // not done

      await depSvc.addDependency(issueA, issueB, companyId);

      const intent = await intentQueue.createIntent({
        companyId,
        issueId: issueA,
        projectId,
        targetAgentId: agentId,
        intentType: "issue_assigned",
        priority: 40,
      });

      const admission = await scheduler.checkAdmission(intent);
      expect(admission.admitted).toBe(false);
      expect(admission.reason).toBe("blocked on dependency");
    });
  });

  // ================================================================
  // Unblock intent creation (VAL-REL-010)
  // ================================================================
  describe("dependency completion creates dependency_unblocked intent", () => {
    it("creates dependency_unblocked intent when dep becomes done and all deps resolved", async () => {
      await seedBase();
      const issueA = await createIssue(); // depends on B
      const issueB = await createIssue(); // will go to done

      await depSvc.addDependency(issueA, issueB, companyId);

      // Simulate issueB going to done
      await db
        .update(issues)
        .set({ status: "done" })
        .where(eq(issues.id, issueB));

      // Trigger onDependencyCompleted
      const intentIds = await depSvc.onDependencyCompleted(issueB, companyId);
      expect(intentIds).toHaveLength(1);

      // Verify the intent was created correctly
      const intent = await intentQueue.getIntent(intentIds[0]);
      expect(intent).toBeTruthy();
      expect(intent!.intentType).toBe("dependency_unblocked");
      expect(intent!.issueId).toBe(issueA);
      expect(intent!.targetAgentId).toBe(agentId);
      expect(intent!.status).toBe("queued");
      expect(intent!.priority).toBe(30);
    });

    it("does not create intent when dependent issue still has other unresolved deps", async () => {
      await seedBase();
      const issueA = await createIssue(); // depends on B and C
      const issueB = await createIssue(); // will go to done
      const issueC = await createIssue(); // still todo

      await depSvc.addDependency(issueA, issueB, companyId);
      await depSvc.addDependency(issueA, issueC, companyId);

      // Only B goes to done, C still pending
      await db
        .update(issues)
        .set({ status: "done" })
        .where(eq(issues.id, issueB));

      const intentIds = await depSvc.onDependencyCompleted(issueB, companyId);
      expect(intentIds).toHaveLength(0);
    });

    it("creates intents for multiple dependents when they are all unblocked", async () => {
      await seedBase();
      const issueA = await createIssue(); // depends on C
      const issueB = await createIssue(); // depends on C

      // Create a second agent so both issues have different assignees (optional)
      const agentId2 = randomUUID();
      await db.insert(agents).values({
        id: agentId2,
        companyId,
        name: "TestAgent2",
        role: "engineer",
        status: "active",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      });

      await db
        .update(issues)
        .set({ assigneeAgentId: agentId2 })
        .where(eq(issues.id, issueB));

      const issueC = await createIssue(); // will go to done

      await depSvc.addDependency(issueA, issueC, companyId);
      await depSvc.addDependency(issueB, issueC, companyId);

      // C goes to done
      await db
        .update(issues)
        .set({ status: "done" })
        .where(eq(issues.id, issueC));

      const intentIds = await depSvc.onDependencyCompleted(issueC, companyId);
      expect(intentIds).toHaveLength(2);

      // Both intents should be dependency_unblocked
      for (const intentId of intentIds) {
        const intent = await intentQueue.getIntent(intentId);
        expect(intent!.intentType).toBe("dependency_unblocked");
      }
    });

    it("skips dependent issues that are already done/cancelled", async () => {
      await seedBase();
      const issueA = await createIssue({ status: "done" }); // already done
      const issueB = await createIssue(); // will go to done

      await depSvc.addDependency(issueA, issueB, companyId);

      await db
        .update(issues)
        .set({ status: "done" })
        .where(eq(issues.id, issueB));

      const intentIds = await depSvc.onDependencyCompleted(issueB, companyId);
      expect(intentIds).toHaveLength(0);
    });

    it("skips dependent issues with no assignee", async () => {
      await seedBase();
      const issueA = await createIssue({ assigneeAgentId: null });
      const issueB = await createIssue();

      await depSvc.addDependency(issueA, issueB, companyId);

      await db
        .update(issues)
        .set({ status: "done" })
        .where(eq(issues.id, issueB));

      const intentIds = await depSvc.onDependencyCompleted(issueB, companyId);
      expect(intentIds).toHaveLength(0);
    });
  });

  // ================================================================
  // End-to-end: dependency unblock → scheduler admits
  // ================================================================
  describe("end-to-end dependency flow", () => {
    it("blocked issue can be dispatched after dependency completes", async () => {
      await seedBase();
      const issueA = await createIssue(); // depends on B
      const issueB = await createIssue(); // will go to done

      await depSvc.addDependency(issueA, issueB, companyId);

      // Verify issueA is blocked
      const projBefore = await projection.getIssueProjection(issueA);
      expect(projBefore!.projectedStatus).toBe("blocked_on_dependency");

      // Complete issueB
      await db
        .update(issues)
        .set({ status: "done" })
        .where(eq(issues.id, issueB));

      // Create unblock intents
      const intentIds = await depSvc.onDependencyCompleted(issueB, companyId);
      expect(intentIds).toHaveLength(1);

      // Verify issueA is no longer blocked
      const projAfter = await projection.getIssueProjection(issueA);
      expect(projAfter!.projectedStatus).toBe("todo");

      // Scheduler should now admit the unblock intent
      const result = await scheduler.processIntent(intentIds[0]);
      expect(result.admitted).toBe(true);
      expect(result.runId).toBeTruthy();
    });
  });
});
