import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  activityLog,
  agents,
  companies,
  createDb,
  heartbeatRuns,
  issues,
} from "@papierklammer/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { activityService } from "../services/activity.ts";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres activity service tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("activityService issue trace fallback", () => {
  let db!: ReturnType<typeof createDb>;
  let svc!: ReturnType<typeof activityService>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-activity-service-");
    db = createDb(tempDb.connectionString);
    svc = activityService(db);
  }, 20_000);

  afterEach(async () => {
    await db.delete(activityLog);
    await db.delete(issues);
    await db.delete(heartbeatRuns);
    await db.delete(agents);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  it("falls back to issue originRunId for issue.created activity when the stored runId is null", async () => {
    const companyId = randomUUID();
    const issueId = randomUUID();
    const traceId = randomUUID();

    await db.insert(companies).values({
      id: companyId,
      name: "Papierklammer",
      issuePrefix: `ACT${companyId.replace(/-/g, "").slice(0, 4).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });

    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Trace me",
      status: "backlog",
      priority: "medium",
      identifier: "ACT-1",
      issueNumber: 1,
      originKind: "manual",
      originRunId: traceId,
      createdByUserId: "local-board",
    });

    await db.insert(activityLog).values({
      companyId,
      actorType: "user",
      actorId: "local-board",
      action: "issue.created",
      entityType: "issue",
      entityId: issueId,
      agentId: null,
      runId: null,
      details: { title: "Trace me", identifier: "ACT-1" },
    });

    const result = await svc.forIssue(issueId);

    expect(result).toHaveLength(1);
    expect(result[0]?.runId).toBe(traceId);
  });

  it("preserves an explicit heartbeat run id when one is stored on the activity row", async () => {
    const companyId = randomUUID();
    const agentId = randomUUID();
    const issueId = randomUUID();
    const runId = randomUUID();

    await db.insert(companies).values({
      id: companyId,
      name: "Papierklammer",
      issuePrefix: `ACT${companyId.replace(/-/g, "").slice(0, 4).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });

    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "Trace Agent",
      role: "engineer",
      status: "active",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });

    await db.insert(heartbeatRuns).values({
      id: runId,
      companyId,
      agentId,
      invocationSource: "manual",
      status: "succeeded",
    });

    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Trace me",
      status: "backlog",
      priority: "medium",
      identifier: "ACT-2",
      issueNumber: 2,
      originKind: "manual",
      originRunId: randomUUID(),
      createdByUserId: "local-board",
    });

    await db.insert(activityLog).values({
      companyId,
      actorType: "agent",
      actorId: agentId,
      action: "issue.created",
      entityType: "issue",
      entityId: issueId,
      agentId,
      runId,
      details: { title: "Trace me", identifier: "ACT-2" },
    });

    const result = await svc.forIssue(issueId);

    expect(result).toHaveLength(1);
    expect(result[0]?.runId).toBe(runId);
  });
});
