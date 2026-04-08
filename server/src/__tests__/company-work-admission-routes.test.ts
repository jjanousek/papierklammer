import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  agentWakeupRequests,
  agents,
  approvals,
  companies,
  createDb,
  heartbeatRuns,
  issues,
} from "@papierklammer/db";
import type { StorageService } from "../storage/types.js";
import { errorHandler } from "../middleware/index.js";
import { approvalRoutes } from "../routes/approvals.js";
import { agentRoutes } from "../routes/agents.js";
import { issueRoutes } from "../routes/issues.js";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { eq, sql } from "drizzle-orm";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeDB = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping company work admission route tests: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

function getRouteHandlers(
  router: ReturnType<typeof issueRoutes> | ReturnType<typeof approvalRoutes> | ReturnType<typeof agentRoutes>,
  method: "patch" | "post",
  path: string,
) {
  const layer = (router as any).stack.find(
    (entry: any) => entry.route?.path === path && entry.route.methods?.[method],
  );
  if (!layer) {
    throw new Error(`Route ${method.toUpperCase()} ${path} not found`);
  }
  return layer.route.stack.map((entry: any) => entry.handle as RequestHandler);
}

async function runHandlers(
  handlers: RequestHandler[],
  req: any,
  res: any,
  index = 0,
): Promise<void> {
  const handler = handlers[index];
  if (!handler) return;

  await new Promise<void>((resolve, reject) => {
    let nextCalled = false;
    const next = (err?: unknown) => {
      nextCalled = true;
      if (err) {
        reject(err);
        return;
      }
      runHandlers(handlers, req, res, index + 1).then(resolve).catch(reject);
    };

    try {
      const result = handler(req, res, next as any);
      if (result && typeof (result as Promise<unknown>).then === "function") {
        (result as Promise<unknown>).then(
          () => {
            if (!nextCalled) resolve();
          },
          reject,
        );
        return;
      }
      if (!nextCalled) resolve();
    } catch (error) {
      reject(error);
    }
  });
}

async function callRoute(options: {
  router: ReturnType<typeof issueRoutes> | ReturnType<typeof approvalRoutes> | ReturnType<typeof agentRoutes>;
  method: "patch" | "post";
  path: string;
  params?: Record<string, string>;
  body?: unknown;
}) {
  const req = {
    actor: {
      type: "board",
      userId: "local-board",
      source: "local_implicit",
      isInstanceAdmin: true,
    },
    body: options.body ?? {},
    params: options.params ?? {},
    query: {},
    method: options.method.toUpperCase(),
    originalUrl: `/api${options.path}`,
  } as any;
  let statusCode = 200;
  let body: unknown;
  const res = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(payload: unknown) {
      body = payload;
      return this;
    },
  } as any;

  try {
    await runHandlers(getRouteHandlers(options.router, options.method, options.path), req, res);
  } catch (error) {
    errorHandler(error, req, res, (() => undefined) as any);
  }

  return { status: statusCode, body };
}

