import type { RequestHandler } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "../middleware/index.js";
import { accessRoutes } from "../routes/access.js";

const mockAccessService = vi.hoisted(() => ({
  hasPermission: vi.fn(),
  canUser: vi.fn(),
  isInstanceAdmin: vi.fn(),
  getMembership: vi.fn(),
  ensureMembership: vi.fn(),
  listMembers: vi.fn(),
  setMemberPermissions: vi.fn(),
  promoteInstanceAdmin: vi.fn(),
  demoteInstanceAdmin: vi.fn(),
  listUserCompanyAccess: vi.fn(),
  setUserCompanyAccess: vi.fn(),
  setPrincipalGrants: vi.fn(),
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
  assertCurrentBoardKey: vi.fn(),
  revokeBoardApiKey: vi.fn(),
}));

const mockLogActivity = vi.hoisted(() => vi.fn());
const mockDeduplicateAgentName = vi.hoisted(() => vi.fn((name?: string) => name ?? ""));
const mockNotifyHireApproved = vi.hoisted(() => vi.fn());

function createDbStub() {
  const createdInvite = {
    id: "invite-1",
    companyId: "company-1",
    inviteType: "company_join",
    allowedJoinTypes: "agent",
    defaultsPayload: null,
    expiresAt: new Date("2099-03-07T00:10:00.000Z"),
    invitedByUserId: null,
    tokenHash: "hash",
    revokedAt: null,
    acceptedAt: null,
    createdAt: new Date("2099-03-07T00:00:00.000Z"),
    updatedAt: new Date("2099-03-07T00:00:00.000Z"),
  };
  const inviteWithCompany = {
    ...createdInvite,
    name: "Acme AI",
  };
  const returning = vi.fn().mockResolvedValue([createdInvite]);
  const values = vi.fn().mockReturnValue({ returning });
  const insert = vi.fn().mockReturnValue({ values });
  const select = vi.fn(() => ({
    from(_table: unknown) {
      return {
        where: vi.fn().mockResolvedValue([inviteWithCompany]),
      };
    },
  }));
  return {
    insert,
    select,
  };
}

