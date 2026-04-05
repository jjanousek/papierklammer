import type { RequestHandler } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "../middleware/index.js";
import { instanceSettingsRoutes } from "../routes/instance-settings.js";

let mockInstanceSettingsService: {
  getGeneral: ReturnType<typeof vi.fn>;
  getExperimental: ReturnType<typeof vi.fn>;
  updateGeneral: ReturnType<typeof vi.fn>;
  updateExperimental: ReturnType<typeof vi.fn>;
  listCompanyIds: ReturnType<typeof vi.fn>;
};
let mockLogActivity: ReturnType<typeof vi.fn>;

function getRouteHandlers(
  method: "get" | "patch",
  path: string,
) {
  const router = instanceSettingsRoutes({} as any, {
    instanceSettingsService: mockInstanceSettingsService as any,
    logActivity: mockLogActivity,
  });
  const layer = (router as any).stack.find(
    (entry: any) =>
      entry.route?.path === path && entry.route.methods?.[method],
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
  if (!handler) {
    return;
  }

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
      if (!nextCalled) {
        resolve();
      }
    } catch (error) {
      reject(error);
    }
  });
}

async function callRoute(options: {
  method: "get" | "patch";
  path: string;
  actor: any;
  body?: unknown;
}) {
  const req = {
    actor: options.actor,
    body: options.body ?? {},
    query: {},
    params: {},
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
    await runHandlers(getRouteHandlers(options.method, options.path), req, res);
  } catch (error) {
    errorHandler(error, req, res, (() => undefined) as any);
  }

  return { status: statusCode, body };
}

describe.sequential("instance settings routes", () => {
  beforeEach(() => {
    mockInstanceSettingsService = {
      getGeneral: vi.fn(),
      getExperimental: vi.fn(),
      updateGeneral: vi.fn(),
      updateExperimental: vi.fn(),
      listCompanyIds: vi.fn(),
    };
    mockLogActivity = vi.fn();
    mockInstanceSettingsService.getGeneral.mockResolvedValue({
      censorUsernameInLogs: false,
    });
    mockInstanceSettingsService.getExperimental.mockResolvedValue({
      enableIsolatedWorkspaces: false,
      autoRestartDevServerWhenIdle: false,
    });
    mockInstanceSettingsService.updateGeneral.mockResolvedValue({
      id: "instance-settings-1",
      general: {
        censorUsernameInLogs: true,
      },
    });
    mockInstanceSettingsService.updateExperimental.mockResolvedValue({
      id: "instance-settings-1",
      experimental: {
        enableIsolatedWorkspaces: true,
        autoRestartDevServerWhenIdle: false,
      },
    });
    mockInstanceSettingsService.listCompanyIds.mockResolvedValue(["company-1", "company-2"]);
  });

  it("allows local board users to read and update experimental settings", async () => {
    const actor = {
      type: "board",
      userId: "local-board",
      source: "local_implicit",
      isInstanceAdmin: true,
    };

    const getRes = await callRoute({
      method: "get",
      path: "/instance/settings/experimental",
      actor,
    });
    expect(getRes.status).toBe(200);
    expect(getRes.body).toEqual({
      enableIsolatedWorkspaces: false,
      autoRestartDevServerWhenIdle: false,
    });

    const patchRes = await callRoute({
      method: "patch",
      path: "/instance/settings/experimental",
      actor,
      body: { enableIsolatedWorkspaces: true },
    });

    expect(patchRes.status).toBe(200);
    expect(mockInstanceSettingsService.updateExperimental).toHaveBeenCalledWith({
      enableIsolatedWorkspaces: true,
    });
    expect(mockLogActivity).toHaveBeenCalledTimes(2);
  });

  it("allows local board users to update guarded dev-server auto-restart", async () => {
    const actor = {
      type: "board",
      userId: "local-board",
      source: "local_implicit",
      isInstanceAdmin: true,
    };

    const res = await callRoute({
      method: "patch",
      path: "/instance/settings/experimental",
      actor,
      body: { autoRestartDevServerWhenIdle: true },
    });

    expect(res.status).toBe(200);

    expect(mockInstanceSettingsService.updateExperimental).toHaveBeenCalledWith({
      autoRestartDevServerWhenIdle: true,
    });
  });

  it("allows local board users to read and update general settings", async () => {
    const actor = {
      type: "board",
      userId: "local-board",
      source: "local_implicit",
      isInstanceAdmin: true,
    };

    const getRes = await callRoute({
      method: "get",
      path: "/instance/settings/general",
      actor,
    });
    expect(getRes.status).toBe(200);
    expect(getRes.body).toEqual({ censorUsernameInLogs: false });

    const patchRes = await callRoute({
      method: "patch",
      path: "/instance/settings/general",
      actor,
      body: { censorUsernameInLogs: true },
    });

    expect(patchRes.status).toBe(200);
    expect(mockInstanceSettingsService.updateGeneral).toHaveBeenCalledWith({
      censorUsernameInLogs: true,
    });
    expect(mockLogActivity).toHaveBeenCalledTimes(2);
  });

  it("rejects non-admin board users", async () => {
    const res = await callRoute({
      method: "get",
      path: "/instance/settings/general",
      actor: {
      type: "board",
      userId: "user-1",
      source: "session",
      isInstanceAdmin: false,
      companyIds: ["company-1"],
      },
    });

    expect(res.status).toBe(403);
    expect(mockInstanceSettingsService.getGeneral).not.toHaveBeenCalled();
  });

  it("rejects agent callers", async () => {
    const res = await callRoute({
      method: "patch",
      path: "/instance/settings/general",
      actor: {
      type: "agent",
      agentId: "agent-1",
      companyId: "company-1",
      source: "agent_key",
      },
      body: { censorUsernameInLogs: true },
    });

    expect(res.status).toBe(403);
    expect(mockInstanceSettingsService.updateGeneral).not.toHaveBeenCalled();
  });
});
