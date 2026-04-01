import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@papierklammer/db";
import { executionLeases } from "@papierklammer/db";
import { logger } from "../middleware/logger.js";

/**
 * Entry registered in the warm workspace pool.
 */
export interface WarmWorkspaceEntry {
  workspaceId: string;
  cwd: string;
  projectId: string;
  projectWorkspaceId: string;
}

/**
 * Internal pool entry with timestamps.
 */
interface PoolEntry extends WarmWorkspaceEntry {
  lastUsedAt: number;
}

/**
 * Options for creating a warm workspace pool.
 */
export interface WarmWorkspacePoolOptions {
  /**
   * Callback to check whether a workspace currently has an active execution
   * lease. Used during lookup to skip workspaces with active work.
   */
  hasActiveLease: (workspaceId: string) => Promise<boolean>;

  /**
   * Optional callback invoked when a workspace is evicted from the pool.
   */
  onEvict?: (entry: WarmWorkspaceEntry) => void;

  /**
   * Time-to-live in milliseconds for idle workspaces. Default: 300_000 (5 min).
   */
  ttlMs?: number;

  /**
   * Interval in milliseconds between TTL eviction sweeps. Default: 30_000 (30 sec).
   */
  evictionIntervalMs?: number;

  /**
   * Maximum pool size. When at capacity, the least recently used entry is
   * evicted to make room. Default: 100.
   */
  maxPoolSize?: number;
}

/**
 * Warm Workspace Pool.
 *
 * An in-memory pool that caches resolved workspace paths for fast reuse.
 * When a run completes, the workspace is registered here. Before dispatch,
 * the pool is checked for a warm (sticky) workspace for the same project.
 *
 * Features:
 * - TTL-based eviction of idle workspaces
 * - LRU eviction when at max capacity
 * - Skips workspaces with active execution leases during lookup
 * - touch() to refresh lastUsedAt and reset eviction timer
 */