function getRouteHandlers(method: "get" | "post", path: string, db: Record<string, unknown>) {
  const router = accessRoutes(
    db as any,
    {
      deploymentMode: "local_trusted",
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
  actor: Record<string, unknown>;
  db: Record<string, unknown>;
  params?: Record<string, string>;
  body?: unknown;
}) {
  const req = {
    actor: options.actor,
    body: options.body ?? {},
    params: options.params ?? {},
    query: {},
    method: options.method.toUpperCase(),
    originalUrl: `/api${options.path}`,
    protocol: "http",
    ip: "127.0.0.1",
    header: () => undefined,
    get: () => undefined,
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
    await runHandlers(
      getRouteHandlers(options.method, options.path, options.db),
      req,
      res,
    );
  } catch (error) {
    errorHandler(error, req, res, (() => undefined) as any);
  }

  return { status: statusCode, body };
}

describe("POST /companies/:companyId/openclaw/invite-prompt", () => {
  beforeEach(() => {
    mockAccessService.canUser.mockResolvedValue(false);
    mockAccessService.hasPermission.mockReset();
    mockAccessService.isInstanceAdmin.mockReset();
    mockAccessService.getMembership.mockReset();
    mockAccessService.ensureMembership.mockReset();
    mockAccessService.listMembers.mockReset();
    mockAccessService.setMemberPermissions.mockReset();
    mockAccessService.promoteInstanceAdmin.mockReset();
    mockAccessService.demoteInstanceAdmin.mockReset();
    mockAccessService.listUserCompanyAccess.mockReset();
    mockAccessService.setUserCompanyAccess.mockReset();
    mockAccessService.setPrincipalGrants.mockReset();
    mockAgentService.getById.mockReset();
    mockBoardAuthService.createCliAuthChallenge.mockReset();
    mockBoardAuthService.describeCliAuthChallenge.mockReset();
    mockBoardAuthService.approveCliAuthChallenge.mockReset();
    mockBoardAuthService.cancelCliAuthChallenge.mockReset();
    mockBoardAuthService.resolveBoardAccess.mockReset();
    mockBoardAuthService.assertCurrentBoardKey.mockReset();
    mockBoardAuthService.revokeBoardApiKey.mockReset();
    mockLogActivity.mockResolvedValue(undefined);
    mockDeduplicateAgentName.mockReset();
    mockDeduplicateAgentName.mockImplementation((name?: string) => name ?? "");
    mockNotifyHireApproved.mockReset();
  });

  it("rejects non-CEO agent callers", async () => {
    const db = createDbStub();
    mockAgentService.getById.mockResolvedValue({
      id: "agent-1",
      companyId: "company-1",
      role: "engineer",
    });
    const res = await callRoute({
      method: "post",
      path: "/companies/:companyId/openclaw/invite-prompt",
      actor: {
        type: "agent",
        agentId: "agent-1",
        companyId: "company-1",
        source: "agent_key",
      },
      db,
      params: { companyId: "company-1" },
      body: {},
    });

    expect(res.status).toBe(403);
    expect((res.body as any).error).toContain("Only CEO agents");
  });

  it("allows CEO agent callers and creates an agent-only invite", async () => {
    const db = createDbStub();
    mockAgentService.getById.mockResolvedValue({
      id: "agent-1",
      companyId: "company-1",
      role: "ceo",
    });
    const res = await callRoute({
      method: "post",
      path: "/companies/:companyId/openclaw/invite-prompt",
      actor: {
        type: "agent",
        agentId: "agent-1",
        companyId: "company-1",
        source: "agent_key",
      },
      db,
      params: { companyId: "company-1" },
      body: { agentMessage: "Join and configure OpenClaw gateway." },
    });

    expect(res.status).toBe(201);
    expect((res.body as any).allowedJoinTypes).toBe("agent");
    expect(typeof (res.body as any).token).toBe("string");
    expect((res.body as any).companyName).toBe("Acme AI");
    expect((res.body as any).onboardingTextPath).toContain("/api/invites/");
  });

  it("includes companyName in invite summary responses", async () => {
    const db = createDbStub();
    const res = await callRoute({
      method: "get",
      path: "/invites/:token",
      actor: {
        type: "board",
        userId: "user-1",
        companyIds: ["company-1"],
        source: "session",
        isInstanceAdmin: false,
      },
      db,
      params: { token: "pcp_invite_test" },
    });

    expect(res.status).toBe(200);
    expect((res.body as any).companyId).toBe("company-1");
    expect((res.body as any).companyName).toBe("Acme AI");
  });

  it("allows board callers with invite permission", async () => {
    const db = createDbStub();
    mockAccessService.canUser.mockResolvedValue(true);
    const res = await callRoute({
      method: "post",
      path: "/companies/:companyId/openclaw/invite-prompt",
      actor: {
        type: "board",
        userId: "user-1",
        companyIds: ["company-1"],
        source: "session",
        isInstanceAdmin: false,
      },
      db,
      params: { companyId: "company-1" },
      body: {},
    });

    expect(res.status).toBe(201);
    expect((res.body as any).allowedJoinTypes).toBe("agent");
  });

  it("rejects board callers without invite permission", async () => {
    const db = createDbStub();
    mockAccessService.canUser.mockResolvedValue(false);
    const res = await callRoute({
      method: "post",
      path: "/companies/:companyId/openclaw/invite-prompt",
      actor: {
        type: "board",
        userId: "user-1",
        companyIds: ["company-1"],
        source: "session",
        isInstanceAdmin: false,
      },
      db,
      params: { companyId: "company-1" },
      body: {},
    });

    expect(res.status).toBe(403);
    expect((res.body as any).error).toBe("Permission denied");
  });
});
