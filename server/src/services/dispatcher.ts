import { and, eq } from "drizzle-orm";
import type { Db } from "@papierklammer/db";
import {
  controlPlaneEvents,
  heartbeatRuns,
  issues,
  projectWorkspaces,
  projects,
} from "@papierklammer/db";
import { envelopeService, type CreateEnvelopeInput } from "./envelope.js";
import { badRequest } from "../errors.js";
import { logger } from "../middleware/logger.js";

/**
 * Workspace binding modes.
 *
 * - required_project_workspace: Workspace must be resolved from the
 *   issue→project→workspace chain. If resolution fails, the run is
 *   rejected (no fallback to agent_home).
 * - explicit_ad_hoc_workspace: Ad-hoc workspace, no strict project binding.
 */
export type WorkspaceBindingMode =
  | "required_project_workspace"
  | "explicit_ad_hoc_workspace";

export interface DispatchRunInput {
  intent: {
    id: string;
    companyId: string;
    issueId: string;
    projectId: string | null;
    goalId: string | null;
    workspaceId: string | null;
    targetAgentId: string;
    intentType: string;
  };
  lease: {
    id: string;
  };
  /** Pre-created heartbeat_run ID for linking */
  runId: string;
}

export interface DispatchRunResult {
  success: boolean;
  envelopeId?: string;
  reason?: string;
}

/**
 * Dispatcher service.
 *
 * Resolves workspace from issue→project→workspace chain, creates an
 * immutable execution envelope, and links it to the heartbeat run.
 *
 * For project work (workspaceBindingMode='required_project_workspace'),
 * if workspace resolution fails, the run is rejected — no fallback to
 * agent_home is allowed. A workspace_resolution_failed event is emitted
 * on failure.
 */
