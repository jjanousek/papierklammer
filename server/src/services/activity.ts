import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import type { Db } from "@papierklammer/db";
import { activityLog, companyLifecycleEvents, heartbeatRuns, issues } from "@papierklammer/db";
import { logger } from "../middleware/logger.js";

export interface ActivityFilters {
  companyId: string;
  agentId?: string;
  entityType?: string;
  entityId?: string;
}

export function activityService(db: Db) {
  const issueIdAsText = sql<string>`${issues.id}::text`;

  function resolveRunTrace<T extends typeof activityLog.$inferSelect>(
    row: T,
    issueOriginRunId: string | null | undefined,
  ): T {
    if (row.runId || row.entityType !== "issue" || row.action !== "issue.created" || !issueOriginRunId) {
      return row;
    }
    return {
      ...row,
      runId: issueOriginRunId,
    };
  }

  return {
    list: async (filters: ActivityFilters) => {
      const conditions = [eq(activityLog.companyId, filters.companyId)];
      const lifecycleConditions = [eq(companyLifecycleEvents.companyId, filters.companyId)];

      if (filters.agentId) {
        conditions.push(eq(activityLog.agentId, filters.agentId));
        lifecycleConditions.push(eq(companyLifecycleEvents.agentId, filters.agentId));
      }
      if (filters.entityType) {
        conditions.push(eq(activityLog.entityType, filters.entityType));
        lifecycleConditions.push(eq(companyLifecycleEvents.entityType, filters.entityType));
      }
      if (filters.entityId) {
        conditions.push(eq(activityLog.entityId, filters.entityId));
        lifecycleConditions.push(eq(companyLifecycleEvents.entityId, filters.entityId));
      }

      const persistedActivity = await db
        .select({ activityLog, issueOriginRunId: issues.originRunId })
        .from(activityLog)
        .leftJoin(
          issues,
          and(
            eq(activityLog.entityType, sql`'issue'`),
            eq(activityLog.entityId, issueIdAsText),
          ),
        )
        .where(
          and(
            ...conditions,
            or(
              sql`${activityLog.entityType} != 'issue'`,
              isNull(issues.hiddenAt),
            ),
          ),
        )
        .orderBy(desc(activityLog.createdAt))
        .then((rows) => rows.map(({ activityLog, issueOriginRunId }) => resolveRunTrace(activityLog, issueOriginRunId)));

      const lifecycleActivity = await db
        .select()
        .from(companyLifecycleEvents)
        .where(and(...lifecycleConditions))
        .orderBy(desc(companyLifecycleEvents.createdAt))
        .catch((error) => {
          if (
            typeof error === "object"
            && error !== null
            && "code" in error
            && (error as { code?: string }).code === "42P01"
          ) {
            logger.warn(
              { companyId: filters.companyId, err: error },
              "company_lifecycle_events table is missing; returning activity feed without lifecycle events",
            );
            return [];
          }
          throw error;
        });

      return [...persistedActivity, ...lifecycleActivity]
        .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
    },

    forIssue: (issueId: string) =>
      db
        .select({ activityLog, issueOriginRunId: issues.originRunId })
        .from(activityLog)
        .leftJoin(
          issues,
          and(
            eq(activityLog.entityType, sql`'issue'`),
            eq(activityLog.entityId, issueIdAsText),
          ),
        )
        .where(
          and(
            eq(activityLog.entityType, "issue"),
            eq(activityLog.entityId, issueId),
          ),
        )
        .orderBy(desc(activityLog.createdAt))
        .then((rows) => rows.map(({ activityLog, issueOriginRunId }) => resolveRunTrace(activityLog, issueOriginRunId))),

    runsForIssue: (companyId: string, issueId: string) =>
      db
        .select({
          runId: heartbeatRuns.id,
          status: heartbeatRuns.status,
          agentId: heartbeatRuns.agentId,
          startedAt: heartbeatRuns.startedAt,
          finishedAt: heartbeatRuns.finishedAt,
          createdAt: heartbeatRuns.createdAt,
          invocationSource: heartbeatRuns.invocationSource,
          usageJson: heartbeatRuns.usageJson,
          resultJson: heartbeatRuns.resultJson,
        })
        .from(heartbeatRuns)
        .where(
          and(
            eq(heartbeatRuns.companyId, companyId),
            or(
              sql`${heartbeatRuns.contextSnapshot} ->> 'issueId' = ${issueId}`,
              sql`exists (
                select 1
                from ${activityLog}
                where ${activityLog.companyId} = ${companyId}
                  and ${activityLog.entityType} = 'issue'
                  and ${activityLog.entityId} = ${issueId}
                  and ${activityLog.runId} = ${heartbeatRuns.id}
              )`,
            ),
          ),
        )
        .orderBy(desc(heartbeatRuns.createdAt)),

    issuesForRun: async (runId: string) => {
      const run = await db
        .select({
          companyId: heartbeatRuns.companyId,
          contextSnapshot: heartbeatRuns.contextSnapshot,
        })
        .from(heartbeatRuns)
        .where(eq(heartbeatRuns.id, runId))
        .then((rows) => rows[0] ?? null);
      if (!run) return [];

      const fromActivity = await db
        .selectDistinctOn([issueIdAsText], {
          issueId: issues.id,
          identifier: issues.identifier,
          title: issues.title,
          status: issues.status,
          priority: issues.priority,
        })
        .from(activityLog)
        .innerJoin(issues, eq(activityLog.entityId, issueIdAsText))
        .where(
          and(
            eq(activityLog.companyId, run.companyId),
            eq(activityLog.runId, runId),
            eq(activityLog.entityType, "issue"),
            isNull(issues.hiddenAt),
          ),
        )
        .orderBy(issueIdAsText);

      const context = run.contextSnapshot;
      const contextIssueId =
        context && typeof context === "object" && typeof (context as Record<string, unknown>).issueId === "string"
          ? ((context as Record<string, unknown>).issueId as string)
          : null;
      if (!contextIssueId) return fromActivity;
      if (fromActivity.some((issue) => issue.issueId === contextIssueId)) return fromActivity;

      const fromContext = await db
        .select({
          issueId: issues.id,
          identifier: issues.identifier,
          title: issues.title,
          status: issues.status,
          priority: issues.priority,
        })
        .from(issues)
        .where(
          and(
            eq(issues.companyId, run.companyId),
            eq(issues.id, contextIssueId),
            isNull(issues.hiddenAt),
          ),
        )
        .then((rows) => rows[0] ?? null);

      if (!fromContext) return fromActivity;
      return [fromContext, ...fromActivity];
    },

    create: (data: typeof activityLog.$inferInsert) =>
      db
        .insert(activityLog)
        .values(data)
        .returning()
        .then((rows) => rows[0]),
  };
}
