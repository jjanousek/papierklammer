import { eq } from "drizzle-orm";
import type { Db } from "@papierklammer/db";
import { executionEnvelopes } from "@papierklammer/db";

/**
 * Input for creating an immutable execution envelope.
 */
export interface CreateEnvelopeInput {
  runId: string;
  companyId: string;
  agentId: string;
  issueId: string;
  projectId?: string | null;
  goalId?: string | null;
  workspaceId?: string | null;
  wakeReason: string;
  runKind: string;
  executionPolicyVersion?: string;
  workspaceBindingMode: string;
}

/**
 * Envelope service.
 *
 * Manages immutable execution envelopes. An envelope captures the complete
 * execution context at dispatch time and cannot be modified after creation.
 *
 * No update or delete methods are exposed — envelopes are append-only.
 */
export function envelopeService(db: Db) {
  return {
    /**
     * Create an immutable execution envelope.
     *
     * Persists all required fields at dispatch time. The envelope captures
     * the execution context and cannot be modified after creation.
     */
    async createEnvelope(input: CreateEnvelopeInput) {
      const [envelope] = await db
        .insert(executionEnvelopes)
        .values({
          runId: input.runId,
          companyId: input.companyId,
          agentId: input.agentId,
          issueId: input.issueId,
          projectId: input.projectId ?? null,
          goalId: input.goalId ?? null,
          workspaceId: input.workspaceId ?? null,
          wakeReason: input.wakeReason,
          runKind: input.runKind,
          executionPolicyVersion: input.executionPolicyVersion ?? "1",
          workspaceBindingMode: input.workspaceBindingMode,
        })
        .returning();

      return envelope;
    },

    /**
     * Get an envelope by ID.
     */
    async getEnvelope(envelopeId: string) {
      const [row] = await db
        .select()
        .from(executionEnvelopes)
        .where(eq(executionEnvelopes.id, envelopeId));
      return row ?? null;
    },

    /**
     * Get the envelope for a specific run.
     */
    async getEnvelopeByRunId(runId: string) {
      const [row] = await db
        .select()
        .from(executionEnvelopes)
        .where(eq(executionEnvelopes.runId, runId));
      return row ?? null;
    },
  };
}
