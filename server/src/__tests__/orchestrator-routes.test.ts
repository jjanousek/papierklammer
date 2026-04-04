import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "../middleware/index.js";
import { orchestratorRoutes } from "../routes/orchestrator.js";

// ── Mock services ──────────────────────────────────────────────────────────────

const mockIssueService = vi.hoisted(() => ({
  create: vi.fn(),
  getById: vi.fn(),
  update: vi.fn(),
}));

const mockIntentQueueService = vi.hoisted(() => ({
  createIntent: vi.fn(),
  invalidateForClosedIssue: vi.fn(),
  rejectIntent: vi.fn(),
}));

const mockLeaseManagerService = vi.hoisted(() => ({
  getActiveLease: vi.fn(),
  releaseLease: vi.fn(),
}));

const mockOrchestratorService = vi.hoisted(() => ({
  getAgentOverviews: vi.fn(),
  getStaleItems: vi.fn(),
  findStaleRunsForCleanup: vi.fn(),
  cancelRun: vi.fn(),
  findStaleIntentsForCleanup: vi.fn(),
  getAgent: vi.fn(),
  findAgentAssignedIssue: vi.fn(),
  clearIssueLock: vi.fn(),
}));

// ── Module mocks ───────────────────────────────────────────────────────────────

vi.mock("../services/index.js", () => ({
  issueService: () => mockIssueService,
}));

vi.mock("../services/intent-queue.js", () => ({
  intentQueueService: () => mockIntentQueueService,
}));

vi.mock("../services/lease-manager.js", () => ({
  leaseManagerService: () => mockLeaseManagerService,
}));

vi.mock("../services/orchestrator.js", () => ({
  orchestratorService: () => mockOrchestratorService,
}));

// ── Helpers ────────────────────────────────────────────────────────────────────

const COMPANY_ID = "00000000-0000-0000-0000-000000000001";
const AGENT_ID = "00000000-0000-0000-0000-000000000010";
const ISSUE_ID = "00000000-0000-0000-0000-000000000020";
const LEASE_ID = "00000000-0000-0000-0000-000000000030";
const PROJECT_ID = "00000000-0000-0000-0000-000000000040";

function createApp(actor?: any) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.actor = actor ?? {
      type: "board",
      userId: "local-board",
      source: "local_implicit",
      isInstanceAdmin: true,
    };
    next();
  });
  app.use("/api", orchestratorRoutes({} as any));
  app.use(errorHandler);
  return app;
}

function createUnauthApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.actor = { type: "none", source: "none" };
    next();
  });
  app.use("/api", orchestratorRoutes({} as any));
  app.use(errorHandler);
  return app;
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("orchestrator routes", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Auth checks — all endpoints require board-level auth
  // ──────────────────────────────────────────────────────────────────────────
  describe("authentication", () => {
    it("GET /api/orchestrator/status returns 403 without board auth", async () => {
      const res = await request(createUnauthApp())
        .get(`/api/orchestrator/status?companyId=${COMPANY_ID}`);
      expect(res.status).toBe(403);
    });

    it("GET /api/orchestrator/stale returns 403 without board auth", async () => {
      const res = await request(createUnauthApp())
        .get(`/api/orchestrator/stale?companyId=${COMPANY_ID}`);
      expect(res.status).toBe(403);
    });

    it("POST /api/orchestrator/issues returns 403 without board auth", async () => {
      const res = await request(createUnauthApp())
        .post("/api/orchestrator/issues")
        .send({ companyId: COMPANY_ID, title: "Test" });
      expect(res.status).toBe(403);
    });

    it("PATCH /api/orchestrator/issues/:id/priority returns 403 without board auth", async () => {
      const res = await request(createUnauthApp())
        .patch(`/api/orchestrator/issues/${ISSUE_ID}/priority`)
        .send({ priority: "high" });
      expect(res.status).toBe(403);
    });

    it("POST /api/orchestrator/issues/:id/unblock returns 403 without board auth", async () => {
      const res = await request(createUnauthApp())
        .post(`/api/orchestrator/issues/${ISSUE_ID}/unblock`)
        .send({});
      expect(res.status).toBe(403);
    });

    it("DELETE /api/orchestrator/stale/runs returns 403 without board auth", async () => {
      const res = await request(createUnauthApp())
        .delete(`/api/orchestrator/stale/runs?companyId=${COMPANY_ID}`);
      expect(res.status).toBe(403);
    });

    it("DELETE /api/orchestrator/stale/intents returns 403 without board auth", async () => {
      const res = await request(createUnauthApp())
        .delete(`/api/orchestrator/stale/intents?companyId=${COMPANY_ID}`);
      expect(res.status).toBe(403);
    });

    it("POST /api/orchestrator/agents/:id/nudge returns 403 without board auth", async () => {
      const res = await request(createUnauthApp())
        .post(`/api/orchestrator/agents/${AGENT_ID}/nudge`)
        .send({});
      expect(res.status).toBe(403);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // GET /api/orchestrator/status
  // ──────────────────────────────────────────────────────────────────────────
  describe("GET /api/orchestrator/status", () => {
    it("returns agent overview with counts", async () => {
      mockOrchestratorService.getAgentOverviews.mockResolvedValue({
        agents: [
          { agentId: AGENT_ID, name: "Agent Alpha", status: "idle", activeRunCount: 2, queuedIntentCount: 3 },
        ],
        totalActiveLeases: 1,
        activeRuns: [
          {
            runId: "run-live-1",
            status: "running",
            agentId: AGENT_ID,
            agentName: "Agent Alpha",
            issueId: ISSUE_ID,
            issueIdentifier: "ISS-1",
            createdAt: new Date("2026-04-05T10:00:00.000Z"),
            startedAt: new Date("2026-04-05T10:00:00.000Z"),
            finishedAt: null,
            resultSummaryText: "Preparing report output",
            stdoutExcerpt: "working…",
            stderrExcerpt: null,
          },
        ],
        recentRuns: [],
      });

      const res = await request(createApp())
        .get(`/api/orchestrator/status?companyId=${COMPANY_ID}`);

      expect(res.status).toBe(200);
      expect(res.body.agents).toHaveLength(1);
      expect(res.body.agents[0]).toEqual({
        agentId: AGENT_ID,
        name: "Agent Alpha",
        status: "idle",
        activeRunCount: 2,
        queuedIntentCount: 3,
      });
      expect(res.body.totalActiveRuns).toBe(2);
      expect(res.body.totalQueuedIntents).toBe(3);
      expect(res.body.totalActiveLeases).toBe(1);
      expect(res.body.activeRuns).toHaveLength(1);
      expect(res.body.activeRuns[0]).toMatchObject({
        runId: "run-live-1",
        issueId: ISSUE_ID,
        issueIdentifier: "ISS-1",
        resultSummaryText: "Preparing report output",
      });
      expect(res.body.recentRuns).toEqual([]);
    });

    it("requires companyId query parameter", async () => {
      const res = await request(createApp())
        .get("/api/orchestrator/status");
      expect(res.status).toBe(400);
    });

    it("rejects board users without access to the requested company", async () => {
      const limitedBoard = {
        type: "board",
        userId: "user-2",
        companyIds: ["00000000-0000-0000-0000-000000000099"],
        source: "session",
        isInstanceAdmin: false,
      };

      const res = await request(createApp(limitedBoard))
        .get(`/api/orchestrator/status?companyId=${COMPANY_ID}`);

      expect(res.status).toBe(403);
      expect(mockOrchestratorService.getAgentOverviews).not.toHaveBeenCalled();
    });

    it("returns empty agents when no agents exist", async () => {
      mockOrchestratorService.getAgentOverviews.mockResolvedValue({
        agents: [],
        totalActiveLeases: 0,
        activeRuns: [],
        recentRuns: [],
      });

      const res = await request(createApp())
        .get(`/api/orchestrator/status?companyId=${COMPANY_ID}`);

      expect(res.status).toBe(200);
      expect(res.body.agents).toHaveLength(0);
      expect(res.body.totalActiveRuns).toBe(0);
      expect(res.body.totalQueuedIntents).toBe(0);
      expect(res.body.totalActiveLeases).toBe(0);
    });

    it("computes totals from agent counts", async () => {
      mockOrchestratorService.getAgentOverviews.mockResolvedValue({
        agents: [
          { agentId: "a1", name: "A", status: "idle", activeRunCount: 1, queuedIntentCount: 2 },
          { agentId: "a2", name: "B", status: "running", activeRunCount: 3, queuedIntentCount: 0 },
        ],
        totalActiveLeases: 4,
        activeRuns: [],
        recentRuns: [],
      });

      const res = await request(createApp())
        .get(`/api/orchestrator/status?companyId=${COMPANY_ID}`);

      expect(res.status).toBe(200);
      expect(res.body.totalActiveRuns).toBe(4);
      expect(res.body.totalQueuedIntents).toBe(2);
      expect(res.body.totalActiveLeases).toBe(4);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // GET /api/orchestrator/stale
  // ──────────────────────────────────────────────────────────────────────────
  describe("GET /api/orchestrator/stale", () => {
    it("returns stale runs, intents, and orphaned leases", async () => {
      const pastDate = new Date("2024-01-01T00:00:00Z");
      mockOrchestratorService.getStaleItems.mockResolvedValue({
        staleRuns: [
          { runId: "run-1", agentId: AGENT_ID, startedAt: pastDate, reason: "lease_expired" },
        ],
        staleIntents: [
          { intentId: "intent-1", createdAt: pastDate, reason: "queued_too_long" },
        ],
        orphanedLeases: [
          { leaseId: LEASE_ID, issueId: ISSUE_ID, expiresAt: pastDate },
        ],
      });

      const res = await request(createApp())
        .get(`/api/orchestrator/stale?companyId=${COMPANY_ID}`);

      expect(res.status).toBe(200);
      expect(res.body.staleRuns).toHaveLength(1);
      expect(res.body.staleRuns[0].runId).toBe("run-1");
      expect(res.body.staleRuns[0].reason).toBe("lease_expired");
      expect(res.body.staleIntents).toHaveLength(1);
      expect(res.body.staleIntents[0].intentId).toBe("intent-1");
      expect(res.body.staleIntents[0].reason).toBe("queued_too_long");
      expect(res.body.orphanedLeases).toHaveLength(1);
      expect(res.body.orphanedLeases[0].leaseId).toBe(LEASE_ID);
    });

    it("requires companyId query parameter", async () => {
      const res = await request(createApp())
        .get("/api/orchestrator/stale");
      expect(res.status).toBe(400);
    });

    it("returns empty arrays when nothing is stale", async () => {
      mockOrchestratorService.getStaleItems.mockResolvedValue({
        staleRuns: [],
        staleIntents: [],
        orphanedLeases: [],
      });

      const res = await request(createApp())
        .get(`/api/orchestrator/stale?companyId=${COMPANY_ID}`);

      expect(res.status).toBe(200);
      expect(res.body.staleRuns).toHaveLength(0);
      expect(res.body.staleIntents).toHaveLength(0);
      expect(res.body.orphanedLeases).toHaveLength(0);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // POST /api/orchestrator/issues
  // ──────────────────────────────────────────────────────────────────────────
  describe("POST /api/orchestrator/issues", () => {
    it("creates an issue via the issue service", async () => {
      const createdIssue = {
        id: ISSUE_ID,
        companyId: COMPANY_ID,
        title: "New issue",
        status: "backlog",
        priority: "high",
      };
      mockIssueService.create.mockResolvedValue(createdIssue);

      const res = await request(createApp())
        .post("/api/orchestrator/issues")
        .send({
          companyId: COMPANY_ID,
          title: "New issue",
          description: "Some details",
          assigneeAgentId: AGENT_ID,
          projectId: PROJECT_ID,
          priority: "high",
        });

      expect(res.status).toBe(201);
      expect(res.body.id).toBe(ISSUE_ID);
      expect(mockIssueService.create).toHaveBeenCalledWith(COMPANY_ID, {
        title: "New issue",
        description: "Some details",
        assigneeAgentId: AGENT_ID,
        projectId: PROJECT_ID,
        priority: "high",
      });
    });

    it("rejects missing title", async () => {
      const res = await request(createApp())
        .post("/api/orchestrator/issues")
        .send({ companyId: COMPANY_ID });

      expect(res.status).toBe(400);
      expect(mockIssueService.create).not.toHaveBeenCalled();
    });

    it("rejects missing companyId", async () => {
      const res = await request(createApp())
        .post("/api/orchestrator/issues")
        .send({ title: "No company" });

      expect(res.status).toBe(400);
      expect(mockIssueService.create).not.toHaveBeenCalled();
    });

    it("uses default priority when not specified", async () => {
      const createdIssue = {
        id: ISSUE_ID,
        companyId: COMPANY_ID,
        title: "Defaults",
        status: "backlog",
        priority: "medium",
      };
      mockIssueService.create.mockResolvedValue(createdIssue);

      const res = await request(createApp())
        .post("/api/orchestrator/issues")
        .send({ companyId: COMPANY_ID, title: "Defaults" });

      expect(res.status).toBe(201);
      expect(mockIssueService.create).toHaveBeenCalledWith(COMPANY_ID, {
        title: "Defaults",
        description: null,
        assigneeAgentId: null,
        projectId: null,
        priority: "medium",
      });
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // PATCH /api/orchestrator/issues/:id/priority
  // ──────────────────────────────────────────────────────────────────────────
  describe("PATCH /api/orchestrator/issues/:id/priority", () => {
    it("updates issue priority", async () => {
      const existing = {
        id: ISSUE_ID,
        companyId: COMPANY_ID,
        title: "Test",
        priority: "medium",
      };
      const updated = { ...existing, priority: "urgent" };
      mockIssueService.getById.mockResolvedValue(existing);
      mockIssueService.update.mockResolvedValue(updated);

      const res = await request(createApp())
        .patch(`/api/orchestrator/issues/${ISSUE_ID}/priority`)
        .send({ priority: "urgent" });

      expect(res.status).toBe(200);
      expect(res.body.priority).toBe("urgent");
      expect(mockIssueService.update).toHaveBeenCalledWith(ISSUE_ID, {
        priority: "urgent",
      });
    });

    it("returns 404 for unknown issue", async () => {
      mockIssueService.getById.mockResolvedValue(null);

      const res = await request(createApp())
        .patch(`/api/orchestrator/issues/${ISSUE_ID}/priority`)
        .send({ priority: "high" });

      expect(res.status).toBe(404);
    });

    it("rejects missing priority", async () => {
      const res = await request(createApp())
        .patch(`/api/orchestrator/issues/${ISSUE_ID}/priority`)
        .send({});

      expect(res.status).toBe(400);
    });

    it("rejects empty priority string", async () => {
      const res = await request(createApp())
        .patch(`/api/orchestrator/issues/${ISSUE_ID}/priority`)
        .send({ priority: "" });

      expect(res.status).toBe(400);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // POST /api/orchestrator/issues/:id/unblock
  // ──────────────────────────────────────────────────────────────────────────
  describe("POST /api/orchestrator/issues/:id/unblock", () => {
    it("releases lease, clears lock, rejects intents", async () => {
      const existing = {
        id: ISSUE_ID,
        companyId: COMPANY_ID,
        title: "Blocked",
        executionRunId: "run-1",
        checkoutRunId: "checkout-1",
      };
      const updatedIssue = {
        ...existing,
        executionRunId: null,
        executionLockedAt: null,
      };
      mockIssueService.getById
        .mockResolvedValueOnce(existing)
        .mockResolvedValueOnce(updatedIssue);
      mockLeaseManagerService.getActiveLease.mockResolvedValue({
        id: LEASE_ID,
        state: "granted",
      });
      mockLeaseManagerService.releaseLease.mockResolvedValue({
        id: LEASE_ID,
        state: "released",
      });
      mockOrchestratorService.clearIssueLock.mockResolvedValue(undefined);
      mockIntentQueueService.invalidateForClosedIssue.mockResolvedValue(2);

      const res = await request(createApp())
        .post(`/api/orchestrator/issues/${ISSUE_ID}/unblock`)
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.leaseReleased).toBe(true);
      expect(res.body.rejectedIntents).toBe(2);
      expect(res.body.payload).toBeNull();
      expect(res.body.issue).toBeDefined();
      expect(res.body.recovery).toEqual({
        issueId: ISSUE_ID,
        companyId: COMPANY_ID,
        releasedLeaseId: LEASE_ID,
        clearedExecutionRunId: "run-1",
        clearedCheckoutRunId: "checkout-1",
        rejectedIntentCount: 2,
      });
      expect(mockLeaseManagerService.releaseLease).toHaveBeenCalledWith(
        LEASE_ID,
        "force_unblock",
      );
      expect(mockOrchestratorService.clearIssueLock).toHaveBeenCalledWith(ISSUE_ID);
      expect(mockIntentQueueService.invalidateForClosedIssue).toHaveBeenCalledWith(
        ISSUE_ID,
        COMPANY_ID,
      );
    });

    it("works when no active lease exists", async () => {
      const existing = {
        id: ISSUE_ID,
        companyId: COMPANY_ID,
        title: "No lease",
      };
      const updatedIssue = { ...existing };
      mockIssueService.getById
        .mockResolvedValueOnce(existing)
        .mockResolvedValueOnce(updatedIssue);
      mockLeaseManagerService.getActiveLease.mockResolvedValue(null);
      mockOrchestratorService.clearIssueLock.mockResolvedValue(undefined);
      mockIntentQueueService.invalidateForClosedIssue.mockResolvedValue(0);

      const res = await request(createApp())
        .post(`/api/orchestrator/issues/${ISSUE_ID}/unblock`)
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.leaseReleased).toBe(false);
      expect(res.body.rejectedIntents).toBe(0);
      expect(res.body.recovery.releasedLeaseId).toBeNull();
    });

    it("returns 404 for unknown issue", async () => {
      mockIssueService.getById.mockResolvedValue(null);

      const res = await request(createApp())
        .post(`/api/orchestrator/issues/${ISSUE_ID}/unblock`)
        .send({});

      expect(res.status).toBe(404);
    });

    it("handles concurrent lease release gracefully", async () => {
      const existing = {
        id: ISSUE_ID,
        companyId: COMPANY_ID,
        title: "Race condition",
      };
      mockIssueService.getById
        .mockResolvedValueOnce(existing)
        .mockResolvedValueOnce(existing);
      mockLeaseManagerService.getActiveLease.mockResolvedValue({
        id: LEASE_ID,
        state: "granted",
      });
      // Simulate concurrent release throwing a conflict
      mockLeaseManagerService.releaseLease.mockRejectedValue(
        new Error("Already released"),
      );
      mockOrchestratorService.clearIssueLock.mockResolvedValue(undefined);
      mockIntentQueueService.invalidateForClosedIssue.mockResolvedValue(0);

      const res = await request(createApp())
        .post(`/api/orchestrator/issues/${ISSUE_ID}/unblock`)
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.leaseReleased).toBe(false);
    });

    it("echoes corrective-action payloads for unblock", async () => {
      const existing = {
        id: ISSUE_ID,
        companyId: COMPANY_ID,
        title: "Blocked",
        executionRunId: "run-1",
        checkoutRunId: null,
      };
      mockIssueService.getById
        .mockResolvedValueOnce(existing)
        .mockResolvedValueOnce(existing);
      mockLeaseManagerService.getActiveLease.mockResolvedValue(null);
      mockOrchestratorService.clearIssueLock.mockResolvedValue(undefined);
      mockIntentQueueService.invalidateForClosedIssue.mockResolvedValue(0);

      const res = await request(createApp())
        .post(`/api/orchestrator/issues/${ISSUE_ID}/unblock`)
        .send({
          payload: {
            requestedBy: "operator",
            reason: "lease looks stale",
          },
        });

      expect(res.status).toBe(200);
      expect(res.body.payload).toEqual({
        requestedBy: "operator",
        reason: "lease looks stale",
      });
    });

    it("rejects unexpected unblock request fields instead of silently dropping them", async () => {
      const res = await request(createApp())
        .post(`/api/orchestrator/issues/${ISSUE_ID}/unblock`)
        .send({ note: "please fix this" });

      expect(res.status).toBe(400);
      expect(mockLeaseManagerService.getActiveLease).not.toHaveBeenCalled();
      expect(mockOrchestratorService.clearIssueLock).not.toHaveBeenCalled();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // DELETE /api/orchestrator/stale/runs
  // ──────────────────────────────────────────────────────────────────────────
  describe("DELETE /api/orchestrator/stale/runs", () => {
    it("cancels stale runs and releases leases", async () => {
      mockOrchestratorService.findStaleRunsForCleanup.mockResolvedValue([
        { runId: "run-1", leaseId: "lease-1" },
        { runId: "run-2", leaseId: "lease-2" },
      ]);
      mockOrchestratorService.cancelRun.mockResolvedValue(undefined);
      mockLeaseManagerService.releaseLease.mockResolvedValue({});

      const res = await request(createApp())
        .delete(`/api/orchestrator/stale/runs?companyId=${COMPANY_ID}`);

      expect(res.status).toBe(200);
      expect(res.body.cancelled).toBe(2);
      expect(mockOrchestratorService.cancelRun).toHaveBeenCalledTimes(2);
      expect(mockLeaseManagerService.releaseLease).toHaveBeenCalledTimes(2);
      expect(mockLeaseManagerService.releaseLease).toHaveBeenCalledWith("lease-1", "stale_run_cleanup");
      expect(mockLeaseManagerService.releaseLease).toHaveBeenCalledWith("lease-2", "stale_run_cleanup");
    });

    it("returns 0 cancelled when no stale runs exist", async () => {
      mockOrchestratorService.findStaleRunsForCleanup.mockResolvedValue([]);

      const res = await request(createApp())
        .delete(`/api/orchestrator/stale/runs?companyId=${COMPANY_ID}`);

      expect(res.status).toBe(200);
      expect(res.body.cancelled).toBe(0);
    });

    it("requires companyId query parameter", async () => {
      const res = await request(createApp())
        .delete("/api/orchestrator/stale/runs");
      expect(res.status).toBe(400);
    });

    it("handles lease release failure gracefully", async () => {
      mockOrchestratorService.findStaleRunsForCleanup.mockResolvedValue([
        { runId: "run-1", leaseId: "lease-1" },
      ]);
      mockOrchestratorService.cancelRun.mockResolvedValue(undefined);
      mockLeaseManagerService.releaseLease.mockRejectedValue(new Error("conflict"));

      const res = await request(createApp())
        .delete(`/api/orchestrator/stale/runs?companyId=${COMPANY_ID}`);

      expect(res.status).toBe(200);
      expect(res.body.cancelled).toBe(1);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // DELETE /api/orchestrator/stale/intents
  // ──────────────────────────────────────────────────────────────────────────
  describe("DELETE /api/orchestrator/stale/intents", () => {
    it("rejects stale intents", async () => {
      mockOrchestratorService.findStaleIntentsForCleanup.mockResolvedValue([
        { id: "intent-1" },
        { id: "intent-2" },
        { id: "intent-3" },
      ]);
      mockIntentQueueService.rejectIntent.mockResolvedValue({});

      const res = await request(createApp())
        .delete(`/api/orchestrator/stale/intents?companyId=${COMPANY_ID}`);

      expect(res.status).toBe(200);
      expect(res.body.rejected).toBe(3);
      expect(mockIntentQueueService.rejectIntent).toHaveBeenCalledTimes(3);
      expect(mockIntentQueueService.rejectIntent).toHaveBeenCalledWith("intent-1", "stale_intent_cleanup");
      expect(mockIntentQueueService.rejectIntent).toHaveBeenCalledWith("intent-2", "stale_intent_cleanup");
      expect(mockIntentQueueService.rejectIntent).toHaveBeenCalledWith("intent-3", "stale_intent_cleanup");
    });

    it("returns 0 when no stale intents exist", async () => {
      mockOrchestratorService.findStaleIntentsForCleanup.mockResolvedValue([]);

      const res = await request(createApp())
        .delete(`/api/orchestrator/stale/intents?companyId=${COMPANY_ID}`);

      expect(res.status).toBe(200);
      expect(res.body.rejected).toBe(0);
    });

    it("requires companyId query parameter", async () => {
      const res = await request(createApp())
        .delete("/api/orchestrator/stale/intents");
      expect(res.status).toBe(400);
    });

    it("handles concurrent intent rejection gracefully", async () => {
      mockOrchestratorService.findStaleIntentsForCleanup.mockResolvedValue([
        { id: "intent-1" },
        { id: "intent-2" },
      ]);
      mockIntentQueueService.rejectIntent
        .mockResolvedValueOnce({})
        .mockRejectedValueOnce(new Error("already rejected"));

      const res = await request(createApp())
        .delete(`/api/orchestrator/stale/intents?companyId=${COMPANY_ID}`);

      expect(res.status).toBe(200);
      expect(res.body.rejected).toBe(1);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // POST /api/orchestrator/agents/:id/nudge
  // ──────────────────────────────────────────────────────────────────────────
  describe("POST /api/orchestrator/agents/:id/nudge", () => {
    it("creates a manager_escalation intent for the agent", async () => {
      mockOrchestratorService.getAgent.mockResolvedValue({
        id: AGENT_ID,
        companyId: COMPANY_ID,
        name: "Alpha",
      });
      mockOrchestratorService.findAgentAssignedIssue.mockResolvedValue({
        id: ISSUE_ID,
        projectId: PROJECT_ID,
      });

      const createdIntent = {
        id: "intent-new",
        intentType: "manager_escalation",
        targetAgentId: AGENT_ID,
        issueId: ISSUE_ID,
        status: "queued",
      };
      mockIntentQueueService.createIntent.mockResolvedValue(createdIntent);

      const res = await request(createApp())
        .post(`/api/orchestrator/agents/${AGENT_ID}/nudge`)
        .send({});

      expect(res.status).toBe(201);
      expect(res.body.intentType).toBe("manager_escalation");
      expect(res.body.targetAgentId).toBe(AGENT_ID);
      expect(mockIntentQueueService.createIntent).toHaveBeenCalledWith(
        expect.objectContaining({
          companyId: COMPANY_ID,
          issueId: ISSUE_ID,
          projectId: PROJECT_ID,
          targetAgentId: AGENT_ID,
          intentType: "manager_escalation",
        }),
      );
    });

    it("returns 404 for unknown agent", async () => {
      mockOrchestratorService.getAgent.mockResolvedValue(null);

      const res = await request(createApp())
        .post(`/api/orchestrator/agents/${AGENT_ID}/nudge`)
        .send({});

      expect(res.status).toBe(404);
    });

    it("returns 400 when agent has no assigned issues", async () => {
      mockOrchestratorService.getAgent.mockResolvedValue({
        id: AGENT_ID,
        companyId: COMPANY_ID,
        name: "Alpha",
      });
      mockOrchestratorService.findAgentAssignedIssue.mockResolvedValue(null);

      const res = await request(createApp())
        .post(`/api/orchestrator/agents/${AGENT_ID}/nudge`)
        .send({});

      expect(res.status).toBe(400);
    });

    it("echoes corrective-action payloads for nudge", async () => {
      mockOrchestratorService.getAgent.mockResolvedValue({
        id: AGENT_ID,
        companyId: COMPANY_ID,
        name: "Alpha",
      });
      mockOrchestratorService.findAgentAssignedIssue.mockResolvedValue({
        id: ISSUE_ID,
        projectId: PROJECT_ID,
      });
      mockIntentQueueService.createIntent.mockResolvedValue({
        id: "intent-new",
        intentType: "manager_escalation",
        targetAgentId: AGENT_ID,
        issueId: ISSUE_ID,
        status: "queued",
      });

      const res = await request(createApp())
        .post(`/api/orchestrator/agents/${AGENT_ID}/nudge`)
        .send({
          payload: {
            requestedBy: "operator",
            summary: "Please take another pass",
          },
        });

      expect(res.status).toBe(201);
      expect(res.body.payload).toEqual({
        requestedBy: "operator",
        summary: "Please take another pass",
      });
    });

    it("rejects unexpected nudge request fields instead of silently dropping them", async () => {
      const res = await request(createApp())
        .post(`/api/orchestrator/agents/${AGENT_ID}/nudge`)
        .send({ note: "check in" });

      expect(res.status).toBe(400);
      expect(mockOrchestratorService.getAgent).not.toHaveBeenCalled();
      expect(mockIntentQueueService.createIntent).not.toHaveBeenCalled();
    });

    it("rejects projectless active issues instead of crashing", async () => {
      mockOrchestratorService.getAgent.mockResolvedValue({
        id: AGENT_ID,
        companyId: COMPANY_ID,
        name: "Alpha",
      });
      mockOrchestratorService.findAgentAssignedIssue.mockResolvedValue({
        id: ISSUE_ID,
        projectId: null,
      });

      const res = await request(createApp())
        .post(`/api/orchestrator/agents/${AGENT_ID}/nudge`)
        .send({});

      expect(res.status).toBe(400);
      expect(mockIntentQueueService.createIntent).not.toHaveBeenCalled();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Agent-scoped auth is rejected (agents can't use orchestrator endpoints)
  // ──────────────────────────────────────────────────────────────────────────
  describe("agent auth rejection", () => {
    const agentActor = {
      type: "agent",
      agentId: AGENT_ID,
      companyId: COMPANY_ID,
      source: "agent_key",
    };

    it("rejects agent for GET /api/orchestrator/status", async () => {
      const res = await request(createApp(agentActor))
        .get(`/api/orchestrator/status?companyId=${COMPANY_ID}`);
      expect(res.status).toBe(403);
    });

    it("rejects agent for POST /api/orchestrator/issues", async () => {
      const res = await request(createApp(agentActor))
        .post("/api/orchestrator/issues")
        .send({ companyId: COMPANY_ID, title: "Test" });
      expect(res.status).toBe(403);
    });

    it("rejects agent for DELETE /api/orchestrator/stale/runs", async () => {
      const res = await request(createApp(agentActor))
        .delete(`/api/orchestrator/stale/runs?companyId=${COMPANY_ID}`);
      expect(res.status).toBe(403);
    });

    it("rejects agent for POST /api/orchestrator/agents/:id/nudge", async () => {
      const res = await request(createApp(agentActor))
        .post(`/api/orchestrator/agents/${AGENT_ID}/nudge`)
        .send({});
      expect(res.status).toBe(403);
    });
  });
});
