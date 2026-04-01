import { and, eq } from "drizzle-orm";
import type { Db } from "@papierklammer/db";
import { issueDependencies, issues } from "@papierklammer/db";
import { badRequest, conflict, notFound } from "../errors.js";
import { intentQueueService, INTENT_PRIORITY_MAP } from "./intent-queue.js";
import { eventLogService } from "./event-log.js";
import { logger } from "../middleware/logger.js";

/**
 * Issue statuses considered "done" for dependency resolution.
 */
const DONE_STATUSES = ["done"];

/**
 * Dependency Service.
 *
 * Manages issue dependencies using the `issue_dependencies` table.
 * Provides CRUD operations, circular dependency detection, dependency
 * status queries, and automatic unblock intent creation.
 *
 * Factory function following the project's service pattern.
 */
export function dependencyService(db: Db) {
  const intentQueue = intentQueueService(db);
  const eventLog = eventLogService(db);

  /**
   * Check if adding a dependency from `issueId` → `dependsOnIssueId` would
   * create a cycle. Uses BFS to walk the dependency graph from `dependsOnIssueId`
   * and checks if it can reach `issueId`.
   *
   * A cycle exists if: dependsOnIssueId → ... → issueId (transitive).
   */
  async function wouldCreateCycle(
    issueId: string,
    dependsOnIssueId: string,
    companyId: string,
  ): Promise<boolean> {
    // Direct self-dependency
    if (issueId === dependsOnIssueId) return true;

    // BFS from dependsOnIssueId — if we can reach issueId, it's a cycle
    const visited = new Set<string>();
    const queue = [dependsOnIssueId];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);

      // Get what `current` depends on
      const deps = await db
        .select({ dependsOnIssueId: issueDependencies.dependsOnIssueId })
        .from(issueDependencies)
        .where(
          and(
            eq(issueDependencies.issueId, current),
            eq(issueDependencies.companyId, companyId),
          ),
        );

      for (const dep of deps) {
        if (dep.dependsOnIssueId === issueId) {
          return true; // Cycle detected
        }
        if (!visited.has(dep.dependsOnIssueId)) {
          queue.push(dep.dependsOnIssueId);
        }
      }
    }

    return false;
  }

  return {
    /**
     * Add a dependency: `issueId` depends on `dependsOnIssueId`.
     *
     * Validates both issues exist and belong to the same company.
     * Rejects circular dependencies (A→B→A).
     * Uses ON CONFLICT DO NOTHING for idempotency.
     */
    async addDependency(
      issueId: string,
      dependsOnIssueId: string,
      companyId: string,
    ) {
      if (!issueId) throw badRequest("issueId is required");
      if (!dependsOnIssueId) throw badRequest("dependsOnIssueId is required");
      if (!companyId) throw badRequest("companyId is required");
      if (issueId === dependsOnIssueId) {
        throw conflict("An issue cannot depend on itself");
      }

      // Verify both issues exist and belong to the company
      const [source] = await db
        .select({ id: issues.id })
        .from(issues)
        .where(and(eq(issues.id, issueId), eq(issues.companyId, companyId)));
      if (!source) throw notFound(`Issue ${issueId} not found`);

      const [target] = await db
        .select({ id: issues.id })
        .from(issues)
        .where(and(eq(issues.id, dependsOnIssueId), eq(issues.companyId, companyId)));
      if (!target) throw notFound(`Issue ${dependsOnIssueId} not found`);

      // Check for circular dependency
      const circular = await wouldCreateCycle(issueId, dependsOnIssueId, companyId);
      if (circular) {
        throw conflict(
          "Circular dependency detected: adding this dependency would create a cycle",
        );
      }

      // Insert (idempotent — ON CONFLICT DO NOTHING)
      const [row] = await db
        .insert(issueDependencies)
        .values({
          issueId,
          dependsOnIssueId,
          companyId,
        })
        .onConflictDoNothing()
        .returning();

      return row ?? null;
    },

    /**
     * Remove a dependency.
     */
    async removeDependency(
      issueId: string,
      dependsOnIssueId: string,
      companyId: string,
    ) {
      const deleted = await db
        .delete(issueDependencies)
        .where(
          and(
            eq(issueDependencies.issueId, issueId),
            eq(issueDependencies.dependsOnIssueId, dependsOnIssueId),
            eq(issueDependencies.companyId, companyId),
          ),
        )
        .returning();

      return deleted.length > 0;
    },

    /**
     * Get all dependencies for an issue (what this issue depends on).
     */
    async getDependencies(issueId: string, companyId: string) {
      return db
        .select()
        .from(issueDependencies)
        .where(
          and(
            eq(issueDependencies.issueId, issueId),
            eq(issueDependencies.companyId, companyId),
          ),
        );
    },

    /**
     * Get all dependents of an issue (issues that depend on this issue).
     */
    async getDependents(issueId: string, companyId: string) {
      return db
        .select()
        .from(issueDependencies)
        .where(
          and(
            eq(issueDependencies.dependsOnIssueId, issueId),
            eq(issueDependencies.companyId, companyId),
          ),
        );
    },

    /**
     * Check whether an issue has unresolved dependencies.
     *
     * An issue is blocked if it has dependencies where the depended-on
     * issue is NOT in a "done" status.
     *
     * Returns true if the issue has unresolved deps (i.e., is blocked).
     */
    async hasUnresolvedDependencies(issueId: string, companyId: string): Promise<boolean> {
      const deps = await db
        .select({
          dependsOnIssueId: issueDependencies.dependsOnIssueId,
        })
        .from(issueDependencies)
        .where(
          and(
            eq(issueDependencies.issueId, issueId),
            eq(issueDependencies.companyId, companyId),
          ),
        );

      if (deps.length === 0) return false;

      // Check if any dependency issue is NOT done
      for (const dep of deps) {
        const [depIssue] = await db
          .select({ status: issues.status })
          .from(issues)
          .where(eq(issues.id, dep.dependsOnIssueId));

        if (!depIssue || !DONE_STATUSES.includes(depIssue.status)) {
          return true;
        }
      }

      return false;
    },

    /**
     * When a dependency issue transitions to "done", create `dependency_unblocked`
     * intents for all dependent issues that are now unblocked.
     *
     * For each dependent issue:
     * 1. Check if ALL its dependencies are now done
     * 2. If so, create a dependency_unblocked intent for the assignee
     *
     * Returns the list of created intent IDs.
     */
    async onDependencyCompleted(
      completedIssueId: string,
      companyId: string,
    ): Promise<string[]> {
      // Find all issues that depend on the completed issue
      const dependents = await db
        .select({
          issueId: issueDependencies.issueId,
        })
        .from(issueDependencies)
        .where(
          and(
            eq(issueDependencies.dependsOnIssueId, completedIssueId),
            eq(issueDependencies.companyId, companyId),
          ),
        );

      const createdIntentIds: string[] = [];

      for (const dependent of dependents) {
        // Check if this dependent issue now has ALL dependencies resolved
        const stillBlocked = await this.hasUnresolvedDependencies(
          dependent.issueId,
          companyId,
        );

        if (stillBlocked) continue; // Still has other unresolved deps

        // Look up the dependent issue for its assignee and project
        const [depIssue] = await db
          .select({
            id: issues.id,
            assigneeAgentId: issues.assigneeAgentId,
            projectId: issues.projectId,
            status: issues.status,
          })
          .from(issues)
          .where(
            and(
              eq(issues.id, dependent.issueId),
              eq(issues.companyId, companyId),
            ),
          );

        if (!depIssue) continue;

        // Skip if issue is already done/cancelled or has no assignee
        if (depIssue.status === "done" || depIssue.status === "cancelled") continue;
        if (!depIssue.assigneeAgentId) continue;

        try {
          const intent = await intentQueue.createIntent({
            companyId,
            issueId: depIssue.id,
            projectId: depIssue.projectId ?? "",
            targetAgentId: depIssue.assigneeAgentId,
            intentType: "dependency_unblocked",
            priority: INTENT_PRIORITY_MAP.dependency_unblocked,
            dedupeKey: `dep_unblocked:${depIssue.id}`,
          });

          createdIntentIds.push(intent.id);

          logger.info(
            {
              completedIssueId,
              unblockedIssueId: depIssue.id,
              intentId: intent.id,
            },
            "Created dependency_unblocked intent for unblocked issue",
          );
        } catch (err) {
          logger.warn(
            { err, completedIssueId, unblockedIssueId: depIssue.id },
            "Failed to create dependency_unblocked intent",
          );
        }
      }

      return createdIntentIds;
    },
  };
}
