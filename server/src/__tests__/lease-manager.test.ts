import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  agents,
  companies,
  createDb,
  executionLeases,
  heartbeatRuns,
  issues,
  projects,
} from "@papierklammer/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { leaseManagerService, DEFAULT_LEASE_TTL_SEC, CHECKOUT_TTL_SEC } from "../services/lease-manager.js";
import { eq, sql } from "drizzle-orm";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeDB = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres lease manager tests: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeDB("leaseManagerService", () => {
  let db!: ReturnType<typeof createDb>;
  let svc!: ReturnType<typeof leaseManagerService>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  // Shared test data IDs
  let companyId: string;
  let agentId: string;
  let projectId: string;
  let issueId: string;
  let runId: string;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("lease-mgr-");
    db = createDb(tempDb.connectionString);
    svc = leaseManagerService(db);
  }, 30_000);

  afterEach(async () => {
    // Use TRUNCATE CASCADE to handle all FK constraints cleanly
    await db.execute(sql`TRUNCATE TABLE
      execution_leases,
      heartbeat_runs,
      issues,
      projects,
      agents,
      companies
      CASCADE`);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  /** Helper: seed company + agent + project + issue + run */
  async function seedTestData() {
    companyId = randomUUID();
    agentId = randomUUID();
    projectId = randomUUID();
    issueId = randomUUID();
    runId = randomUUID();

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
      status: "active",
    });

    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Test Issue",
      status: "todo",
      priority: "medium",
      projectId,
    });

    await db.insert(heartbeatRuns).values({
      id: runId,
      companyId,
      agentId,
      invocationSource: "scheduler",
      status: "queued",
    });
  }

  // ─── Constants ─────────────────────────────────────────────────────────────

  describe("constants", () => {
    it("has default TTL of 300 seconds (5 min)", () => {
      expect(DEFAULT_LEASE_TTL_SEC).toBe(300);
    });

    it("has checkout TTL of 60 seconds", () => {
      expect(CHECKOUT_TTL_SEC).toBe(60);
    });
  });

  // ─── VAL-HARD-020: Lease granted on admission ─────────────────────────────

  describe("grantLease", () => {
    it("creates lease with state=granted and correct expiry", async () => {
      await seedTestData();
      const now = new Date();

      const lease = await svc.grantLease({
        leaseType: "issue_execution_lease",
        issueId,
        agentId,
        runId,
        companyId,
        ttlSeconds: DEFAULT_LEASE_TTL_SEC,
      });

      expect(lease).toBeDefined();
      expect(lease.id).toBeDefined();
      expect(lease.leaseType).toBe("issue_execution_lease");
      expect(lease.issueId).toBe(issueId);
      expect(lease.agentId).toBe(agentId);
      expect(lease.runId).toBe(runId);
      expect(lease.companyId).toBe(companyId);
      expect(lease.state).toBe("granted");
      expect(lease.grantedAt).toBeInstanceOf(Date);
      expect(lease.expiresAt).toBeInstanceOf(Date);

      // Verify expiry is now + ttl (within 2 seconds tolerance)
      const expectedExpiry = new Date(now.getTime() + DEFAULT_LEASE_TTL_SEC * 1000);
      const diff = Math.abs(lease.expiresAt.getTime() - expectedExpiry.getTime());
      expect(diff).toBeLessThan(2000);
    });

    it("creates lease with custom TTL", async () => {
      await seedTestData();
      const customTtl = 120;
      const now = new Date();

      const lease = await svc.grantLease({
        leaseType: "issue_execution_lease",
        issueId,
        agentId,
        runId,
        companyId,
        ttlSeconds: customTtl,
      });

      const expectedExpiry = new Date(now.getTime() + customTtl * 1000);
      const diff = Math.abs(lease.expiresAt.getTime() - expectedExpiry.getTime());
      expect(diff).toBeLessThan(2000);
    });

    it("creates lease with checkout TTL", async () => {
      await seedTestData();
      const now = new Date();

      const lease = await svc.grantLease({
        leaseType: "issue_execution_lease",
        issueId,
        agentId,
        runId,
        companyId,
        ttlSeconds: CHECKOUT_TTL_SEC,
      });

      const expectedExpiry = new Date(now.getTime() + CHECKOUT_TTL_SEC * 1000);
      const diff = Math.abs(lease.expiresAt.getTime() - expectedExpiry.getTime());
      expect(diff).toBeLessThan(2000);
    });

    it("uses default TTL when ttlSeconds is not provided", async () => {
      await seedTestData();
      const now = new Date();

      const lease = await svc.grantLease({
        leaseType: "issue_execution_lease",
        issueId,
        agentId,
        runId,
        companyId,
      });

      const expectedExpiry = new Date(now.getTime() + DEFAULT_LEASE_TTL_SEC * 1000);
      const diff = Math.abs(lease.expiresAt.getTime() - expectedExpiry.getTime());
      expect(diff).toBeLessThan(2000);
    });

    // ─── VAL-HARD-021: One active lease per issue enforced ──────────────────

    it("throws conflict error when active (granted) lease exists for issue", async () => {
      await seedTestData();

      // Grant first lease
      await svc.grantLease({
        leaseType: "issue_execution_lease",
        issueId,
        agentId,
        runId,
        companyId,
      });

      // Create second run for second lease attempt
      const runId2 = randomUUID();
      await db.insert(heartbeatRuns).values({
        id: runId2,
        companyId,
        agentId,
        invocationSource: "scheduler",
        status: "queued",
      });

      // Attempt second lease should fail with conflict
      await expect(
        svc.grantLease({
          leaseType: "issue_execution_lease",
          issueId,
          agentId,
          runId: runId2,
          companyId,
        }),
      ).rejects.toThrow(/conflict|active lease/i);
    });

    it("throws conflict error when active (renewed) lease exists for issue", async () => {
      await seedTestData();

      // Grant and renew first lease
      const lease = await svc.grantLease({
        leaseType: "issue_execution_lease",
        issueId,
        agentId,
        runId,
        companyId,
      });
      await svc.renewLease(lease.id);

      // Create second run
      const runId2 = randomUUID();
      await db.insert(heartbeatRuns).values({
        id: runId2,
        companyId,
        agentId,
        invocationSource: "scheduler",
        status: "queued",
      });

      // Attempt second lease should fail
      await expect(
        svc.grantLease({
          leaseType: "issue_execution_lease",
          issueId,
          agentId,
          runId: runId2,
          companyId,
        }),
      ).rejects.toThrow(/conflict|active lease/i);
    });

    it("allows granting lease when existing lease is expired", async () => {
      await seedTestData();

      // Manually insert an expired lease
      await db.insert(executionLeases).values({
        leaseType: "issue_execution_lease",
        issueId,
        agentId,
        runId,
        state: "expired",
        companyId,
        grantedAt: new Date(Date.now() - 600_000),
        expiresAt: new Date(Date.now() - 300_000),
      });

      // Create a second run
      const runId2 = randomUUID();
      await db.insert(heartbeatRuns).values({
        id: runId2,
        companyId,
        agentId,
        invocationSource: "scheduler",
        status: "queued",
      });

      // Should succeed
      const lease = await svc.grantLease({
        leaseType: "issue_execution_lease",
        issueId,
        agentId,
        runId: runId2,
        companyId,
      });
      expect(lease.state).toBe("granted");
    });

    it("allows granting lease when existing lease is released", async () => {
      await seedTestData();

      // Manually insert a released lease
      await db.insert(executionLeases).values({
        leaseType: "issue_execution_lease",
        issueId,
        agentId,
        runId,
        state: "released",
        companyId,
        grantedAt: new Date(Date.now() - 600_000),
        expiresAt: new Date(Date.now() - 300_000),
        releasedAt: new Date(Date.now() - 300_000),
        releaseReason: "run completed",
      });

      // Create second run
      const runId2 = randomUUID();
      await db.insert(heartbeatRuns).values({
        id: runId2,
        companyId,
        agentId,
        invocationSource: "scheduler",
        status: "queued",
      });

      const lease = await svc.grantLease({
        leaseType: "issue_execution_lease",
        issueId,
        agentId,
        runId: runId2,
        companyId,
      });
      expect(lease.state).toBe("granted");
    });

    // ─── Concurrent grant attempts: exactly one succeeds ────────────────────

    it("handles concurrent grant attempts — exactly one succeeds", async () => {
      await seedTestData();

      // Create additional runs for concurrent attempts
      const runId2 = randomUUID();
      const runId3 = randomUUID();
      await db.insert(heartbeatRuns).values([
        { id: runId2, companyId, agentId, invocationSource: "scheduler", status: "queued" },
        { id: runId3, companyId, agentId, invocationSource: "scheduler", status: "queued" },
      ]);

      // Launch 3 concurrent lease grants
      const results = await Promise.allSettled([
        svc.grantLease({
          leaseType: "issue_execution_lease",
          issueId,
          agentId,
          runId,
          companyId,
        }),
        svc.grantLease({
          leaseType: "issue_execution_lease",
          issueId,
          agentId,
          runId: runId2,
          companyId,
        }),
        svc.grantLease({
          leaseType: "issue_execution_lease",
          issueId,
          agentId,
          runId: runId3,
          companyId,
        }),
      ]);

      const succeeded = results.filter((r) => r.status === "fulfilled");
      const failed = results.filter((r) => r.status === "rejected");

      // Exactly one should succeed
      expect(succeeded.length).toBe(1);
      expect(failed.length).toBe(2);

      // Verify only one active lease in DB
      const activeLeases = await db
        .select()
        .from(executionLeases)
        .where(eq(executionLeases.issueId, issueId));
      const activeCount = activeLeases.filter(
        (l) => l.state === "granted" || l.state === "renewed",
      ).length;
      expect(activeCount).toBe(1);
    });
  });

  // ─── VAL-HARD-022: Lease renewal extends expiry ───────────────────────────

  describe("renewLease", () => {
    it("updates state to renewed, sets renewedAt, and extends expiresAt", async () => {
      await seedTestData();

      const lease = await svc.grantLease({
        leaseType: "issue_execution_lease",
        issueId,
        agentId,
        runId,
        companyId,
        ttlSeconds: DEFAULT_LEASE_TTL_SEC,
      });

      const originalExpiresAt = lease.expiresAt;

      // Small delay so renewal is visibly different
      await new Promise((r) => setTimeout(r, 50));

      const renewed = await svc.renewLease(lease.id);

      expect(renewed.state).toBe("renewed");
      expect(renewed.renewedAt).toBeInstanceOf(Date);
      expect(renewed.expiresAt.getTime()).toBeGreaterThan(originalExpiresAt.getTime());

      // Verify the new expiresAt is now() + original TTL
      const now = new Date();
      const expectedExpiry = new Date(now.getTime() + DEFAULT_LEASE_TTL_SEC * 1000);
      const diff = Math.abs(renewed.expiresAt.getTime() - expectedExpiry.getTime());
      expect(diff).toBeLessThan(2000);
    });

    it("renews an already-renewed lease (extends again)", async () => {
      await seedTestData();

      const lease = await svc.grantLease({
        leaseType: "issue_execution_lease",
        issueId,
        agentId,
        runId,
        companyId,
      });

      const renewed1 = await svc.renewLease(lease.id);
      expect(renewed1.state).toBe("renewed");

      await new Promise((r) => setTimeout(r, 50));

      const renewed2 = await svc.renewLease(lease.id);
      expect(renewed2.state).toBe("renewed");
      expect(renewed2.renewedAt!.getTime()).toBeGreaterThanOrEqual(renewed1.renewedAt!.getTime());
      expect(renewed2.expiresAt.getTime()).toBeGreaterThanOrEqual(renewed1.expiresAt.getTime());
    });

    it("throws error when renewing an expired lease", async () => {
      await seedTestData();

      // Insert an expired lease directly
      const [lease] = await db
        .insert(executionLeases)
        .values({
          leaseType: "issue_execution_lease",
          issueId,
          agentId,
          runId,
          state: "expired",
          companyId,
          grantedAt: new Date(Date.now() - 600_000),
          expiresAt: new Date(Date.now() - 300_000),
        })
        .returning();

      await expect(svc.renewLease(lease.id)).rejects.toThrow(/expired|released|not active/i);
    });

    it("throws error when renewing a released lease", async () => {
      await seedTestData();

      const lease = await svc.grantLease({
        leaseType: "issue_execution_lease",
        issueId,
        agentId,
        runId,
        companyId,
      });

      await svc.releaseLease(lease.id, "run completed");

      await expect(svc.renewLease(lease.id)).rejects.toThrow(/expired|released|not active/i);
    });

    it("throws error for non-existent lease ID", async () => {
      await seedTestData();
      await expect(svc.renewLease(randomUUID())).rejects.toThrow(/not found/i);
    });
  });

  // ─── VAL-HARD-024: Lease release on run completion ────────────────────────

  describe("releaseLease", () => {
    it("sets state=released, releasedAt=now(), releaseReason", async () => {
      await seedTestData();

      const lease = await svc.grantLease({
        leaseType: "issue_execution_lease",
        issueId,
        agentId,
        runId,
        companyId,
      });

      const released = await svc.releaseLease(lease.id, "run completed");

      expect(released.state).toBe("released");
      expect(released.releasedAt).toBeInstanceOf(Date);
      expect(released.releaseReason).toBe("run completed");
    });

    it("releases a renewed lease", async () => {
      await seedTestData();

      const lease = await svc.grantLease({
        leaseType: "issue_execution_lease",
        issueId,
        agentId,
        runId,
        companyId,
      });

      await svc.renewLease(lease.id);
      const released = await svc.releaseLease(lease.id, "run completed");

      expect(released.state).toBe("released");
    });

    it("throws error when releasing an already-expired lease", async () => {
      await seedTestData();

      const [lease] = await db
        .insert(executionLeases)
        .values({
          leaseType: "issue_execution_lease",
          issueId,
          agentId,
          runId,
          state: "expired",
          companyId,
          grantedAt: new Date(Date.now() - 600_000),
          expiresAt: new Date(Date.now() - 300_000),
        })
        .returning();

      await expect(svc.releaseLease(lease.id, "cleanup")).rejects.toThrow(/not active/i);
    });

    it("throws error when releasing an already-released lease", async () => {
      await seedTestData();

      const lease = await svc.grantLease({
        leaseType: "issue_execution_lease",
        issueId,
        agentId,
        runId,
        companyId,
      });

      await svc.releaseLease(lease.id, "first release");

      await expect(svc.releaseLease(lease.id, "second release")).rejects.toThrow(/not active/i);
    });

    it("throws error for non-existent lease ID", async () => {
      await seedTestData();
      await expect(svc.releaseLease(randomUUID(), "reason")).rejects.toThrow(/not found/i);
    });
  });

  // ─── VAL-HARD-023: Expired lease transitions to expired state ─────────────

  describe("expireLeases", () => {
    it("expires leases past their expiresAt (granted state)", async () => {
      await seedTestData();

      // Insert a lease that should be expired
      const [lease] = await db
        .insert(executionLeases)
        .values({
          leaseType: "issue_execution_lease",
          issueId,
          agentId,
          runId,
          state: "granted",
          companyId,
          grantedAt: new Date(Date.now() - 600_000),
          expiresAt: new Date(Date.now() - 100), // just expired
        })
        .returning();

      const expiredIds = await svc.expireLeases();

      expect(expiredIds).toContain(lease.id);

      // Verify state changed in DB
      const [updated] = await db
        .select()
        .from(executionLeases)
        .where(eq(executionLeases.id, lease.id));
      expect(updated.state).toBe("expired");
    });

    it("expires leases past their expiresAt (renewed state)", async () => {
      await seedTestData();

      // Insert a renewed lease that should be expired
      const [lease] = await db
        .insert(executionLeases)
        .values({
          leaseType: "issue_execution_lease",
          issueId,
          agentId,
          runId,
          state: "renewed",
          companyId,
          grantedAt: new Date(Date.now() - 600_000),
          renewedAt: new Date(Date.now() - 400_000),
          expiresAt: new Date(Date.now() - 100), // just expired
        })
        .returning();

      const expiredIds = await svc.expireLeases();

      expect(expiredIds).toContain(lease.id);

      const [updated] = await db
        .select()
        .from(executionLeases)
        .where(eq(executionLeases.id, lease.id));
      expect(updated.state).toBe("expired");
    });

    it("does not expire leases that have not reached expiresAt", async () => {
      await seedTestData();

      const lease = await svc.grantLease({
        leaseType: "issue_execution_lease",
        issueId,
        agentId,
        runId,
        companyId,
        ttlSeconds: DEFAULT_LEASE_TTL_SEC,
      });

      const expiredIds = await svc.expireLeases();

      expect(expiredIds).not.toContain(lease.id);

      // Verify state is still granted
      const [row] = await db
        .select()
        .from(executionLeases)
        .where(eq(executionLeases.id, lease.id));
      expect(row.state).toBe("granted");
    });

    it("does not expire already-released leases", async () => {
      await seedTestData();

      // Insert a released lease that is past expiry
      const [lease] = await db
        .insert(executionLeases)
        .values({
          leaseType: "issue_execution_lease",
          issueId,
          agentId,
          runId,
          state: "released",
          companyId,
          grantedAt: new Date(Date.now() - 600_000),
          expiresAt: new Date(Date.now() - 300_000),
          releasedAt: new Date(Date.now() - 300_000),
          releaseReason: "run completed",
        })
        .returning();

      const expiredIds = await svc.expireLeases();

      expect(expiredIds).not.toContain(lease.id);
    });

    it("does not expire already-expired leases", async () => {
      await seedTestData();

      const [lease] = await db
        .insert(executionLeases)
        .values({
          leaseType: "issue_execution_lease",
          issueId,
          agentId,
          runId,
          state: "expired",
          companyId,
          grantedAt: new Date(Date.now() - 600_000),
          expiresAt: new Date(Date.now() - 300_000),
        })
        .returning();

      const expiredIds = await svc.expireLeases();

      expect(expiredIds).not.toContain(lease.id);
    });

    it("returns empty array when no leases need expiry", async () => {
      await seedTestData();
      const expiredIds = await svc.expireLeases();
      expect(expiredIds).toEqual([]);
    });

    it("expires multiple leases at once", async () => {
      await seedTestData();

      // Create second issue
      const issueId2 = randomUUID();
      await db.insert(issues).values({
        id: issueId2,
        companyId,
        title: "Test Issue 2",
        status: "todo",
        priority: "medium",
        projectId,
      });

      // Insert two expired leases
      const [lease1] = await db
        .insert(executionLeases)
        .values({
          leaseType: "issue_execution_lease",
          issueId,
          agentId,
          runId,
          state: "granted",
          companyId,
          grantedAt: new Date(Date.now() - 600_000),
          expiresAt: new Date(Date.now() - 100),
        })
        .returning();

      const runId2 = randomUUID();
      await db.insert(heartbeatRuns).values({
        id: runId2,
        companyId,
        agentId,
        invocationSource: "scheduler",
        status: "queued",
      });

      const [lease2] = await db
        .insert(executionLeases)
        .values({
          leaseType: "issue_execution_lease",
          issueId: issueId2,
          agentId,
          runId: runId2,
          state: "renewed",
          companyId,
          grantedAt: new Date(Date.now() - 600_000),
          renewedAt: new Date(Date.now() - 400_000),
          expiresAt: new Date(Date.now() - 100),
        })
        .returning();

      const expiredIds = await svc.expireLeases();

      expect(expiredIds).toHaveLength(2);
      expect(expiredIds).toContain(lease1.id);
      expect(expiredIds).toContain(lease2.id);
    });
  });

  // ─── getActiveLease ────────────────────────────────────────────────────────

  describe("getActiveLease", () => {
    it("returns active lease for an issue", async () => {
      await seedTestData();

      const lease = await svc.grantLease({
        leaseType: "issue_execution_lease",
        issueId,
        agentId,
        runId,
        companyId,
      });

      const active = await svc.getActiveLease(issueId);

      expect(active).toBeDefined();
      expect(active!.id).toBe(lease.id);
      expect(active!.state).toBe("granted");
    });

    it("returns renewed lease as active", async () => {
      await seedTestData();

      const lease = await svc.grantLease({
        leaseType: "issue_execution_lease",
        issueId,
        agentId,
        runId,
        companyId,
      });

      await svc.renewLease(lease.id);

      const active = await svc.getActiveLease(issueId);

      expect(active).toBeDefined();
      expect(active!.id).toBe(lease.id);
      expect(active!.state).toBe("renewed");
    });

    it("returns null when no active lease exists", async () => {
      await seedTestData();

      const active = await svc.getActiveLease(issueId);
      expect(active).toBeNull();
    });

    it("returns null when lease is expired", async () => {
      await seedTestData();

      await db.insert(executionLeases).values({
        leaseType: "issue_execution_lease",
        issueId,
        agentId,
        runId,
        state: "expired",
        companyId,
        grantedAt: new Date(Date.now() - 600_000),
        expiresAt: new Date(Date.now() - 300_000),
      });

      const active = await svc.getActiveLease(issueId);
      expect(active).toBeNull();
    });

    it("returns null when lease is released", async () => {
      await seedTestData();

      await db.insert(executionLeases).values({
        leaseType: "issue_execution_lease",
        issueId,
        agentId,
        runId,
        state: "released",
        companyId,
        grantedAt: new Date(Date.now() - 600_000),
        expiresAt: new Date(Date.now() - 300_000),
        releasedAt: new Date(Date.now() - 300_000),
        releaseReason: "run completed",
      });

      const active = await svc.getActiveLease(issueId);
      expect(active).toBeNull();
    });
  });

  // ─── getActiveLeaseForAgent ────────────────────────────────────────────────

  describe("getActiveLeaseForAgent", () => {
    it("returns active lease for an agent", async () => {
      await seedTestData();

      const lease = await svc.grantLease({
        leaseType: "issue_execution_lease",
        issueId,
        agentId,
        runId,
        companyId,
      });

      const active = await svc.getActiveLeaseForAgent(agentId);

      expect(active).toBeDefined();
      expect(active!.id).toBe(lease.id);
      expect(active!.agentId).toBe(agentId);
    });

    it("returns null when agent has no active lease", async () => {
      await seedTestData();

      const active = await svc.getActiveLeaseForAgent(agentId);
      expect(active).toBeNull();
    });

    it("returns null when agent's lease is expired", async () => {
      await seedTestData();

      await db.insert(executionLeases).values({
        leaseType: "issue_execution_lease",
        issueId,
        agentId,
        runId,
        state: "expired",
        companyId,
        grantedAt: new Date(Date.now() - 600_000),
        expiresAt: new Date(Date.now() - 300_000),
      });

      const active = await svc.getActiveLeaseForAgent(agentId);
      expect(active).toBeNull();
    });

    it("returns null when agent's lease is released", async () => {
      await seedTestData();

      await db.insert(executionLeases).values({
        leaseType: "issue_execution_lease",
        issueId,
        agentId,
        runId,
        state: "released",
        companyId,
        grantedAt: new Date(Date.now() - 600_000),
        expiresAt: new Date(Date.now() - 300_000),
        releasedAt: new Date(Date.now() - 300_000),
        releaseReason: "run completed",
      });

      const active = await svc.getActiveLeaseForAgent(agentId);
      expect(active).toBeNull();
    });

    it("returns renewed lease for agent", async () => {
      await seedTestData();

      const lease = await svc.grantLease({
        leaseType: "issue_execution_lease",
        issueId,
        agentId,
        runId,
        companyId,
      });

      await svc.renewLease(lease.id);

      const active = await svc.getActiveLeaseForAgent(agentId);

      expect(active).toBeDefined();
      expect(active!.state).toBe("renewed");
    });
  });

  // ─── VAL-HARD-025/026: Lease renewal on agent activity ────────────────────

  describe("integration scenarios", () => {
    it("full lifecycle: grant → renew → release", async () => {
      await seedTestData();

      // Grant
      const lease = await svc.grantLease({
        leaseType: "issue_execution_lease",
        issueId,
        agentId,
        runId,
        companyId,
      });
      expect(lease.state).toBe("granted");

      // Renew
      const renewed = await svc.renewLease(lease.id);
      expect(renewed.state).toBe("renewed");
      expect(renewed.renewedAt).toBeInstanceOf(Date);

      // Release
      const released = await svc.releaseLease(lease.id, "work done");
      expect(released.state).toBe("released");
      expect(released.releasedAt).toBeInstanceOf(Date);
      expect(released.releaseReason).toBe("work done");

      // Active lease should now be null
      const active = await svc.getActiveLease(issueId);
      expect(active).toBeNull();
    });

    it("full lifecycle: grant → expire", async () => {
      await seedTestData();

      // Insert lease with expired time
      const [lease] = await db
        .insert(executionLeases)
        .values({
          leaseType: "issue_execution_lease",
          issueId,
          agentId,
          runId,
          state: "granted",
          companyId,
          grantedAt: new Date(Date.now() - 600_000),
          expiresAt: new Date(Date.now() - 100),
        })
        .returning();

      // Expire
      const expiredIds = await svc.expireLeases();
      expect(expiredIds).toContain(lease.id);

      // Active lease should be null
      const active = await svc.getActiveLease(issueId);
      expect(active).toBeNull();
    });

    it("after release, a new lease can be granted for the same issue", async () => {
      await seedTestData();

      // Grant and release
      const lease1 = await svc.grantLease({
        leaseType: "issue_execution_lease",
        issueId,
        agentId,
        runId,
        companyId,
      });
      await svc.releaseLease(lease1.id, "done");

      // Create new run
      const runId2 = randomUUID();
      await db.insert(heartbeatRuns).values({
        id: runId2,
        companyId,
        agentId,
        invocationSource: "scheduler",
        status: "queued",
      });

      // Grant again
      const lease2 = await svc.grantLease({
        leaseType: "issue_execution_lease",
        issueId,
        agentId,
        runId: runId2,
        companyId,
      });
      expect(lease2.state).toBe("granted");
      expect(lease2.id).not.toBe(lease1.id);
    });

    it("after expiry, a new lease can be granted for the same issue", async () => {
      await seedTestData();

      // Insert and expire a lease
      await db.insert(executionLeases).values({
        leaseType: "issue_execution_lease",
        issueId,
        agentId,
        runId,
        state: "granted",
        companyId,
        grantedAt: new Date(Date.now() - 600_000),
        expiresAt: new Date(Date.now() - 100),
      });
      await svc.expireLeases();

      // Create new run
      const runId2 = randomUUID();
      await db.insert(heartbeatRuns).values({
        id: runId2,
        companyId,
        agentId,
        invocationSource: "scheduler",
        status: "queued",
      });

      // Grant again
      const lease = await svc.grantLease({
        leaseType: "issue_execution_lease",
        issueId,
        agentId,
        runId: runId2,
        companyId,
      });
      expect(lease.state).toBe("granted");
    });
  });

  // ─── TTL preservation on renewal ──────────────────────────────────────────

  describe("TTL preservation on renewal", () => {
    it("stores original TTL at grant time and reuses it for renewal", async () => {
      await seedTestData();
      const customTtl = 120; // 2 minutes

      const lease = await svc.grantLease({
        leaseType: "issue_execution_lease",
        issueId,
        agentId,
        runId,
        companyId,
        ttlSeconds: customTtl,
      });

      // Verify the TTL was stored
      const [row] = await db
        .select()
        .from(executionLeases)
        .where(eq(executionLeases.id, lease.id));
      expect(row.ttlSeconds).toBe(customTtl);

      // Wait briefly and renew
      await new Promise((r) => setTimeout(r, 50));

      const renewed = await svc.renewLease(lease.id);

      // The renewed expiresAt should be now() + original customTtl, not DEFAULT_LEASE_TTL_SEC
      const now = new Date();
      const expectedExpiry = new Date(now.getTime() + customTtl * 1000);
      const diff = Math.abs(renewed.expiresAt.getTime() - expectedExpiry.getTime());
      expect(diff).toBeLessThan(2000);

      // Specifically it should NOT be now + 300s (default TTL)
      const defaultExpiry = new Date(now.getTime() + DEFAULT_LEASE_TTL_SEC * 1000);
      const defaultDiff = Math.abs(renewed.expiresAt.getTime() - defaultExpiry.getTime());
      // If customTtl != DEFAULT_LEASE_TTL_SEC, the diff from default should be large
      expect(defaultDiff).toBeGreaterThan(100_000); // > 100 seconds difference
    });

    it("stores default TTL when no custom TTL provided", async () => {
      await seedTestData();

      const lease = await svc.grantLease({
        leaseType: "issue_execution_lease",
        issueId,
        agentId,
        runId,
        companyId,
      });

      const [row] = await db
        .select()
        .from(executionLeases)
        .where(eq(executionLeases.id, lease.id));
      expect(row.ttlSeconds).toBe(DEFAULT_LEASE_TTL_SEC);
    });

    it("preserves custom TTL across multiple renewals", async () => {
      await seedTestData();
      const customTtl = 60; // 1 minute

      const lease = await svc.grantLease({
        leaseType: "issue_execution_lease",
        issueId,
        agentId,
        runId,
        companyId,
        ttlSeconds: customTtl,
      });

      // First renewal
      await new Promise((r) => setTimeout(r, 30));
      const renewed1 = await svc.renewLease(lease.id);

      // Second renewal
      await new Promise((r) => setTimeout(r, 30));
      const renewed2 = await svc.renewLease(lease.id);

      // Both renewals should use the custom TTL
      const now = new Date();
      const expectedExpiry = new Date(now.getTime() + customTtl * 1000);
      const diff = Math.abs(renewed2.expiresAt.getTime() - expectedExpiry.getTime());
      expect(diff).toBeLessThan(2000);
    });
  });
});
