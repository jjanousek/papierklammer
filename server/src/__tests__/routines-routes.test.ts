import type { RequestHandler } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "../middleware/index.js";
import { routineRoutes } from "../routes/routines.js";

const companyId = "22222222-2222-4222-8222-222222222222";
const agentId = "11111111-1111-4111-8111-111111111111";
const routineId = "33333333-3333-4333-8333-333333333333";
const projectId = "44444444-4444-4444-8444-444444444444";
const otherAgentId = "55555555-5555-4555-8555-555555555555";

const routine = {
  id: routineId,
  companyId,
  projectId,
  goalId: null,
  parentIssueId: null,
  title: "Daily routine",
  description: null,
  assigneeAgentId: agentId,
  priority: "medium",
  status: "active",
  concurrencyPolicy: "coalesce_if_active",
  catchUpPolicy: "skip_missed",
  createdByAgentId: null,
  createdByUserId: null,
  updatedByAgentId: null,
  updatedByUserId: null,
  lastTriggeredAt: null,
  lastEnqueuedAt: null,
  createdAt: new Date("2026-03-20T00:00:00.000Z"),
  updatedAt: new Date("2026-03-20T00:00:00.000Z"),
};
const pausedRoutine = {
  ...routine,
  status: "paused",
};
const trigger = {
  id: "66666666-6666-4666-8666-666666666666",
  companyId,
  routineId,
  kind: "schedule",
  label: "weekday",
  enabled: false,
  cronExpression: "0 10 * * 1-5",
  timezone: "UTC",
  nextRunAt: null,
  lastFiredAt: null,
  publicId: null,
  secretId: null,
  signingMode: null,
  replayWindowSec: null,
  lastRotatedAt: null,
  lastResult: null,
  createdByAgentId: null,
  createdByUserId: null,
  updatedByAgentId: null,
  updatedByUserId: null,
  createdAt: new Date("2026-03-20T00:00:00.000Z"),
  updatedAt: new Date("2026-03-20T00:00:00.000Z"),
};

let mockRoutineService: {
  list: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
  getDetail: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
  listRuns: ReturnType<typeof vi.fn>;
  createTrigger: ReturnType<typeof vi.fn>;
  getTrigger: ReturnType<typeof vi.fn>;
  updateTrigger: ReturnType<typeof vi.fn>;
  deleteTrigger: ReturnType<typeof vi.fn>;
  rotateTriggerSecret: ReturnType<typeof vi.fn>;
  runRoutine: ReturnType<typeof vi.fn>;
  firePublicTrigger: ReturnType<typeof vi.fn>;
};

let mockAccessService: {
  canUser: ReturnType<typeof vi.fn>;
};

let mockLogActivity: ReturnType<typeof vi.fn>;