export function createWarmWorkspacePool(options: WarmWorkspacePoolOptions) {
  const {
    hasActiveLease,
    onEvict,
    ttlMs = 300_000,
    evictionIntervalMs = 30_000,
    maxPoolSize = 100,
  } = options;

  /** Map from workspaceId → PoolEntry */
  const entries = new Map<string, PoolEntry>();

  /** Index from projectId → Set<workspaceId> for fast project lookups */
  const projectIndex = new Map<string, Set<string>>();

  /** Periodic TTL eviction interval handle */
  let evictionInterval: ReturnType<typeof setInterval> | null = null;

  // Start TTL eviction sweep
  if (ttlMs > 0 && evictionIntervalMs > 0) {
    evictionInterval = setInterval(() => {
      evictExpired();
    }, evictionIntervalMs);

    // Don't keep the process alive just for pool eviction
    if (evictionInterval && typeof evictionInterval === "object" && "unref" in evictionInterval) {
      evictionInterval.unref();
    }
  }

  /**
   * Remove an entry from all internal data structures.
   */
  function removeEntry(workspaceId: string): PoolEntry | undefined {
    const entry = entries.get(workspaceId);
    if (!entry) return undefined;

    entries.delete(workspaceId);

    const projectSet = projectIndex.get(entry.projectId);
    if (projectSet) {
      projectSet.delete(workspaceId);
      if (projectSet.size === 0) {
        projectIndex.delete(entry.projectId);
      }
    }

    return entry;
  }

  /**
   * Evict entries that have exceeded their TTL.
   */
  function evictExpired(): void {
    const now = Date.now();
    const toEvict: string[] = [];

    for (const [wsId, entry] of entries) {
      if (now - entry.lastUsedAt > ttlMs) {
        toEvict.push(wsId);
      }
    }

    for (const wsId of toEvict) {
      const removed = removeEntry(wsId);
      if (removed && onEvict) {
        onEvict({
          workspaceId: removed.workspaceId,
          cwd: removed.cwd,
          projectId: removed.projectId,
          projectWorkspaceId: removed.projectWorkspaceId,
        });
      }
    }

    if (toEvict.length > 0) {
      logger.debug(
        { evicted: toEvict.length, remaining: entries.size },
        "Warm workspace pool: TTL eviction sweep",
      );
    }
  }

  /**
   * Evict the least recently used entry to make room.
   */
  function evictLru(): void {
    let oldestWsId: string | null = null;
    let oldestTime = Infinity;

    for (const [wsId, entry] of entries) {
      if (entry.lastUsedAt < oldestTime) {
        oldestTime = entry.lastUsedAt;
        oldestWsId = wsId;
      }
    }

    if (oldestWsId) {
      const removed = removeEntry(oldestWsId);
      if (removed && onEvict) {
        onEvict({
          workspaceId: removed.workspaceId,
          cwd: removed.cwd,
          projectId: removed.projectId,
          projectWorkspaceId: removed.projectWorkspaceId,
        });
      }

      logger.debug(
        { evictedWorkspaceId: oldestWsId, poolSize: entries.size },
        "Warm workspace pool: LRU eviction",
      );
    }
  }

  return {
    /**
     * Register a workspace in the pool. Called after a run completes.
     *
     * Sets lastUsedAt to now. If the workspace is already in the pool,
     * updates lastUsedAt (re-register / touch).
     *
     * If the pool is at max capacity, the least recently used entry is
     * evicted first.
     */
    register(entry: WarmWorkspaceEntry): void {
      const existing = entries.get(entry.workspaceId);
      if (existing) {
        // Update existing entry
        existing.cwd = entry.cwd;
        existing.projectId = entry.projectId;
        existing.projectWorkspaceId = entry.projectWorkspaceId;
        existing.lastUsedAt = Date.now();

        // Update project index if project changed
        if (existing.projectId !== entry.projectId) {
          const oldProjectSet = projectIndex.get(existing.projectId);
          if (oldProjectSet) {
            oldProjectSet.delete(entry.workspaceId);
            if (oldProjectSet.size === 0) {
              projectIndex.delete(existing.projectId);
            }
          }
          let newProjectSet = projectIndex.get(entry.projectId);
          if (!newProjectSet) {
            newProjectSet = new Set();
            projectIndex.set(entry.projectId, newProjectSet);
          }
          newProjectSet.add(entry.workspaceId);
        }
        return;
      }

      // Enforce max pool size with LRU eviction
      if (entries.size >= maxPoolSize) {
        evictLru();
      }

      const poolEntry: PoolEntry = {
        ...entry,
        lastUsedAt: Date.now(),
      };

      entries.set(entry.workspaceId, poolEntry);

      let projectSet = projectIndex.get(entry.projectId);
      if (!projectSet) {
        projectSet = new Set();
        projectIndex.set(entry.projectId, projectSet);
      }
      projectSet.add(entry.workspaceId);
    },

    /**
     * Look up the most recently used warm workspace for a project.
     *
     * Skips workspaces with active execution leases. Returns null if
     * no suitable warm workspace is found.
     */
    async lookup(projectId: string): Promise<WarmWorkspaceEntry | null> {
      const projectSet = projectIndex.get(projectId);
      if (!projectSet || projectSet.size === 0) {
        return null;
      }

      // Collect entries for this project, sorted by most recently used first
      const candidates: PoolEntry[] = [];
      for (const wsId of projectSet) {
        const entry = entries.get(wsId);
        if (entry) {
          candidates.push(entry);
        }
      }

      candidates.sort((a, b) => b.lastUsedAt - a.lastUsedAt);

      // Return the first candidate without an active lease
      for (const candidate of candidates) {
        const leased = await hasActiveLease(candidate.workspaceId);
        if (!leased) {
          return {
            workspaceId: candidate.workspaceId,
            cwd: candidate.cwd,
            projectId: candidate.projectId,
            projectWorkspaceId: candidate.projectWorkspaceId,
          };
        }
      }

      return null;
    },

    /**
     * Evict a workspace from the pool. Calls the eviction callback if
     * the workspace was present. No-op if the workspace is not in the pool.
     */
    evict(workspaceId: string): void {
      const removed = removeEntry(workspaceId);
      if (removed && onEvict) {
        onEvict({
          workspaceId: removed.workspaceId,
          cwd: removed.cwd,
          projectId: removed.projectId,
          projectWorkspaceId: removed.projectWorkspaceId,
        });
      }
    },

    /**
     * Touch a workspace to update its lastUsedAt and reset the eviction timer.
     * No-op if the workspace is not in the pool.
     */
    touch(workspaceId: string): void {
      const entry = entries.get(workspaceId);
      if (entry) {
        entry.lastUsedAt = Date.now();
      }
    },

    /**
     * Get the current number of entries in the pool.
     */
    getPoolSize(): number {
      return entries.size;
    },

    /**
     * Destroy the pool. Stops the eviction interval and clears all entries.
     */
    destroy(): void {
      if (evictionInterval) {
        clearInterval(evictionInterval);
        evictionInterval = null;
      }
      entries.clear();
      projectIndex.clear();
    },
  };
}

