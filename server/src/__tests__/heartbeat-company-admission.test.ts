import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { agentWakeupRequests, agents, companies, createDb, heartbeatRuns } from "@papierklammer/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { heartbeatService } from "../services/heartbeat.js";
import { eq } from "drizzle-orm";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeDB = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping heartbeat company admission tests: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeDB("heartbeat company lifecycle admission gate", () => {
  let db!: ReturnType<typeof createDb>;
  let heartbeat!: ReturnType<typeof heartbeatService>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("heartbeat-company-admission-");
    db = createDb(tempDb.connectionString);
    heartbeat = heartbeatService(db);
  }, 30_000);

  afterEach(async () => {
    await db.delete(heartbeatRuns);
    await db.delete(agentWakeupRequests);
    await db.delete(agents);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seedAgent(companyStatus: "paused" | "archived") {
    const companyId = randomUUID();
    const agentId = randomUUID();

    await db.insert(companies).values({
      id: companyId,
      name: "Lifecycle Co",
      status: companyStatus,
      pausedAt: companyStatus === "paused" ? new Date() : null,
      issuePrefix: "LIF",
      requireBoardApprovalForNewAgents: false,
    });

    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "Runner",
      role: "engineer",
      status: "active",
      adapterType: "process",
      adapterConfig: {
        command: process.execPath,
        args: ["-e", "setTimeout(() => process.exit(0), 10)"],
      },
      runtimeConfig: {},
      permissions: {},
    });

    return { companyId, agentId };
  }

  it.each([
    ["paused", "company.paused"],
    ["archived", "company.archived"],
  ] as const)("rejects wakeup for %s companies without creating a run", async (companyStatus, skipReason) => {
    const { agentId } = await seedAgent(companyStatus);

    await expect(
      heartbeat.wakeup(agentId, {
        source: "on_demand",
        triggerDetail: "manual",
        requestedByActorType: "user",
        requestedByActorId: "board",
      }),
    ).rejects.toThrow("cannot start new work");

    const runs = await db.select().from(heartbeatRuns);
    expect(runs).toHaveLength(0);

    const wakeups = await db.select().from(agentWakeupRequests);
    expect(wakeups).toHaveLength(1);
    expect(wakeups[0]?.status).toBe("skipped");
    expect(wakeups[0]?.reason).toBe(skipReason);
  });

  it.each([
    ["paused", "company.paused"],
    ["archived", "company.archived"],
  ] as const)("rejects invoke for %s companies without creating a run", async (companyStatus, skipReason) => {
    const { agentId } = await seedAgent(companyStatus);

    await expect(
      heartbeat.invoke(
        agentId,
        "on_demand",
        { source: "manual-test" },
        "manual",
        { actorType: "user", actorId: "board" },
      ),
    ).rejects.toThrow("cannot start new work");

    const runs = await db.select().from(heartbeatRuns);
    expect(runs).toHaveLength(0);

    const wakeups = await db
      .select()
      .from(agentWakeupRequests)
      .where(eq(agentWakeupRequests.agentId, agentId));
    expect(wakeups).toHaveLength(1);
    expect(wakeups[0]?.status).toBe("skipped");
    expect(wakeups[0]?.reason).toBe(skipReason);
  });
});
