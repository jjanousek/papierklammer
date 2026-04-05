import type { RequestHandler } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "../middleware/index.js";
import { activityRoutes } from "../routes/activity.js";

const mockActivityService = vi.hoisted(() => ({
  list: vi.fn(),
  forIssue: vi.fn(),
  runsForIssue: vi.fn(),
  issuesForRun: vi.fn(),
  create: vi.fn(),
}));

const mockHeartbeatService = vi.hoisted(() => ({
  getRun: vi.fn(),
}));

const mockIssueService = vi.hoisted(() => ({
  getById: vi.fn(),
  getByIdentifier: vi.fn(),
}));

function getRouteHandlers(method: "get", path: string) {
  const router = activityRoutes({} as any, {
    activityService: mockActivityService as any,
    heartbeatService: mockHeartbeatService as any,
    issueService: mockIssueService as any,
  });
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
  path: string;
  actor?: Record<string, unknown>;
  params?: Record<string, string>;
}) {
  const req = {
    actor: {
      type: "board",
      userId: "user-1",
      companyIds: ["company-1"],
      source: "session",
      isInstanceAdmin: false,
      ...(options.actor ?? {}),
    },
    body: {},
    query: {},
    params: options.params ?? {},
    method: "GET",
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
    await runHandlers(getRouteHandlers("get", options.path), req, res);
  } catch (error) {
    errorHandler(error, req, res, (() => undefined) as any);
  }

  return { status: statusCode, body };
}

describe("activity routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves issue identifiers before loading runs", async () => {
    mockIssueService.getByIdentifier.mockResolvedValue({
      id: "issue-uuid-1",
      companyId: "company-1",
    });
    mockActivityService.runsForIssue.mockResolvedValue([
      {
        runId: "run-1",
      },
    ]);

    const res = await callRoute({
      path: "/issues/:id/runs",
      params: { id: "PAP-475" },
    });

    expect(res.status).toBe(200);
    expect(mockIssueService.getByIdentifier).toHaveBeenCalledWith("PAP-475");
    expect(mockIssueService.getById).not.toHaveBeenCalled();
    expect(mockActivityService.runsForIssue).toHaveBeenCalledWith("company-1", "issue-uuid-1");
    expect(res.body).toEqual([{ runId: "run-1" }]);
  });

  it("rejects same-company agent access to issue run fan-out", async () => {
    const res = await callRoute({
      path: "/issues/:id/runs",
      params: { id: "PAP-475" },
      actor: {
        type: "agent",
        agentId: "agent-1",
        companyId: "company-1",
        source: "agent_key",
      },
    });

    expect(res.status).toBe(403);
    expect(mockIssueService.getByIdentifier).not.toHaveBeenCalled();
    expect(mockActivityService.runsForIssue).not.toHaveBeenCalled();
  });

  it("enforces company access on heartbeat-run issue fan-out", async () => {
    mockHeartbeatService.getRun.mockResolvedValue({
      id: "run-1",
      companyId: "company-1",
    });
    mockActivityService.issuesForRun.mockResolvedValue([
      { issueId: "issue-1", title: "Investigate" },
    ]);

    const res = await callRoute({
      path: "/heartbeat-runs/:runId/issues",
      params: { runId: "run-1" },
    });

    expect(res.status).toBe(200);
    expect(mockHeartbeatService.getRun).toHaveBeenCalledWith("run-1");
    expect(mockActivityService.issuesForRun).toHaveBeenCalledWith("run-1");
    expect(res.body).toEqual([{ issueId: "issue-1", title: "Investigate" }]);
  });

  it("rejects unauthenticated heartbeat-run issue fan-out requests", async () => {
    mockHeartbeatService.getRun.mockResolvedValue({
      id: "run-1",
      companyId: "company-1",
    });

    const res = await callRoute({
      path: "/heartbeat-runs/:runId/issues",
      params: { runId: "run-1" },
      actor: {
        type: "none",
        source: "none",
      },
    });

    expect(res.status).toBe(401);
    expect(mockActivityService.issuesForRun).not.toHaveBeenCalled();
  });

  it("rejects wrong-company agent access to heartbeat-run issue fan-out", async () => {
    mockHeartbeatService.getRun.mockResolvedValue({
      id: "run-1",
      companyId: "company-1",
    });

    const res = await callRoute({
      path: "/heartbeat-runs/:runId/issues",
      params: { runId: "run-1" },
      actor: {
        type: "agent",
        agentId: "agent-1",
        companyId: "company-2",
        source: "agent_key",
      },
    });

    expect(res.status).toBe(403);
    expect(mockActivityService.issuesForRun).not.toHaveBeenCalled();
  });

  it("allows same-company agent access to heartbeat-run issue fan-out", async () => {
    mockHeartbeatService.getRun.mockResolvedValue({
      id: "run-1",
      companyId: "company-1",
    });
    mockActivityService.issuesForRun.mockResolvedValue([
      { issueId: "issue-1", title: "Investigate" },
    ]);

    const res = await callRoute({
      path: "/heartbeat-runs/:runId/issues",
      params: { runId: "run-1" },
      actor: {
        type: "agent",
        agentId: "agent-1",
        companyId: "company-1",
        source: "agent_key",
      },
    });

    expect(res.status).toBe(200);
    expect(mockHeartbeatService.getRun).toHaveBeenCalledWith("run-1");
    expect(mockActivityService.issuesForRun).toHaveBeenCalledWith("run-1");
    expect(res.body).toEqual([{ issueId: "issue-1", title: "Investigate" }]);
  });
});
