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
import { leaseManagerService, DEFAULT_LEASE_TTL_SEC } from "../services/lease-manager.js";
import { sql } from "drizzle-orm";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeDB = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres lease-renewal-on-activity tests: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeDB("lease renewal on activity (VAL-HARD-026)", () => {
  let db!: ReturnType<typeof createDb>;
  let svc!: ReturnType<typeof leaseManagerService>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  let companyId: string;
  let agentId: string;
  let projectId: string;
  let issueId: string;
  let runId: string;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("lease-renew-act-");
    db = createDb(tempDb.connectionString);
    svc = leaseManagerService(db);
  }, 30_000);

  afterEach(async () => {
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
      status: "in_progress",
      priority: "medium",
      projectId,
    });

    await db.insert(heartbeatRuns).values({
      id: runId,
      companyId,
      agentId,
      invocationSource: "scheduler",
      status: "running",
    });
  }

  // ─── Comment creation renews active lease ─────────────────────────────────

  describe("comment creation renews active lease", () => {
    it("renewLeaseForIssueActivity renews lease when active lease exists", async () => {
      await seedTestData();
      const lease = await svc.grantLease({
        leaseType: "issue_execution_lease",
        issueId,
        agentId,
        runId,
        companyId,
        ttlSeconds: 120,
      });

      // Wait a brief moment so times are distinguishable
      await new Promise((r) => setTimeout(r, 50));

      const renewed = await svc.renewLeaseForIssueActivity(issueId);
      expect(renewed).not.toBeNull();
      expect(renewed!.id).toBe(lease.id);
      expect(renewed!.state).toBe("renewed");
      expect(renewed!.renewedAt).not.toBeNull();
      expect(new Date(renewed!.expiresAt).getTime()).toBeGreaterThan(
        new Date(lease.expiresAt).getTime(),
      );
    });

    it("renewLeaseForIssueActivity returns null when no active lease exists", async () => {
      await seedTestData();
      const result = await svc.renewLeaseForIssueActivity(issueId);
      expect(result).toBeNull();
    });

    it("renewLeaseForIssueActivity returns null for expired lease", async () => {
      await seedTestData();
      const lease = await svc.grantLease({
        leaseType: "issue_execution_lease",
        issueId,
        agentId,
        runId,
        companyId,
        ttlSeconds: 120,
      });

      // Expire the lease manually
      await svc.releaseLease(lease.id, "test-expired");

      const result = await svc.renewLeaseForIssueActivity(issueId);
      expect(result).toBeNull();
    });
  });

  // ─── Issue status change renews active lease ──────────────────────────────

  describe("issue status change renews active lease", () => {
    it("renewLeaseForIssueActivity renews when called after status change", async () => {
      await seedTestData();
      const lease = await svc.grantLease({
        leaseType: "issue_execution_lease",
        issueId,
        agentId,
        runId,
        companyId,
        ttlSeconds: 180,
      });

      await new Promise((r) => setTimeout(r, 50));

      const renewed = await svc.renewLeaseForIssueActivity(issueId);
      expect(renewed).not.toBeNull();
      expect(renewed!.state).toBe("renewed");
      expect(renewed!.renewedAt).not.toBeNull();
      // New expiry should be now + 180s (original TTL preserved)
      const nowMs = Date.now();
      const renewedExpiryMs = new Date(renewed!.expiresAt).getTime();
      // Should be roughly now + 180s (allow 5s tolerance)
      expect(renewedExpiryMs).toBeGreaterThan(nowMs + 175_000);
      expect(renewedExpiryMs).toBeLessThan(nowMs + 185_000);
    });
  });

  // ─── Explicit keepalive renews active lease ───────────────────────────────

  describe("explicit keepalive renews active lease", () => {
    it("renewLeaseForRunActivity renews by runId", async () => {
      await seedTestData();
      const lease = await svc.grantLease({
        leaseType: "issue_execution_lease",
        issueId,
        agentId,
        runId,
        companyId,
        ttlSeconds: 200,
      });

      await new Promise((r) => setTimeout(r, 50));

      const renewed = await svc.renewLeaseForRunActivity(runId);
      expect(renewed).not.toBeNull();
      expect(renewed!.id).toBe(lease.id);
      expect(renewed!.state).toBe("renewed");
      expect(renewed!.renewedAt).not.toBeNull();
      expect(new Date(renewed!.expiresAt).getTime()).toBeGreaterThan(
        new Date(lease.expiresAt).getTime(),
      );
    });

    it("renewLeaseForRunActivity returns null when no active lease exists for run", async () => {
      await seedTestData();
      const result = await svc.renewLeaseForRunActivity(runId);
      expect(result).toBeNull();
    });

    it("renewLeaseForRunActivity returns null for non-existent runId", async () => {
      await seedTestData();
      const result = await svc.renewLeaseForRunActivity(randomUUID());
      expect(result).toBeNull();
    });
  });

  // ─── Lease renewedAt updated on activity ──────────────────────────────────

  describe("lease renewedAt updated on activity", () => {
    it("renewedAt is set after renewal", async () => {
      await seedTestData();
      const lease = await svc.grantLease({
        leaseType: "issue_execution_lease",
        issueId,
        agentId,
        runId,
        companyId,
      });

      expect(lease.renewedAt).toBeNull();

      const renewed = await svc.renewLeaseForIssueActivity(issueId);
      expect(renewed).not.toBeNull();
      expect(renewed!.renewedAt).not.toBeNull();
      expect(new Date(renewed!.renewedAt!).getTime()).toBeGreaterThan(0);
    });

    it("multiple renewals keep updating renewedAt", async () => {
      await seedTestData();
      await svc.grantLease({
        leaseType: "issue_execution_lease",
        issueId,
        agentId,
        runId,
        companyId,
      });

      const renewed1 = await svc.renewLeaseForIssueActivity(issueId);
      expect(renewed1).not.toBeNull();

      await new Promise((r) => setTimeout(r, 50));

      const renewed2 = await svc.renewLeaseForIssueActivity(issueId);
      expect(renewed2).not.toBeNull();
      expect(new Date(renewed2!.renewedAt!).getTime()).toBeGreaterThanOrEqual(
        new Date(renewed1!.renewedAt!).getTime(),
      );
    });
  });
});
