import type { RequestHandler } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "../middleware/index.js";
import { accessRoutes } from "../routes/access.js";

const mockAccessService = vi.hoisted(() => ({
  isInstanceAdmin: vi.fn(),
  hasPermission: vi.fn(),
  canUser: vi.fn(),
}));

const mockAgentService = vi.hoisted(() => ({
  getById: vi.fn(),
}));

const mockBoardAuthService = vi.hoisted(() => ({
  createCliAuthChallenge: vi.fn(),
  describeCliAuthChallenge: vi.fn(),
  approveCliAuthChallenge: vi.fn(),
  cancelCliAuthChallenge: vi.fn(),
  resolveBoardAccess: vi.fn(),
  resolveBoardActivityCompanyIds: vi.fn(),
  assertCurrentBoardKey: vi.fn(),
  revokeBoardApiKey: vi.fn(),
}));

const mockLogActivity = vi.hoisted(() => vi.fn());
const mockDeduplicateAgentName = vi.hoisted(() => vi.fn((name: string) => name));
const mockNotifyHireApproved = vi.hoisted(() => vi.fn());

function getRouteHandlers(method: "get" | "post", path: string) {
  const router = accessRoutes(
    {} as any,
    {
      deploymentMode: "authenticated",
      deploymentExposure: "private",
      bindHost: "127.0.0.1",
      allowedHostnames: [],
    },
    {
      accessService: mockAccessService as any,
      agentService: mockAgentService as any,
      boardAuthService: mockBoardAuthService as any,
      deduplicateAgentName: mockDeduplicateAgentName,
      logActivity: mockLogActivity,
      notifyHireApproved: mockNotifyHireApproved,
    },
  );
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
  method: "get" | "post";
  path: string;
  actor?: Record<string, unknown>;
  body?: unknown;
  params?: Record<string, string>;
  query?: Record<string, string>;
}) {
  const headers = {
    host: "localhost:3100",
  };
  const req = {
    actor: options.actor ?? { type: "none", source: "none" },
    body: options.body ?? {},
    params: options.params ?? {},
    query: options.query ?? {},
    method: options.method.toUpperCase(),
    originalUrl: `/api${options.path}`,
    protocol: "http",
    ip: "127.0.0.1",
    header(name: string) {
      return headers[name.toLowerCase() as keyof typeof headers];
    },
    get(name: string) {
      return headers[name.toLowerCase() as keyof typeof headers];
    },
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

describe("cli auth routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAccessService.isInstanceAdmin.mockReset();
    mockAccessService.hasPermission.mockReset();
    mockAccessService.canUser.mockReset();
    mockAgentService.getById.mockReset();
    mockBoardAuthService.createCliAuthChallenge.mockReset();
    mockBoardAuthService.describeCliAuthChallenge.mockReset();
    mockBoardAuthService.approveCliAuthChallenge.mockReset();
    mockBoardAuthService.cancelCliAuthChallenge.mockReset();
    mockBoardAuthService.resolveBoardAccess.mockReset();
    mockBoardAuthService.resolveBoardActivityCompanyIds.mockReset();
    mockBoardAuthService.assertCurrentBoardKey.mockReset();
    mockBoardAuthService.revokeBoardApiKey.mockReset();
    mockLogActivity.mockReset();
    mockDeduplicateAgentName.mockReset();
    mockDeduplicateAgentName.mockImplementation((name: string) => name);
    mockNotifyHireApproved.mockReset();
  });

  it("creates a CLI auth challenge with approval metadata", async () => {
    mockBoardAuthService.createCliAuthChallenge.mockResolvedValue({
      challenge: {
        id: "challenge-1",
        expiresAt: new Date("2026-03-23T13:00:00.000Z"),
      },
      challengeSecret: "pcp_cli_auth_secret",
      pendingBoardToken: "pcp_board_token",
    });

    const res = await callRoute({
      method: "post",
      path: "/cli-auth/challenges",
      body: {
        command: "paperclipai company import",
        clientName: "paperclipai cli",
        requestedAccess: "board",
      },
    });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      id: "challenge-1",
      token: "pcp_cli_auth_secret",
      boardApiToken: "pcp_board_token",
      approvalPath: "/cli-auth/challenge-1?token=pcp_cli_auth_secret",
      pollPath: "/cli-auth/challenges/challenge-1",
      expiresAt: "2026-03-23T13:00:00.000Z",
    });
    expect((res.body as any).approvalUrl).toContain("/cli-auth/challenge-1?token=pcp_cli_auth_secret");
  });

  it("marks challenge status as requiring sign-in for anonymous viewers", async () => {
    mockBoardAuthService.describeCliAuthChallenge.mockResolvedValue({
      id: "challenge-1",
      status: "pending",
      command: "paperclipai company import",
      clientName: "paperclipai cli",
      requestedAccess: "board",
      requestedCompanyId: null,
      requestedCompanyName: null,
      approvedAt: null,
      cancelledAt: null,
      expiresAt: "2026-03-23T13:00:00.000Z",
      approvedByUser: null,
    });

    const res = await callRoute({
      method: "get",
      path: "/cli-auth/challenges/:id",
      params: { id: "challenge-1" },
      query: { token: "pcp_cli_auth_secret" },
    });

    expect(res.status).toBe(200);
    expect((res.body as any).requiresSignIn).toBe(true);
    expect((res.body as any).canApprove).toBe(false);
  });

  it("approves a CLI auth challenge for a signed-in board user", async () => {
    mockBoardAuthService.approveCliAuthChallenge.mockResolvedValue({
      status: "approved",
      challenge: {
        id: "challenge-1",
        boardApiKeyId: "board-key-1",
        requestedAccess: "board",
        requestedCompanyId: "company-1",
        expiresAt: new Date("2026-03-23T13:00:00.000Z"),
      },
    });
    mockBoardAuthService.resolveBoardAccess.mockResolvedValue({
      user: { id: "user-1", name: "User One", email: "user@example.com" },
      companyIds: ["company-1"],
      isInstanceAdmin: false,
    });
    mockBoardAuthService.resolveBoardActivityCompanyIds.mockResolvedValue(["company-1"]);

    const res = await callRoute({
      method: "post",
      path: "/cli-auth/challenges/:id/approve",
      params: { id: "challenge-1" },
      actor: {
        type: "board",
        userId: "user-1",
        source: "session",
        isInstanceAdmin: false,
        companyIds: ["company-1"],
      },
      body: { token: "pcp_cli_auth_secret" },
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      approved: true,
      status: "approved",
      userId: "user-1",
      keyId: "board-key-1",
      expiresAt: "2026-03-23T13:00:00.000Z",
    });
    expect(mockLogActivity).toHaveBeenCalledTimes(1);
    expect(mockLogActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        companyId: "company-1",
        action: "board_api_key.created",
      }),
    );
  });

  it("logs approve activity for instance admins without company memberships", async () => {
    mockBoardAuthService.approveCliAuthChallenge.mockResolvedValue({
      status: "approved",
      challenge: {
        id: "challenge-2",
        boardApiKeyId: "board-key-2",
        requestedAccess: "instance_admin_required",
        requestedCompanyId: null,
        expiresAt: new Date("2026-03-23T13:00:00.000Z"),
      },
    });
    mockBoardAuthService.resolveBoardActivityCompanyIds.mockResolvedValue(["company-a", "company-b"]);

    const res = await callRoute({
      method: "post",
      path: "/cli-auth/challenges/:id/approve",
      params: { id: "challenge-2" },
      actor: {
        type: "board",
        userId: "admin-1",
        source: "session",
        isInstanceAdmin: true,
        companyIds: [],
      },
      body: { token: "pcp_cli_auth_secret" },
    });

    expect(res.status).toBe(200);
    expect(mockBoardAuthService.resolveBoardActivityCompanyIds).toHaveBeenCalledWith({
      userId: "admin-1",
      requestedCompanyId: null,
      boardApiKeyId: "board-key-2",
    });
    expect(mockLogActivity).toHaveBeenCalledTimes(2);
    expect(
      mockLogActivity.mock.calls.map(([, activity]) => activity.companyId),
    ).toEqual(["company-a", "company-b"]);
  });

  it("logs revoke activity with resolved audit company ids", async () => {
    mockBoardAuthService.assertCurrentBoardKey.mockResolvedValue({
      id: "board-key-3",
      userId: "admin-2",
    });
    mockBoardAuthService.resolveBoardActivityCompanyIds.mockResolvedValue(["company-z"]);

    const res = await callRoute({
      method: "post",
      path: "/cli-auth/revoke-current",
      actor: {
        type: "board",
        userId: "admin-2",
        keyId: "board-key-3",
        source: "board_key",
        isInstanceAdmin: true,
        companyIds: [],
      },
    });

    expect(res.status).toBe(200);
    expect(mockBoardAuthService.resolveBoardActivityCompanyIds).toHaveBeenCalledWith({
      userId: "admin-2",
      boardApiKeyId: "board-key-3",
    });
    expect(mockLogActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        companyId: "company-z",
        action: "board_api_key.revoked",
      }),
    );
  });
});