describeDB("company work admission route gating", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let issueRouter!: ReturnType<typeof issueRoutes>;
  let approvalsRouter!: ReturnType<typeof approvalRoutes>;
  let agentRouter!: ReturnType<typeof agentRoutes>;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("company-work-admission-routes-");
    db = createDb(tempDb.connectionString);
    issueRouter = issueRoutes(db, {} as StorageService);
    approvalsRouter = approvalRoutes(db);
    agentRouter = agentRoutes(db);
  }, 30_000);

  afterEach(async () => {
    await new Promise((resolve) => setTimeout(resolve, 100));
    await db.execute(sql`TRUNCATE TABLE agent_wakeup_requests, heartbeat_runs, approvals, issues, agents, companies CASCADE`);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seedCompanyAgentAndIssue(companyStatus: "paused" | "archived") {
    const companyId = randomUUID();
    const agentId = randomUUID();
    const issueId = randomUUID();

    await db.insert(companies).values({
      id: companyId,
      name: "Route Lifecycle Co",
      status: companyStatus,
      pausedAt: companyStatus === "paused" ? new Date() : null,
      issuePrefix: "RTE",
      requireBoardApprovalForNewAgents: false,
    });

    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "Route Runner",
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

    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Blocked restart issue",
      status: "backlog",
      priority: "medium",
      assigneeAgentId: agentId,
    });

    return { companyId, agentId, issueId };
  }

  async function seedCompanyAgentAndApproval(companyStatus: "paused" | "archived") {
    const companyId = randomUUID();
    const agentId = randomUUID();
    const approvalId = randomUUID();

    await db.insert(companies).values({
      id: companyId,
      name: "Approval Lifecycle Co",
      status: companyStatus,
      pausedAt: companyStatus === "paused" ? new Date() : null,
      issuePrefix: "APR",
      requireBoardApprovalForNewAgents: false,
    });

    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "Requester",
      role: "ceo",
      status: "active",
      adapterType: "process",
      adapterConfig: {
        command: process.execPath,
        args: ["-e", "setTimeout(() => process.exit(0), 10)"],
      },
      runtimeConfig: {},
      permissions: {},
    });

    await db.insert(approvals).values({
      id: approvalId,
      companyId,
      type: "approve_ceo_strategy",
      requestedByAgentId: agentId,
      requestedByUserId: null,
      status: "pending",
      payload: { strategy: "Ship lifecycle gate" },
      decisionNote: null,
      decidedByUserId: null,
      decidedAt: null,
    });

    return { agentId, approvalId };
  }

  async function waitForWakeup(agentId: string, expectedReason: string, timeoutMs = 1_500) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const wakeups = await db
        .select()
        .from(agentWakeupRequests)
        .where(eq(agentWakeupRequests.agentId, agentId));
      if (wakeups.some((wakeup) => wakeup.reason === expectedReason)) {
        return wakeups;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    return db
      .select()
      .from(agentWakeupRequests)
      .where(eq(agentWakeupRequests.agentId, agentId));
  }

  it.each([
    ["paused", "company.paused"],
    ["archived", "company.archived"],
  ] as const)(
    "rejects manual wakeup for %s companies without creating runs",
    async (companyStatus, skipReason) => {
      const { agentId } = await seedCompanyAgentAndIssue(companyStatus);

      const response = await callRoute({
        router: agentRouter,
        method: "post",
        path: "/agents/:id/wakeup",
        params: { id: agentId },
        body: {
          source: "on_demand",
          triggerDetail: "manual",
        },
      });

      expect(response.status).toBe(409);
      expect(response.body).toMatchObject({
        error: expect.stringContaining("cannot start new work"),
      });

      const runs = await db.select().from(heartbeatRuns);
      expect(runs).toHaveLength(0);

      const wakeups = await waitForWakeup(agentId, skipReason);
      expect(wakeups).toHaveLength(1);
      expect(wakeups[0]?.status).toBe("skipped");
      expect(wakeups[0]?.reason).toBe(skipReason);
    },
  );

  it.each([
    ["paused", "company.paused"],
    ["archived", "company.archived"],
  ] as const)(
    "rejects manual invoke for %s companies without creating runs",
    async (companyStatus, skipReason) => {
      const { agentId } = await seedCompanyAgentAndIssue(companyStatus);

      const response = await callRoute({
        router: agentRouter,
        method: "post",
        path: "/agents/:id/heartbeat/invoke",
        params: { id: agentId },
        body: {},
      });

      expect(response.status).toBe(409);
      expect(response.body).toMatchObject({
        error: expect.stringContaining("cannot start new work"),
      });

      const runs = await db.select().from(heartbeatRuns);
      expect(runs).toHaveLength(0);

      const wakeups = await waitForWakeup(agentId, skipReason);
      expect(wakeups).toHaveLength(1);
      expect(wakeups[0]?.status).toBe("skipped");
      expect(wakeups[0]?.reason).toBe(skipReason);
    },
  );

  it.each([
    ["paused", "company.paused"],
    ["archived", "company.archived"],
  ] as const)(
    "allows issue updates for %s companies without creating new runs",
    async (companyStatus, skipReason) => {
      const { issueId, agentId } = await seedCompanyAgentAndIssue(companyStatus);

      const response = await callRoute({
        router: issueRouter,
        method: "patch",
        path: "/issues/:id",
        params: { id: issueId },
        body: { status: "todo" },
      });

      expect(response.status).toBe(200);

      const issue = await db
        .select({ status: issues.status })
        .from(issues)
        .where(eq(issues.id, issueId))
        .then((rows) => rows[0] ?? null);
      expect(issue?.status).toBe("todo");

      const runs = await db.select().from(heartbeatRuns);
      expect(runs).toHaveLength(0);

      const wakeups = await waitForWakeup(agentId, skipReason);
      expect(wakeups).toHaveLength(1);
      expect(wakeups[0]?.status).toBe("skipped");
      expect(wakeups[0]?.reason).toBe(skipReason);
    },
  );

  it.each([
    ["paused", "company.paused"],
    ["archived", "company.archived"],
  ] as const)(
    "approving work-related approvals for %s companies does not restart requester execution",
    async (companyStatus, skipReason) => {
      const { agentId, approvalId } = await seedCompanyAgentAndApproval(companyStatus);

      const response = await callRoute({
        router: approvalsRouter,
        method: "post",
        path: "/approvals/:id/approve",
        params: { id: approvalId },
        body: {},
      });

      expect(response.status).toBe(200);

      const approval = await db
        .select({ status: approvals.status })
        .from(approvals)
        .where(eq(approvals.id, approvalId))
        .then((rows) => rows[0] ?? null);
      expect(approval?.status).toBe("approved");

      const runs = await db.select().from(heartbeatRuns);
      expect(runs).toHaveLength(0);

      const wakeups = await waitForWakeup(agentId, skipReason);
      expect(wakeups).toHaveLength(1);
      expect(wakeups[0]?.status).toBe("skipped");
      expect(wakeups[0]?.reason).toBe(skipReason);
    },
  );
});
