import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  agents,
  companies,
  createDb,
  executionLeases,
  heartbeatRuns,
  issues,
  projects,
  projectWorkspaces,
} from "@papierklammer/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import {
  createWarmWorkspacePool,
  type WarmWorkspacePoolOptions,
  type WarmWorkspaceEntry,
} from "../services/warm-workspace-pool.js";
import { sql } from "drizzle-orm";

/* ------------------------------------------------------------------ */
/*  Unit tests (no DB, pure in-memory pool logic)                     */
/* ------------------------------------------------------------------ */

describe("createWarmWorkspacePool (unit)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  function makeEntry(overrides: Partial<WarmWorkspaceEntry> = {}): WarmWorkspaceEntry {
    return {
      workspaceId: randomUUID(),
      cwd: `/tmp/workspace/${randomUUID()}`,
      projectId: randomUUID(),
      projectWorkspaceId: randomUUID(),
      ...overrides,
    };
  }

  // ----- registration -----

  it("registers a workspace entry", () => {
    const pool = createWarmWorkspacePool({ hasActiveLease: async () => false });
    const entry = makeEntry();
    pool.register(entry);

    const result = pool.getPoolSize();
    expect(result).toBe(1);
  });

  it("registers multiple workspaces for different projects", () => {
    const pool = createWarmWorkspacePool({ hasActiveLease: async () => false });
    pool.register(makeEntry({ projectId: "proj-a" }));
    pool.register(makeEntry({ projectId: "proj-b" }));

    expect(pool.getPoolSize()).toBe(2);
  });

  it("re-registers same workspaceId, updating lastUsedAt", () => {
    vi.useFakeTimers();
    const pool = createWarmWorkspacePool({ hasActiveLease: async () => false });
    const entry = makeEntry();

    pool.register(entry);
    vi.advanceTimersByTime(1000);
    pool.register(entry);

    // Should still be 1 entry, not 2
    expect(pool.getPoolSize()).toBe(1);
  });

  // ----- lookup -----

  it("lookup returns most recently used warm workspace for a project", async () => {
    vi.useFakeTimers();
    const pool = createWarmWorkspacePool({ hasActiveLease: async () => false });
    const projectId = randomUUID();
    const entry1 = makeEntry({ projectId, workspaceId: "ws-1" });
    const entry2 = makeEntry({ projectId, workspaceId: "ws-2" });

    pool.register(entry1);
    vi.advanceTimersByTime(100);
    pool.register(entry2);

    // ws-2 was registered second, so it's more recent
    const result = await pool.lookup(projectId);
    expect(result).not.toBeNull();
    expect(result!.workspaceId).toBe("ws-2");
  });

  it("lookup returns null for unknown project", async () => {
    const pool = createWarmWorkspacePool({ hasActiveLease: async () => false });
    const result = await pool.lookup(randomUUID());
    expect(result).toBeNull();
  });

  it("lookup skips workspaces with active execution leases", async () => {
    const leasedWorkspaces = new Set<string>();
    const pool = createWarmWorkspacePool({
      hasActiveLease: async (workspaceId) => leasedWorkspaces.has(workspaceId),
    });

    const projectId = randomUUID();
    const entry1 = makeEntry({ projectId, workspaceId: "ws-1" });
    const entry2 = makeEntry({ projectId, workspaceId: "ws-2" });

    pool.register(entry1);
    pool.register(entry2);

    // Mark ws-2 (most recent) as leased
    leasedWorkspaces.add("ws-2");

    // Should fall back to ws-1
    const result = await pool.lookup(projectId);
    expect(result).not.toBeNull();
    expect(result!.workspaceId).toBe("ws-1");
  });

  it("lookup returns null if all workspaces for project have active leases", async () => {
    const pool = createWarmWorkspacePool({
      hasActiveLease: async () => true,
    });

    const projectId = randomUUID();
    pool.register(makeEntry({ projectId, workspaceId: "ws-1" }));

    const result = await pool.lookup(projectId);
    expect(result).toBeNull();
  });

  // ----- eviction -----

  it("evict removes workspace from pool", () => {
    const pool = createWarmWorkspacePool({ hasActiveLease: async () => false });
    const entry = makeEntry();

    pool.register(entry);
    expect(pool.getPoolSize()).toBe(1);

    pool.evict(entry.workspaceId);
    expect(pool.getPoolSize()).toBe(0);
  });

  it("evict calls eviction callback", () => {
    const onEvict = vi.fn();
    const pool = createWarmWorkspacePool({
      hasActiveLease: async () => false,
      onEvict,
    });
    const entry = makeEntry();

    pool.register(entry);
    pool.evict(entry.workspaceId);

    expect(onEvict).toHaveBeenCalledTimes(1);
    expect(onEvict).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: entry.workspaceId }),
    );
  });

  it("evict is idempotent for unknown workspaceId", () => {
    const onEvict = vi.fn();
    const pool = createWarmWorkspacePool({
      hasActiveLease: async () => false,
      onEvict,
    });

    pool.evict(randomUUID()); // No-op
    expect(onEvict).not.toHaveBeenCalled();
  });

  // ----- TTL eviction -----

  it("TTL eviction removes idle workspaces after ttl", () => {
    vi.useFakeTimers();
    const onEvict = vi.fn();
    const pool = createWarmWorkspacePool({
      hasActiveLease: async () => false,
      onEvict,
      ttlMs: 5000,
      evictionIntervalMs: 1000,
    });
    const entry = makeEntry();

    pool.register(entry);
    expect(pool.getPoolSize()).toBe(1);

    // Advance past the TTL
    vi.advanceTimersByTime(6000);

    expect(pool.getPoolSize()).toBe(0);
    expect(onEvict).toHaveBeenCalledTimes(1);

    pool.destroy();
  });

  it("TTL eviction does not remove recently touched workspaces", () => {
    vi.useFakeTimers();
    const onEvict = vi.fn();
    const pool = createWarmWorkspacePool({
      hasActiveLease: async () => false,
      onEvict,
      ttlMs: 5000,
      evictionIntervalMs: 1000,
    });
    const entry = makeEntry();

    pool.register(entry);

    // Advance 3s (within TTL), then touch
    vi.advanceTimersByTime(3000);
    pool.touch(entry.workspaceId);

    // Advance another 3s (total 6s from register, but only 3s from touch)
    vi.advanceTimersByTime(3000);

    expect(pool.getPoolSize()).toBe(1);
    expect(onEvict).not.toHaveBeenCalled();

    pool.destroy();
  });

  it("TTL eviction fires on interval", () => {
    vi.useFakeTimers();
    const onEvict = vi.fn();
    const pool = createWarmWorkspacePool({
      hasActiveLease: async () => false,
      onEvict,
      ttlMs: 2000,
      evictionIntervalMs: 500,
    });

    pool.register(makeEntry({ workspaceId: "ws-a" }));
    vi.advanceTimersByTime(1500);
    pool.register(makeEntry({ workspaceId: "ws-b" }));

    // After 2500ms total: ws-a should be evicted, ws-b should not
    vi.advanceTimersByTime(1000);
    expect(onEvict).toHaveBeenCalledTimes(1);
    expect(onEvict).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: "ws-a" }),
    );

    pool.destroy();
  });

  // ----- LRU eviction at capacity -----

  it("LRU eviction at capacity evicts least recently used", () => {
    vi.useFakeTimers();
    const onEvict = vi.fn();
    const pool = createWarmWorkspacePool({
      hasActiveLease: async () => false,
      onEvict,
      maxPoolSize: 2,
    });

    pool.register(makeEntry({ workspaceId: "ws-old" }));
    vi.advanceTimersByTime(100);
    pool.register(makeEntry({ workspaceId: "ws-mid" }));
    vi.advanceTimersByTime(100);

    // Pool at capacity. Adding ws-new should evict ws-old (LRU)
    pool.register(makeEntry({ workspaceId: "ws-new" }));

    expect(pool.getPoolSize()).toBe(2);
    expect(onEvict).toHaveBeenCalledTimes(1);
    expect(onEvict).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: "ws-old" }),
    );

    pool.destroy();
  });

  it("LRU eviction respects touch when determining LRU", () => {
    vi.useFakeTimers();
    const onEvict = vi.fn();
    const pool = createWarmWorkspacePool({
      hasActiveLease: async () => false,
      onEvict,
      maxPoolSize: 2,
    });

    pool.register(makeEntry({ workspaceId: "ws-1" }));
    vi.advanceTimersByTime(100);
    pool.register(makeEntry({ workspaceId: "ws-2" }));
    vi.advanceTimersByTime(100);

    // Touch ws-1 to make it more recently used than ws-2
    pool.touch("ws-1");
    vi.advanceTimersByTime(100);

    // Adding ws-3 should evict ws-2 (now LRU)
    pool.register(makeEntry({ workspaceId: "ws-3" }));

    expect(pool.getPoolSize()).toBe(2);
    expect(onEvict).toHaveBeenCalledTimes(1);
    expect(onEvict).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: "ws-2" }),
    );

    pool.destroy();
  });

  // ----- touch -----

  it("touch updates lastUsedAt and resets eviction timer", () => {
    vi.useFakeTimers();
    const pool = createWarmWorkspacePool({
      hasActiveLease: async () => false,
      ttlMs: 5000,
      evictionIntervalMs: 1000,
    });
    const entry = makeEntry();

    pool.register(entry);

    // Advance 4s, then touch (1s before TTL)
    vi.advanceTimersByTime(4000);
    pool.touch(entry.workspaceId);

    // Advance another 4s (total 8s from register, but only 4s from touch)
    vi.advanceTimersByTime(4000);

    expect(pool.getPoolSize()).toBe(1);

    // Advance past TTL from touch
    vi.advanceTimersByTime(2000);
    expect(pool.getPoolSize()).toBe(0);

    pool.destroy();
  });

  it("touch on unknown workspaceId is no-op", () => {
    const pool = createWarmWorkspacePool({ hasActiveLease: async () => false });
    // Should not throw
    pool.touch(randomUUID());
    expect(pool.getPoolSize()).toBe(0);
  });

  // ----- destroy -----

  it("destroy clears pool and stops interval", () => {
    vi.useFakeTimers();
    const pool = createWarmWorkspacePool({
      hasActiveLease: async () => false,
      ttlMs: 1000,
      evictionIntervalMs: 500,
    });

    pool.register(makeEntry());
    pool.destroy();

    expect(pool.getPoolSize()).toBe(0);

    // Should not throw or have side effects after destroy
    vi.advanceTimersByTime(5000);
  });
});