function getRouteHandlers(method: "post" | "patch", path: string) {
  const router = routineRoutes({} as any, {
    accessService: mockAccessService as any,
    logActivity: mockLogActivity,
    routineService: mockRoutineService as any,
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

function responseError(res: { body: unknown }) {
  return (res.body as { error?: string } | undefined)?.error ?? "";
}

async function invokeRoute({
  actor,
  method,
  path,
  params = {},
  body = {},
}: {
  actor: Record<string, unknown>;
  method: "post" | "patch";
  path: string;
  params?: Record<string, unknown>;
  body?: Record<string, unknown>;
}) {
  const req = {
    actor,
    body,
    query: {},
    params,
    method: method.toUpperCase(),
    originalUrl: `/api${path}`,
  } as any;
  let statusCode = 200;
  let responseBody: unknown;
  const res = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(payload: unknown) {
      responseBody = payload;
      return this;
    },
    end() {
      return this;
    },
  } as any;

  try {
    await runHandlers(getRouteHandlers(method, path), req, res);
  } catch (error) {
    errorHandler(error, req, res, (() => undefined) as any);
  }

  return {
    status: statusCode,
    body: responseBody,
  };
}

describe("routine routes", () => {
  beforeEach(() => {
    vi.resetModules();
    mockRoutineService = {
      list: vi.fn(),
      get: vi.fn(),
      getDetail: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
      listRuns: vi.fn(),
      createTrigger: vi.fn(),
      getTrigger: vi.fn(),
      updateTrigger: vi.fn(),
      deleteTrigger: vi.fn(),
      rotateTriggerSecret: vi.fn(),
      runRoutine: vi.fn(),
      firePublicTrigger: vi.fn(),
    };
    mockAccessService = {
      canUser: vi.fn(),
    };
    mockLogActivity = vi.fn();
    mockRoutineService.create.mockResolvedValue(routine);
    mockRoutineService.get.mockResolvedValue(routine);
    mockRoutineService.getTrigger.mockResolvedValue(trigger);
    mockRoutineService.update.mockResolvedValue({ ...routine, assigneeAgentId: otherAgentId });
    mockRoutineService.runRoutine.mockResolvedValue({
      id: "run-1",
      source: "manual",
      status: "issue_created",
    });
    mockAccessService.canUser.mockResolvedValue(false);
    mockLogActivity.mockResolvedValue(undefined);
  });

  it("requires tasks:assign permission for non-admin board routine creation", async () => {
    const actor = {
      type: "board",
      userId: "board-user",
      source: "session",
      isInstanceAdmin: false,
      companyIds: [companyId],
    };

    const res = await invokeRoute({
      actor,
      method: "post",
      path: "/companies/:companyId/routines",
      params: { companyId },
      body: {
        projectId,
        title: "Daily routine",
        assigneeAgentId: agentId,
      },
    });

    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(responseError(res)).toContain("tasks:assign");
    expect(mockRoutineService.create).not.toHaveBeenCalled();
  });

  it("requires tasks:assign permission to retarget a routine assignee", async () => {
    const actor = {
      type: "board",
      userId: "board-user",
      source: "session",
      isInstanceAdmin: false,
      companyIds: [companyId],
    };

    const res = await invokeRoute({
      actor,
      method: "patch",
      path: "/routines/:id",
      params: { id: routineId },
      body: {
        assigneeAgentId: otherAgentId,
      },
    });

    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(responseError(res)).toContain("tasks:assign");
    expect(mockRoutineService.update).not.toHaveBeenCalled();
  });

  it("requires tasks:assign permission to reactivate a routine", async () => {
    mockRoutineService.get.mockResolvedValue(pausedRoutine);
    const actor = {
      type: "board",
      userId: "board-user",
      source: "session",
      isInstanceAdmin: false,
      companyIds: [companyId],
    };

    const res = await invokeRoute({
      actor,
      method: "patch",
      path: "/routines/:id",
      params: { id: routineId },
      body: {
        status: "active",
      },
    });

    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(responseError(res)).toContain("tasks:assign");
    expect(mockRoutineService.update).not.toHaveBeenCalled();
  });

  it("requires tasks:assign permission to create a trigger", async () => {
    const actor = {
      type: "board",
      userId: "board-user",
      source: "session",
      isInstanceAdmin: false,
      companyIds: [companyId],
    };

    const res = await invokeRoute({
      actor,
      method: "post",
      path: "/routines/:id/triggers",
      params: { id: routineId },
      body: {
        kind: "schedule",
        cronExpression: "0 10 * * *",
        timezone: "UTC",
      },
    });

    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(responseError(res)).toContain("tasks:assign");
    expect(mockRoutineService.createTrigger).not.toHaveBeenCalled();
  });

  it("requires tasks:assign permission to update a trigger", async () => {
    const actor = {
      type: "board",
      userId: "board-user",
      source: "session",
      isInstanceAdmin: false,
      companyIds: [companyId],
    };

    const res = await invokeRoute({
      actor,
      method: "patch",
      path: "/routine-triggers/:id",
      params: { id: trigger.id },
      body: {
        enabled: true,
      },
    });

    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(responseError(res)).toContain("tasks:assign");
    expect(mockRoutineService.updateTrigger).not.toHaveBeenCalled();
  });

  it("requires tasks:assign permission to manually run a routine", async () => {
    const actor = {
      type: "board",
      userId: "board-user",
      source: "session",
      isInstanceAdmin: false,
      companyIds: [companyId],
    };

    const res = await invokeRoute({
      actor,
      method: "post",
      path: "/routines/:id/run",
      params: { id: routineId },
      body: {},
    });

    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(responseError(res)).toContain("tasks:assign");
    expect(mockRoutineService.runRoutine).not.toHaveBeenCalled();
  });

  it("rejects invalid manual-run payloads before routine lookup", async () => {
    const actor = {
      type: "board",
      userId: "board-user",
      source: "session",
      isInstanceAdmin: false,
      companyIds: [companyId],
    };

    const res = await invokeRoute({
      actor,
      method: "post",
      path: "/routines/:id/run",
      params: { id: routineId },
      body: { source: "cron" },
    });

    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(responseError(res)).toBe("Validation error");
    expect(mockRoutineService.get).not.toHaveBeenCalled();
    expect(mockRoutineService.runRoutine).not.toHaveBeenCalled();
  });

  it("allows routine creation when the board user has tasks:assign", async () => {
    mockAccessService.canUser.mockResolvedValue(true);
    const actor = {
      type: "board",
      userId: "board-user",
      source: "session",
      isInstanceAdmin: false,
      companyIds: [companyId],
    };

    const res = await invokeRoute({
      actor,
      method: "post",
      path: "/companies/:companyId/routines",
      params: { companyId },
      body: {
        projectId,
        title: "Daily routine",
        assigneeAgentId: agentId,
      },
    });

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(mockRoutineService.create).toHaveBeenCalledWith(companyId, expect.objectContaining({
      projectId,
      title: "Daily routine",
      assigneeAgentId: agentId,
    }), {
      agentId: null,
      userId: "board-user",
    });
  });

  it("runs routines through the route stack with defaulted manual source and 202 status", async () => {
    mockAccessService.canUser.mockResolvedValue(true);
    const actor = {
      type: "board",
      userId: "board-user",
      source: "session",
      isInstanceAdmin: false,
      companyIds: [companyId],
    };

    const res = await invokeRoute({
      actor,
      method: "post",
      path: "/routines/:id/run",
      params: { id: routineId },
      body: {},
    });

    expect(res.status, JSON.stringify(res.body)).toBe(202);
    expect(res.body).toMatchObject({
      id: "run-1",
      source: "manual",
      status: "issue_created",
    });
    expect(mockRoutineService.runRoutine).toHaveBeenCalledWith(routineId, {
      source: "manual",
    });
  });
});
