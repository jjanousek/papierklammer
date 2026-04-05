import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import express from "express";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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
  let accessServiceImpl!: typeof import("../services/access.js").accessService;
  let logActivityImpl!: typeof import("../services/activity-log.js").logActivity;
  let routineServiceImpl!: typeof import("../services/routines.js").routineService;
  let routineRoutesImpl!: typeof import("../routes/routines.js").routineRoutes;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-routines-e2e-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  beforeEach(async () => {
    vi.resetModules();
    vi.unmock("../services/access.js");
    vi.unmock("../services/activity-log.js");
    vi.unmock("../services/intent-queue.js");
    vi.unmock("../services/issue-assignment-wakeup.js");
    vi.unmock("../services/issues.js");
    vi.unmock("../services/routines.js");
    vi.unmock("../services/secrets.js");
    vi.unmock("../routes/routines.js");

    const [{ accessService }, { logActivity }, { routineService }, { routineRoutes }] = await Promise.all([
      import("../services/access.js"),
      import("../services/activity-log.js"),
      import("../services/routines.js"),
      import("../routes/routines.js"),
    ]);

    accessServiceImpl = accessService;
    logActivityImpl = logActivity;
    routineServiceImpl = routineService;
    routineRoutesImpl = routineRoutes;
  });

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
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as any).actor = actor;
      next();
    });
    app.use(
      "/api",
      routineRoutesImpl(db, {
        routineService: routineServiceImpl(db),
        accessService: accessServiceImpl(db),
        logActivity: logActivityImpl,
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

    const access = accessServiceImpl(db);
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

    expect(createRes.status, JSON.stringify({ body: createRes.body, headers: createRes.headers })).toBe(201);
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

    expect(triggerRes.status, JSON.stringify({ body: triggerRes.body, headers: triggerRes.headers })).toBe(201);
    expect(triggerRes.body.trigger.kind).toBe("schedule");
    expect(triggerRes.body.trigger.enabled).toBe(true);
    expect(triggerRes.body.secretMaterial).toBeNull();

    const runRes = await request(app)
      .post(`/api/routines/${routineId}/run`)
      .send({
        payload: { origin: "e2e-test" },
      });

    expect(runRes.status, JSON.stringify({ body: runRes.body, headers: runRes.headers })).toBe(202);
    expect(runRes.body.status).toBe("issue_created");
    expect(runRes.body.source).toBe("manual");
    expect(runRes.body.linkedIssueId).toBeTruthy();

    const storedTriggers = await db
      .select({
        id: routineTriggers.id,
        routineId: routineTriggers.routineId,
        kind: routineTriggers.kind,
        enabled: routineTriggers.enabled,
      })
      .from(routineTriggers)
      .where(eq(routineTriggers.routineId, routineId));

    expect(storedTriggers).toHaveLength(1);
    expect(storedTriggers[0]).toMatchObject({
      id: triggerRes.body.trigger.id,
      routineId,
      kind: "schedule",
      enabled: true,
    });

    const [storedRun] = await db
      .select({
        id: routineRuns.id,
        companyId: routineRuns.companyId,
        routineId: routineRuns.routineId,
        source: routineRuns.source,
        status: routineRuns.status,
        linkedIssueId: routineRuns.linkedIssueId,
      })
      .from(routineRuns)
      .where(eq(routineRuns.id, runRes.body.id));

    expect(storedRun).toMatchObject({
      id: runRes.body.id,
      companyId,
      routineId,
      source: "manual",
      status: "issue_created",
      linkedIssueId: runRes.body.linkedIssueId,
    });

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