/* ------------------------------------------------------------------ */
/*  Integration tests (with embedded Postgres for lease checking)     */
/* ------------------------------------------------------------------ */

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeDB = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres warm workspace pool tests: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeDB("createWarmWorkspacePool (DB integration)", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  let companyId: string;
  let agentId: string;
  let projectId: string;
  let issueId: string;
  let workspaceId: string;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("warm-ws-pool-");
    db = createDb(tempDb.connectionString);
  }, 30_000);

  afterEach(async () => {
    await db.execute(sql`TRUNCATE TABLE
      execution_leases,
      control_plane_events,
      execution_envelopes,
      dispatch_intents,
      heartbeat_runs,
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

  async function seedTestData() {
    companyId = randomUUID();
    agentId = randomUUID();
    projectId = randomUUID();
    issueId = randomUUID();
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
      adapterType: "claude_local",
      runtimeConfig: {},
      status: "active",
    });

    await db.insert(projects).values({
      id: projectId,
      companyId,
      name: "TestProject",
    });

    await db.insert(projectWorkspaces).values({
      id: workspaceId,
      companyId,
      projectId,
      name: "Primary Workspace",
      cwd: "/tmp/test-workspace",
      isPrimary: true,
    });

    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Test Issue",
      status: "todo",
      projectId,
      assigneeAgentId: agentId,
    });
  }

  it("lookup skips workspace with active DB lease", async () => {
    await seedTestData();

    const pool = createWarmWorkspacePool({
      hasActiveLease: async (wsId) => {
        const [row] = await db
          .select({ id: executionLeases.id })
          .from(executionLeases)
          .where(
            sql`${executionLeases.issueId} IN (
              SELECT id FROM issues WHERE project_workspace_id = ${wsId}
              OR project_id IN (
                SELECT project_id FROM project_workspaces WHERE id = ${wsId}
              )
            )
            AND ${executionLeases.state} IN ('granted', 'renewed')`,
          )
          .limit(1);
        return !!row;
      },
    });

    pool.register({
      workspaceId,
      cwd: "/tmp/test-workspace",
      projectId,
      projectWorkspaceId: workspaceId,
    });

    // No lease yet — should return workspace
    const result1 = await pool.lookup(projectId);
    expect(result1).not.toBeNull();
    expect(result1!.workspaceId).toBe(workspaceId);

    // Create active lease
    await db.insert(executionLeases).values({
      leaseType: "issue_execution",
      issueId,
      agentId,
      state: "granted",
      companyId,
      grantedAt: new Date(),
      expiresAt: new Date(Date.now() + 300_000),
    });

    // Now lookup should skip the leased workspace
    const result2 = await pool.lookup(projectId);
    expect(result2).toBeNull();

    pool.destroy();
  });

  it("completed run workspace can be registered and looked up", async () => {
    await seedTestData();

    const pool = createWarmWorkspacePool({
      hasActiveLease: async () => false,
    });

    // Simulate what happens after a run completes
    pool.register({
      workspaceId,
      cwd: "/tmp/test-workspace",
      projectId,
      projectWorkspaceId: workspaceId,
    });

    const result = await pool.lookup(projectId);
    expect(result).not.toBeNull();
    expect(result!.workspaceId).toBe(workspaceId);
    expect(result!.cwd).toBe("/tmp/test-workspace");
    expect(result!.projectId).toBe(projectId);

    pool.destroy();
  });
});
