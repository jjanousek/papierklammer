import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import express from "express";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  activityLog,
  agentWakeupRequests,
  agents,
  companies,
  companyMemberships,
  controlPlaneEvents,
  createDb,
  dispatchIntents,
  heartbeatRunEvents,
  heartbeatRuns,
  instanceSettings,
  issues,
  principalPermissionGrants,
  projects,
  routineRuns,
  routines,
  routineTriggers,
} from "@papierklammer/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { errorHandler } from "../middleware/index.js";
import { accessService } from "../services/access.js";

// routineService no longer needs a heartbeat mock — it uses the intent queue
// (DB-backed) for assignment wakeups instead of heartbeat.wakeup().

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres routine route tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("routine routes end-to-end", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-routines-e2e-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(controlPlaneEvents);
    await db.delete(activityLog);
    await db.delete(routineRuns);
    await db.delete(routineTriggers);
    await db.delete(dispatchIntents);
    await db.delete(heartbeatRunEvents);
    await db.delete(heartbeatRuns);
    await db.delete(agentWakeupRequests);
    await db.delete(issues);
    await db.delete(principalPermissionGrants);
    await db.delete(companyMemberships);
    await db.delete(routines);
    await db.delete(projects);
    await db.delete(agents);
    await db.delete(companies);
    await db.delete(instanceSettings);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function createApp(actor: Record<string, unknown>) {
    const [
      { routineRoutes },
      { routineService },
      { accessService: createAccessService },
      { logActivity },
    ] = await Promise.all([
      import("../routes/routines.js"),
      import("../services/routines.js"),
      import("../services/access.js"),
      import("../services/activity-log.js"),
    ]);
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as any).actor = actor;
      next();
    });
    app.use(
      "/api",
      routineRoutes(db, {
        routineService: routineService(db),
        accessService: createAccessService(db),
        logActivity,
      }),
    );
    app.use(errorHandler);
    return app;
  }

  async function seedFixture() {
    const companyId = randomUUID();
    const agentId = randomUUID();
    const projectId = randomUUID();
    const userId = randomUUID();
    const issuePrefix = `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`;

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix,
      requireBoardApprovalForNewAgents: false,
    });

    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "CodexCoder",
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
      name: "Routine Project",
      status: "in_progress",
    });

    const access = accessService(db);
    const membership = await access.ensureMembership(companyId, "user", userId, "owner", "active");
    await access.setMemberPermissions(
      companyId,
      membership.id,
      [{ permissionKey: "tasks:assign" }],
      userId,
    );

    return { companyId, agentId, projectId, userId };
  }

  it("supports creating, scheduling, and manually running a routine through the API", async () => {
    const { companyId, agentId, projectId, userId } = await seedFixture();
    const app = await createApp({
      type: "board",
      userId,
      source: "session",
      isInstanceAdmin: false,
      companyIds: [companyId],
    });

    const createRes = await request(app)
      .post(`/api/companies/${companyId}/routines`)
      .send({
        projectId,
        title: "Daily standup prep",
        description: "Summarize blockers and open PRs",
        assigneeAgentId: agentId,
        priority: "high",
        concurrencyPolicy: "coalesce_if_active",
        catchUpPolicy: "skip_missed",
      });

    expect(createRes.status).toBe(201);
    expect(createRes.body.title).toBe("Daily standup prep");
    expect(createRes.body.assigneeAgentId).toBe(agentId);

    const routineId = createRes.body.id as string;

    const triggerRes = await request(app)
      .post(`/api/routines/${routineId}/triggers`)
      .send({
        kind: "schedule",
        label: "Weekday morning",
        cronExpression: "0 10 * * 1-5",
        timezone: "UTC",
      });

    expect(triggerRes.status).toBe(201);
    expect(triggerRes.body.trigger.kind).toBe("schedule");
    expect(triggerRes.body.trigger.enabled).toBe(true);
    expect(triggerRes.body.secretMaterial).toBeNull();

    const runRes = await request(app)
      .post(`/api/routines/${routineId}/run`)
      .send({
        source: "manual",
        payload: { origin: "e2e-test" },
      });

    expect(runRes.status).toBe(202);
    expect(runRes.body.status).toBe("issue_created");
    expect(runRes.body.source).toBe("manual");
    expect(runRes.body.linkedIssueId).toBeTruthy();

    const detailRes = await request(app).get(`/api/routines/${routineId}`);
    expect(detailRes.status).toBe(200);
    expect(detailRes.body.triggers).toHaveLength(1);
    expect(detailRes.body.triggers[0]?.id).toBe(triggerRes.body.trigger.id);
    expect(detailRes.body.recentRuns).toHaveLength(1);
    expect(detailRes.body.recentRuns[0]?.id).toBe(runRes.body.id);
    // With intent-driven dispatch, activeIssue is only populated once the scheduler
    // creates a heartbeat run. Until then, the issue has no live execution run.
    // The issue still exists and is linked to the routine run.

    const runsRes = await request(app).get(`/api/routines/${routineId}/runs?limit=10`);
    expect(runsRes.status).toBe(200);
    expect(runsRes.body).toHaveLength(1);
    expect(runsRes.body[0]?.id).toBe(runRes.body.id);

    const [issue] = await db
      .select({
        id: issues.id,
        originId: issues.originId,
        originKind: issues.originKind,
        executionRunId: issues.executionRunId,
      })
      .from(issues)
      .where(eq(issues.id, runRes.body.linkedIssueId));

    expect(issue).toMatchObject({
      id: runRes.body.linkedIssueId,
      originId: routineId,
      originKind: "routine_execution",
    });
    // With intent-driven dispatch, executionRunId is set later by the scheduler,
    // not during routine dispatch. An intent is created instead.

    const actions = await db
      .select({
        action: activityLog.action,
      })
      .from(activityLog)
      .where(eq(activityLog.companyId, companyId));

    expect(actions.map((entry) => entry.action)).toEqual(
      expect.arrayContaining([
        "routine.created",
        "routine.trigger_created",
        "routine.run_triggered",
      ]),
    );
  });
});