/* ------------------------------------------------------------------ */
/*  Singleton pool for use by the server process                       */
/* ------------------------------------------------------------------ */

let _globalPool: ReturnType<typeof createWarmWorkspacePool> | null = null;

/**
 * Get or create the global warm workspace pool for the server process.
 *
 * The pool is lazily initialized on first access. The `hasActiveLease`
 * callback queries the database to check for active leases associated
 * with the workspace.
 */
export function getWarmWorkspacePool(db: Db): ReturnType<typeof createWarmWorkspacePool> {
  if (!_globalPool) {
    _globalPool = createWarmWorkspacePool({
      hasActiveLease: async (workspaceId: string) => {
        // Check if any active lease references this workspace via the
        // execution envelope or via the intent's workspaceId.
        // We check leases whose associated run's envelope references this workspace.
        const [row] = await db
          .select({ id: executionLeases.id })
          .from(executionLeases)
          .where(
            and(
              sql`${executionLeases.state} IN ('granted', 'renewed')`,
              sql`${executionLeases.runId} IN (
                SELECT run_id FROM execution_envelopes WHERE workspace_id = ${workspaceId}
              )`,
            ),
          )
          .limit(1);
        return !!row;
      },
      onEvict: (entry) => {
        logger.debug(
          { workspaceId: entry.workspaceId, projectId: entry.projectId },
          "Warm workspace evicted from pool",
        );
      },
    });
  }
  return _globalPool;
}

/**
 * Register a completed run's workspace in the warm pool.
 *
 * Called after a run completes to make the workspace available for
 * sticky routing on future runs for the same project.
 */
export function registerCompletedRunWorkspace(
  db: Db,
  input: {
    workspaceId: string | null;
    cwd: string | null;
    projectId: string | null;
    projectWorkspaceId: string | null;
  },
): void {
  if (!input.workspaceId || !input.cwd || !input.projectId) {
    return; // Not enough data to register
  }

  const pool = getWarmWorkspacePool(db);
  pool.register({
    workspaceId: input.workspaceId,
    cwd: input.cwd,
    projectId: input.projectId,
    projectWorkspaceId: input.projectWorkspaceId ?? input.workspaceId,
  });

  logger.debug(
    {
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      cwd: input.cwd,
    },
    "Registered completed run workspace in warm pool",
  );
}

/**
 * Look up a warm workspace for sticky routing before dispatch.
 *
 * Returns the warm workspace entry if one is available for the project,
 * or null if no warm workspace is available.
 */
export async function lookupWarmWorkspace(
  db: Db,
  projectId: string | null,
): Promise<WarmWorkspaceEntry | null> {
  if (!projectId) return null;

  const pool = getWarmWorkspacePool(db);
  return pool.lookup(projectId);
}

/**
 * Reset the global pool. Used for testing.
 */
export function resetGlobalPool(): void {
  if (_globalPool) {
    _globalPool.destroy();
    _globalPool = null;
  }
}
