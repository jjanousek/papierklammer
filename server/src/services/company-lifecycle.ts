import { and, eq, inArray, isNotNull, isNull, or } from "drizzle-orm";
import type { Db } from "@papierklammer/db";
import {
  agentWakeupRequests,
  companies,
  companyLifecycleEvents,
  dispatchIntents,
  executionLeases,
  heartbeatRuns,
  issues,
} from "@papierklammer/db";
import { conflict, notFound } from "../errors.js";
import { logger } from "../middleware/logger.js";
import { logActivity } from "./activity-log.js";
import { companyService } from "./companies.js";
import { heartbeatService } from "./heartbeat.js";
import { reconcilerService } from "./reconciler.js";

type LifecycleActor = {
  actorType: "agent" | "user" | "system";
  actorId: string;
  agentId?: string | null;
  runId?: string | null;
};

type CompanyStatus = "active" | "paused" | "archived";

export interface CompanyLifecycleAuditEntry {
  id: string;
  companyId: string;
  actorType: "agent" | "user" | "system";
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  agentId: string | null;
  runId: string | null;
  details: Record<string, unknown> | null;
  createdAt: Date;
}

export interface CompanyQuiesceSummary {
  cancelledRuns: number;
  cancelledQueuedRuns: number;
  cancelledRunningRuns: number;
  cancelledWakeups: number;
  rejectedIntents: number;
  releasedLeases: number;
  clearedIssueLocks: number;
  reconciled: {
    orphanedRunsClosed: number;
    staleIntentsRejected: number;
    ghostProjectionsCorrected: number;
  };
}

async function writeLifecycleEvent(
  db: Db,
  input: Omit<typeof companyLifecycleEvents.$inferInsert, "id" | "createdAt">,
) {
  const [event] = await db.insert(companyLifecycleEvents).values(input).returning();
  return event;
}

function isMissingLifecycleEventsTableError(error: unknown) {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && (error as { code?: string }).code === "42P01";
}

