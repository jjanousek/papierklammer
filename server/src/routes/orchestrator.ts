import { Router } from "express";
import { z } from "zod";
import type { Db } from "@papierklammer/db";
import { validate } from "../middleware/validate.js";
import { assertBoard, assertCompanyAccess } from "./authz.js";
import { issueService } from "../services/index.js";
import { intentQueueService } from "../services/intent-queue.js";
import { leaseManagerService } from "../services/lease-manager.js";
import { orchestratorService } from "../services/orchestrator.js";
import { badRequest, notFound } from "../errors.js";

const createIssueSchema = z.object({
  companyId: z.string().uuid(),
  title: z.string().min(1),
  description: z.string().optional(),
  assigneeAgentId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  priority: z.string().optional(),
});

const updatePrioritySchema = z.object({
  priority: z.string().min(1),
});

const correctiveActionRequestSchema = z
  .object({
    payload: z.record(z.unknown()).optional(),
  })
  .strict();

/**
 * Orchestrator API routes.
 *
 * Provides admin-level endpoints for the orchestrator console:
 * - System status overview
 * - Stale item detection
 * - Issue creation and management
 * - Stale item cleanup
 * - Agent nudging
 *
 * All endpoints require board-level authentication.
 */
export function orchestratorRoutes(db: Db) {
  const router = Router();
  const issueSvc = issueService(db);
  const intentQueue = intentQueueService(db);
  const leaseMgr = leaseManagerService(db);
  const orchSvc = orchestratorService(db);

  /**
   * GET /api/orchestrator/status?companyId=xxx
   *
   * Returns system overview: agent statuses, active run counts,
   * queue depths, and lease counts.
   */
  router.get("/orchestrator/status", async (req, res) => {
    assertBoard(req);
    const companyId = req.query.companyId as string | undefined;
    if (!companyId) {
      throw badRequest("companyId query parameter is required");
    }
    assertCompanyAccess(req, companyId);

    const { agents: agentList, totalActiveLeases } =
      await orchSvc.getAgentOverviews(companyId);

    const totalActiveRuns = agentList.reduce(
      (sum, a) => sum + a.activeRunCount,
      0,
    );
    const totalQueuedIntents = agentList.reduce(
      (sum, a) => sum + a.queuedIntentCount,
      0,
    );

    res.json({
      agents: agentList,
      totalActiveRuns,
      totalQueuedIntents,
      totalActiveLeases,
    });
  });

  /**
   * GET /api/orchestrator/stale?companyId=xxx
   *
   * Returns stale items: runs past TTL, intents queued too long,
   * and leases past expiry not yet reaped.
   */
  router.get("/orchestrator/stale", async (req, res) => {
    assertBoard(req);
    const companyId = req.query.companyId as string | undefined;
    if (!companyId) {
      throw badRequest("companyId query parameter is required");
    }
    assertCompanyAccess(req, companyId);

    const staleItems = await orchSvc.getStaleItems(companyId);
    res.json(staleItems);
  });

  /**
   * POST /api/orchestrator/issues
   *
   * Creates an issue. Delegates to the existing issue service.
   */
  router.post(
    "/orchestrator/issues",
    validate(createIssueSchema),
    async (req, res) => {
      assertBoard(req);
      const { companyId, title, description, assigneeAgentId, projectId, priority } = req.body;
      assertCompanyAccess(req, companyId);

      const issue = await issueSvc.create(companyId, {
        title,
        description: description ?? null,
        assigneeAgentId: assigneeAgentId ?? null,
        projectId: projectId ?? null,
        priority: priority ?? "medium",
      });

      res.status(201).json(issue);
    },
  );

  /**
   * PATCH /api/orchestrator/issues/:id/priority
   *
   * Updates issue priority.
   */
  router.patch(
    "/orchestrator/issues/:id/priority",
    validate(updatePrioritySchema),
    async (req, res) => {
      assertBoard(req);
      const issueId = req.params.id as string;
      const existing = await issueSvc.getById(issueId);
      if (!existing) {
        throw notFound("Issue not found");
      }
      assertCompanyAccess(req, existing.companyId);

      const updated = await issueSvc.update(issueId, {
        priority: req.body.priority,
      });

      res.json(updated);
    },
  );

  /**
   * POST /api/orchestrator/issues/:id/unblock
   *
   * Force-unblocks an issue: releases stale lease, clears
   * executionRunId lock, rejects stale intents.
   */
  router.post(
    "/orchestrator/issues/:id/unblock",
    validate(correctiveActionRequestSchema),
    async (req, res) => {
    assertBoard(req);
    const issueId = req.params.id as string;
    const existing = await issueSvc.getById(issueId);
    if (!existing) {
      throw notFound("Issue not found");
    }
    assertCompanyAccess(req, existing.companyId);
    const payload = req.body.payload ?? null;

    // Release active lease if any
    let leaseReleased = false;
    const activeLease = await leaseMgr.getActiveLease(issueId);
    const activeLeaseId = activeLease?.id ?? null;
    if (activeLease) {
      try {
        await leaseMgr.releaseLease(activeLease.id, "force_unblock");
        leaseReleased = true;
      } catch {
        // Lease may have been concurrently released
      }
    }

    // Clear execution lock on the issue
    await orchSvc.clearIssueLock(issueId);

    // Reject stale queued intents for this issue
    const rejectedIntents = await intentQueue.invalidateForClosedIssue(
      issueId,
      existing.companyId,
    );

    // Re-read the issue to return updated state
    const updated = await issueSvc.getById(issueId);

    res.json({
      issue: updated,
      payload,
      leaseReleased,
      rejectedIntents,
      recovery: {
        issueId,
        companyId: existing.companyId,
        releasedLeaseId: leaseReleased ? activeLeaseId : null,
        clearedExecutionRunId: existing.executionRunId ?? null,
        clearedCheckoutRunId: existing.checkoutRunId ?? null,
        rejectedIntentCount: rejectedIntents,
      },
    });
    },
  );

  /**
   * DELETE /api/orchestrator/stale/runs?companyId=xxx
   *
   * Bulk cancels all stale runs for the company, releases their leases.
   */
  router.delete("/orchestrator/stale/runs", async (req, res) => {
    assertBoard(req);
    const companyId = req.query.companyId as string | undefined;
    if (!companyId) {
      throw badRequest("companyId query parameter is required");
    }
    assertCompanyAccess(req, companyId);

    const staleRuns = await orchSvc.findStaleRunsForCleanup(companyId);

    let cancelled = 0;
    for (const row of staleRuns) {
      await orchSvc.cancelRun(row.runId);

      try {
        await leaseMgr.releaseLease(row.leaseId, "stale_run_cleanup");
      } catch {
        // Lease may have been concurrently modified
      }

      cancelled++;
    }

    res.json({ cancelled });
  });

  /**
   * DELETE /api/orchestrator/stale/intents?companyId=xxx
   *
   * Bulk rejects stale intents (queued > 1 hour).
   */
  router.delete("/orchestrator/stale/intents", async (req, res) => {
    assertBoard(req);
    const companyId = req.query.companyId as string | undefined;
    if (!companyId) {
      throw badRequest("companyId query parameter is required");
    }
    assertCompanyAccess(req, companyId);

    const staleIntents = await orchSvc.findStaleIntentsForCleanup(companyId);

    let rejected = 0;
    for (const row of staleIntents) {
      try {
        await intentQueue.rejectIntent(row.id, "stale_intent_cleanup");
        rejected++;
      } catch {
        // Intent may have been concurrently modified
      }
    }

    res.json({ rejected });
  });

  /**
   * POST /api/orchestrator/agents/:id/nudge
   *
   * Creates a manager_escalation intent for the agent.
   */
  router.post(
    "/orchestrator/agents/:id/nudge",
    validate(correctiveActionRequestSchema),
    async (req, res) => {
    assertBoard(req);
    const agentId = req.params.id as string;
    const payload = req.body.payload ?? null;

    const agent = await orchSvc.getAgent(agentId);
    if (!agent) {
      throw notFound("Agent not found");
    }
    assertCompanyAccess(req, agent.companyId);

    const assignedIssue = await orchSvc.findAgentAssignedIssue(
      agent.companyId,
      agentId,
    );
    if (!assignedIssue?.projectId) {
      throw badRequest("Agent has no active assigned issues with a project to nudge");
    }

    const intent = await intentQueue.createIntent({
      companyId: agent.companyId,
      issueId: assignedIssue.id,
      projectId: assignedIssue.projectId,
      targetAgentId: agentId,
      intentType: "manager_escalation",
      dedupeKey: `nudge:${agentId}:${assignedIssue.id}`,
    });

    res.status(201).json({
      ...intent,
      payload,
    });
    },
  );

  return router;
}