export function dispatcherService(db: Db) {
  const envelopes = envelopeService(db);

  /**
   * Resolve the workspace binding mode for a dispatch.
   */
  function resolveBindingMode(projectId: string | null): WorkspaceBindingMode {
    return projectId
      ? "required_project_workspace"
      : "explicit_ad_hoc_workspace";
  }

  /**
   * Resolve workspace from issue→project→workspace chain.
   *
   * For project work:
   * 1. Look up the issue's projectId
   * 2. Look up the project's workspaces
   * 3. Prefer the explicitly specified workspaceId if provided
   * 4. Otherwise use the project's primary workspace
   * 5. If no workspace is found, resolution fails
   *
   * Returns the resolved workspaceId or null if resolution fails.
   */
  async function resolveWorkspace(input: {
    issueId: string;
    projectId: string | null;
    workspaceId: string | null;
    companyId: string;
  }): Promise<{ workspaceId: string | null; error: string | null }> {
    // If explicit workspace specified, verify it exists
    if (input.workspaceId) {
      const [workspace] = await db
        .select({ id: projectWorkspaces.id })
        .from(projectWorkspaces)
        .where(eq(projectWorkspaces.id, input.workspaceId));
      if (workspace) {
        return { workspaceId: workspace.id, error: null };
      }
      return {
        workspaceId: null,
        error: `Workspace ${input.workspaceId} not found`,
      };
    }

    // Resolve project from intent or issue
    let projectId = input.projectId;
    if (!projectId) {
      const [issue] = await db
        .select({ projectId: issues.projectId })
        .from(issues)
        .where(eq(issues.id, input.issueId));
      projectId = issue?.projectId ?? null;
    }

    // No project — ad-hoc workspace, null is ok
    if (!projectId) {
      return { workspaceId: null, error: null };
    }

    // Resolve workspace from project
    // First try primary workspace
    const [primaryWs] = await db
      .select({ id: projectWorkspaces.id })
      .from(projectWorkspaces)
      .where(
        and(
          eq(projectWorkspaces.projectId, projectId),
          eq(projectWorkspaces.isPrimary, true),
          eq(projectWorkspaces.companyId, input.companyId),
        ),
      );

    if (primaryWs) {
      return { workspaceId: primaryWs.id, error: null };
    }

    // Fallback to any workspace for the project
    const [anyWs] = await db
      .select({ id: projectWorkspaces.id })
      .from(projectWorkspaces)
      .where(
        and(
          eq(projectWorkspaces.projectId, projectId),
          eq(projectWorkspaces.companyId, input.companyId),
        ),
      );

    if (anyWs) {
      return { workspaceId: anyWs.id, error: null };
    }

    return {
      workspaceId: null,
      error: `No workspace found for project ${projectId}`,
    };
  }

  /**
   * Emit a workspace_resolution_failed event to control_plane_events.
   */
  async function emitWorkspaceResolutionFailed(input: {
    companyId: string;
    issueId: string;
    agentId: string;
    runId: string;
    reason: string;
  }) {
    await db.insert(controlPlaneEvents).values({
      companyId: input.companyId,
      entityType: "run",
      entityId: input.runId,
      eventType: "workspace_resolution_failed",
      payload: {
        issueId: input.issueId,
        agentId: input.agentId,
        runId: input.runId,
        reason: input.reason,
      },
    });
  }

  return {
    /**
     * Dispatch a run by creating an immutable execution envelope.
     *
     * Resolves workspace from the issue→project→workspace chain.
     * For project work, rejects if workspace resolution fails (no fallback).
     * Emits workspace_resolution_failed event on failure.
     * Links envelope to the heartbeat_run.
     *
     * Returns the dispatch result with the envelope ID if successful.
     */
    async dispatchRun(input: DispatchRunInput): Promise<DispatchRunResult> {
      const { intent, lease, runId } = input;
      const bindingMode = resolveBindingMode(intent.projectId);

      // Resolve workspace
      const resolution = await resolveWorkspace({
        issueId: intent.issueId,
        projectId: intent.projectId,
        workspaceId: intent.workspaceId,
        companyId: intent.companyId,
      });

      // For project work, workspace must be resolved
      if (
        bindingMode === "required_project_workspace" &&
        !resolution.workspaceId
      ) {
        const failureReason =
          resolution.error ?? "Workspace resolution failed for project work";

        // Emit workspace_resolution_failed event
        await emitWorkspaceResolutionFailed({
          companyId: intent.companyId,
          issueId: intent.issueId,
          agentId: intent.targetAgentId,
          runId,
          reason: failureReason,
        });

        logger.warn(
          {
            intentId: intent.id,
            issueId: intent.issueId,
            agentId: intent.targetAgentId,
            runId,
            reason: failureReason,
          },
          "Workspace resolution failed for project work — run rejected",
        );

        return {
          success: false,
          reason: failureReason,
        };
      }

      // Create envelope with all immutable fields
      const envelopeInput: CreateEnvelopeInput = {
        runId,
        companyId: intent.companyId,
        agentId: intent.targetAgentId,
        issueId: intent.issueId,
        projectId: intent.projectId,
        goalId: intent.goalId,
        workspaceId: resolution.workspaceId,
        wakeReason: intent.intentType,
        runKind: "standard",
        executionPolicyVersion: "1",
        workspaceBindingMode: bindingMode,
      };

      const envelope = await envelopes.createEnvelope(envelopeInput);

      // Link envelope to the heartbeat_run
      await db
        .update(heartbeatRuns)
        .set({
          envelopeId: envelope.id,
          updatedAt: new Date(),
        })
        .where(eq(heartbeatRuns.id, runId));

      logger.info(
        {
          intentId: intent.id,
          runId,
          envelopeId: envelope.id,
          leaseId: lease.id,
          agentId: intent.targetAgentId,
          issueId: intent.issueId,
          workspaceId: resolution.workspaceId,
          workspaceBindingMode: bindingMode,
        },
        "Dispatcher created envelope and linked to run",
      );

      return {
        success: true,
        envelopeId: envelope.id,
      };
    },

    /**
     * Build the envelope context to pass to the adapter.
     *
     * Returns the envelope fields that should be included in the
     * AdapterExecutionContext's context object.
     */
    async buildEnvelopeContext(envelopeId: string) {
      const envelope = await envelopes.getEnvelope(envelopeId);
      if (!envelope) return null;

      return {
        envelopeId: envelope.id,
        issueId: envelope.issueId,
        projectId: envelope.projectId,
        goalId: envelope.goalId,
        workspaceId: envelope.workspaceId,
        wakeReason: envelope.wakeReason,
        runKind: envelope.runKind,
        executionPolicyVersion: envelope.executionPolicyVersion,
        workspaceBindingMode: envelope.workspaceBindingMode,
      };
    },

    /**
     * Verify that a run has an envelope. Throws if not.
     *
     * Used to enforce the invariant that runs cannot proceed without
     * an envelope (runs created bypassing the intent→scheduler→dispatcher
     * pipeline are blocked).
     */
    async requireEnvelopeForRun(runId: string) {
      const envelope = await envelopes.getEnvelopeByRunId(runId);
      if (!envelope) {
        throw badRequest(
          `Run ${runId} has no execution envelope. Runs must be created through the intent→scheduler→dispatcher pipeline.`,
        );
      }
      return envelope;
    },

    // Re-export envelope service methods for convenience
    getEnvelope: envelopes.getEnvelope,
    getEnvelopeByRunId: envelopes.getEnvelopeByRunId,
  };
}