export function companyLifecycleService(db: Db) {
  const companiesSvc = companyService(db);
  const heartbeat = heartbeatService(db);
  const reconciler = reconcilerService(db);

  async function requireCompanyStatus(companyId: string) {
    const company = await db
      .select({
        id: companies.id,
        name: companies.name,
        status: companies.status,
        pauseReason: companies.pauseReason,
        pausedAt: companies.pausedAt,
      })
      .from(companies)
      .where(eq(companies.id, companyId))
      .then((rows) => rows[0] ?? null);
    if (!company) throw notFound("Company not found");
    return company;
  }

  async function quiesceCompanyWork(companyId: string, reasonCode: string, reason: string): Promise<CompanyQuiesceSummary> {
    const now = new Date();
    const activeLeaseIds = await db
      .select({ id: executionLeases.id })
      .from(executionLeases)
      .where(
        and(
          eq(executionLeases.companyId, companyId),
          inArray(executionLeases.state, ["granted", "renewed"]),
        ),
      )
      .then((rows) => rows.map((row) => row.id));
    const activeRuns = await db
      .select({
        id: heartbeatRuns.id,
        status: heartbeatRuns.status,
        wakeupRequestId: heartbeatRuns.wakeupRequestId,
      })
      .from(heartbeatRuns)
      .where(
        and(
          eq(heartbeatRuns.companyId, companyId),
          inArray(heartbeatRuns.status, ["queued", "running"]),
        ),
      )
      .orderBy(heartbeatRuns.createdAt);

    const runningRuns = activeRuns.filter((run) => run.status === "running");
    const queuedRuns = activeRuns.filter((run) => run.status === "queued");

    const queuedRunIds = queuedRuns.map((run) => run.id);
    const queuedWakeupIds = queuedRuns
      .map((run) => run.wakeupRequestId)
      .filter((value): value is string => typeof value === "string" && value.length > 0);

    if (queuedRunIds.length > 0) {
      await db
        .update(heartbeatRuns)
        .set({
          status: "cancelled",
          finishedAt: now,
          error: reason,
          errorCode: "cancelled",
          updatedAt: now,
        })
        .where(
          and(
            eq(heartbeatRuns.companyId, companyId),
            inArray(heartbeatRuns.id, queuedRunIds),
          ),
        );

      if (queuedWakeupIds.length > 0) {
        await db
          .update(agentWakeupRequests)
          .set({
            status: "cancelled",
            reason: reasonCode,
            error: reason,
            finishedAt: now,
            updatedAt: now,
          })
          .where(
            and(
              eq(agentWakeupRequests.companyId, companyId),
              inArray(agentWakeupRequests.id, queuedWakeupIds),
            ),
          );
      }

      await db
        .update(issues)
        .set({
          executionRunId: null,
          executionLeaseId: null,
          executionAgentNameKey: null,
          executionLockedAt: null,
          updatedAt: now,
        })
        .where(
          and(
            eq(issues.companyId, companyId),
            or(
              inArray(issues.executionRunId, queuedRunIds),
              inArray(issues.checkoutRunId, queuedRunIds),
            ),
          ),
        );
    }

    for (const run of runningRuns) {
      await heartbeat.cancelRun(run.id);
    }

    const cancelledWakeups = await db
      .update(agentWakeupRequests)
      .set({
        status: "cancelled",
        reason: reasonCode,
        error: reason,
        finishedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(agentWakeupRequests.companyId, companyId),
          inArray(agentWakeupRequests.status, ["queued", "deferred_issue_execution"]),
          isNull(agentWakeupRequests.runId),
        ),
      )
      .returning({ id: agentWakeupRequests.id });

    const rejectedIntents = await db
      .update(dispatchIntents)
      .set({
        status: "rejected",
        resolvedAt: now,
        updatedAt: now,
        sourceEventId: reasonCode,
      })
      .where(
        and(
          eq(dispatchIntents.companyId, companyId),
          inArray(dispatchIntents.status, ["queued", "admitted", "deferred"]),
        ),
      )
      .returning({ id: dispatchIntents.id });

    const releasedLeases = await db
      .update(executionLeases)
      .set({
        state: "released",
        releasedAt: now,
        releaseReason: reasonCode,
        updatedAt: now,
      })
      .where(
        and(
          eq(executionLeases.companyId, companyId),
          inArray(executionLeases.state, ["granted", "renewed"]),
        ),
      )
      .returning({ id: executionLeases.id });

    const clearedIssueLocks = await db
      .update(issues)
      .set({
        executionRunId: null,
        executionLeaseId: null,
        executionAgentNameKey: null,
        executionLockedAt: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(issues.companyId, companyId),
          or(
            isNotNull(issues.executionRunId),
            isNotNull(issues.executionLeaseId),
            isNotNull(issues.executionAgentNameKey),
            isNotNull(issues.executionLockedAt),
          ),
        ),
      )
      .returning({ id: issues.id });

    const reconciled = await reconciler.reconcile(companyId);

    return {
      cancelledRuns: activeRuns.length,
      cancelledQueuedRuns: queuedRuns.length,
      cancelledRunningRuns: runningRuns.length,
      cancelledWakeups: cancelledWakeups.length,
      rejectedIntents: rejectedIntents.length,
      releasedLeases: Math.max(releasedLeases.length, activeLeaseIds.length),
      clearedIssueLocks: clearedIssueLocks.length,
      reconciled,
    };
  }

  async function recordLifecycleActivity(
    companyId: string,
    actor: LifecycleActor,
    action: string,
    details: Record<string, unknown>,
  ): Promise<CompanyLifecycleAuditEntry> {
    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId ?? null,
      runId: actor.runId ?? null,
      action,
      entityType: "company",
      entityId: companyId,
      details,
    });

    return {
      id: "",
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId ?? null,
      runId: actor.runId ?? null,
      action,
      entityType: "company",
      entityId: companyId,
      details,
      createdAt: new Date(),
    };
  }

  return {
    async pause(companyId: string, actor: LifecycleActor, reason: "manual" | "budget" | "system" = "manual") {
      const previous = await requireCompanyStatus(companyId);
      if (previous.status === "archived") {
        throw conflict("Archived companies cannot be paused");
      }

      const company = await companiesSvc.pause(companyId, reason);
      if (!company) throw notFound("Company not found");

      const quiesce = await quiesceCompanyWork(
        companyId,
        "company.paused",
        reason === "budget"
          ? "Company is paused because its budget hard-stop was reached."
          : "Company is paused and cannot start new work.",
      );
      const details = {
        previousStatus: previous.status,
        nextStatus: company.status,
        pauseReason: company.pauseReason,
        pausedAt: company.pausedAt,
        quiesce,
      };
      const audit = await recordLifecycleActivity(companyId, actor, "company.paused", details);
      return { company, quiesce, audit };
    },

    async resume(companyId: string, actor: LifecycleActor) {
      const previous = await requireCompanyStatus(companyId);
      if (previous.status !== "paused") {
        throw conflict("Only paused companies can be resumed");
      }

      const company = await companiesSvc.resume(companyId);
      if (!company) throw notFound("Company not found");

      const details = {
        previousStatus: previous.status,
        nextStatus: company.status,
        pauseReason: company.pauseReason,
        pausedAt: company.pausedAt,
      };
      const audit = await recordLifecycleActivity(companyId, actor, "company.resumed", details);
      return { company, audit };
    },

    async archive(companyId: string, actor: LifecycleActor) {
      const previous = await requireCompanyStatus(companyId);
      const company = await companiesSvc.archive(companyId);
      if (!company) throw notFound("Company not found");

      const quiesce = await quiesceCompanyWork(
        companyId,
        "company.archived",
        "Company is archived and cannot start new work.",
      );
      const details = {
        previousStatus: previous.status,
        nextStatus: company.status,
        quiesce,
      };
      const audit = await recordLifecycleActivity(companyId, actor, "company.archived", details);
      return { company, quiesce, audit };
    },

    async deleteGuarded(companyId: string, actor: LifecycleActor) {
      const previous = await requireCompanyStatus(companyId);
      if (previous.status === "active") {
        throw conflict("Active companies must be paused or archived before deletion");
      }

      const quiesce = await quiesceCompanyWork(
        companyId,
        "company.deleted",
        "Company was deleted after lifecycle quiesce.",
      );
      const liveRuns = await db
        .select({ id: heartbeatRuns.id })
        .from(heartbeatRuns)
        .where(
          and(
            eq(heartbeatRuns.companyId, companyId),
            inArray(heartbeatRuns.status, ["queued", "running"]),
          ),
        )
        .limit(1);
      if (liveRuns.length > 0) {
        throw conflict("Company still has live runs after quiesce; retry deletion once shutdown completes");
      }
      const lifecycleDetails = {
        previousStatus: previous.status,
        nextStatus: "deleted",
        companyName: previous.name,
        quiesce,
      };

      const deleted = await companiesSvc.deleteGuarded(companyId, async (tx, existing) => {
        try {
          await tx.insert(companyLifecycleEvents).values({
            companyId: existing.id,
            actorType: actor.actorType,
            actorId: actor.actorId,
            agentId: actor.agentId ?? null,
            runId: actor.runId ?? null,
            action: "company.deleted",
            entityType: "company",
            entityId: existing.id,
            details: lifecycleDetails,
          });
        } catch (error) {
          if (!isMissingLifecycleEventsTableError(error)) throw error;
          logger.warn(
            { companyId: existing.id, err: error },
            "company_lifecycle_events table is missing; continuing company delete without durable lifecycle audit row",
          );
        }
      });
      if (!deleted) throw notFound("Company not found");

      return {
        deletedCompanyId: deleted.id,
        audit: {
          companyId: deleted.id,
          action: "company.deleted",
          details: lifecycleDetails,
        },
      };
    },
  };
}
