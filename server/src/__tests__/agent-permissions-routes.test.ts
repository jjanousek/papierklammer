import type { RequestHandler } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { INBOX_MINE_ISSUE_STATUS_FILTER } from "@papierklammer/shared";
import { errorHandler } from "../middleware/index.js";
import { agentRoutes } from "../routes/agents.js";

const agentId = "11111111-1111-4111-8111-111111111111";
const companyId = "22222222-2222-4222-8222-222222222222";

const baseAgent = {
  id: agentId,
  companyId,
  name: "Builder",
  urlKey: "builder",
  role: "engineer",
  title: "Builder",
  icon: null,
  status: "idle",
  reportsTo: null,
  capabilities: null,
  adapterType: "process",
  adapterConfig: {},
  runtimeConfig: {},
  budgetMonthlyCents: 0,
  spentMonthlyCents: 0,
  pauseReason: null,
  pausedAt: null,
  permissions: { canCreateAgents: false },
  lastHeartbeatAt: null,
  metadata: null,
  createdAt: new Date("2026-03-19T00:00:00.000Z"),
  updatedAt: new Date("2026-03-19T00:00:00.000Z"),
};

let mockAgentService: {
  getById: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
  updatePermissions: ReturnType<typeof vi.fn>;
  getChainOfCommand: ReturnType<typeof vi.fn>;
  resolveByReference: ReturnType<typeof vi.fn>;
};

let mockAccessService: {
  canUser: ReturnType<typeof vi.fn>;
  hasPermission: ReturnType<typeof vi.fn>;
  getMembership: ReturnType<typeof vi.fn>;
  ensureMembership: ReturnType<typeof vi.fn>;
  listPrincipalGrants: ReturnType<typeof vi.fn>;
  setPrincipalPermission: ReturnType<typeof vi.fn>;
};

let mockApprovalService: {
  create: ReturnType<typeof vi.fn>;
  getById: ReturnType<typeof vi.fn>;
};

let mockBudgetService: {
  upsertPolicy: ReturnType<typeof vi.fn>;
};

let mockHeartbeatService: {
  listTaskSessions: ReturnType<typeof vi.fn>;
  resetRuntimeSession: ReturnType<typeof vi.fn>;
};

let mockIssueApprovalService: {
  linkManyForApproval: ReturnType<typeof vi.fn>;
};

let mockIssueService: {
  list: ReturnType<typeof vi.fn>;
};

let mockSecretService: {
  normalizeAdapterConfigForPersistence: ReturnType<typeof vi.fn>;
  resolveAdapterConfigForRuntime: ReturnType<typeof vi.fn>;
};

let mockAgentInstructionsService: {
  materializeManagedBundle: ReturnType<typeof vi.fn>;
};
let mockCompanySkillService: {
  listRuntimeSkillEntries: ReturnType<typeof vi.fn>;
  resolveRequestedSkillKeys: ReturnType<typeof vi.fn>;
};
const mockWorkspaceOperationService = {};
let mockLogActivity: ReturnType<typeof vi.fn>;
const mockSyncInstructionsBundleConfigFromFilePath = vi.fn((_agent, config) => config);
let mockInstanceSettingsService: {
  getGeneral: ReturnType<typeof vi.fn>;
};
const mockLeaseManagerService = {};
let mockFindServerAdapter: ReturnType<typeof vi.fn>;
let mockListAdapterModels: ReturnType<typeof vi.fn>;
let mockDetectAdapterModel: ReturnType<typeof vi.fn>;
let principalPermissionCalls: Array<{
  companyId: string;
  principalType: string;
  principalId: string;
  permissionKey: string;
  enabled: boolean;
  grantedByUserId: string | null;
}>;
let ensureMembershipCalls: Array<{
  companyId: string;
  principalType: string;
  principalId: string;
  membershipRole: string;
  status: string;
}>;
let issueListCalls: Array<{
  companyId: string;
  filters: Record<string, unknown>;
}>;
let issueListResult: Array<Record<string, unknown>>;

function createDbStub() {
  return {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          then: vi.fn().mockResolvedValue([{
            id: companyId,
            name: "Paperclip",
            requireBoardApprovalForNewAgents: false,
          }]),
        }),
      }),
    }),
  };
}

function getRouteHandlers(
  method: "get" | "post" | "patch",
  path: string,
) {
  const router = agentRoutes(createDbStub() as any, {
      agentService: mockAgentService as any,
      agentInstructionsService: mockAgentInstructionsService as any,
      accessService: mockAccessService as any,
      approvalService: mockApprovalService as any,
      companySkillService: mockCompanySkillService as any,
      budgetService: mockBudgetService as any,
      heartbeatService: mockHeartbeatService as any,
      issueApprovalService: mockIssueApprovalService as any,
      issueService: mockIssueService as any,
      instanceSettingsService: mockInstanceSettingsService as any,
      leaseManagerService: mockLeaseManagerService as any,
      logActivity: mockLogActivity,
      secretService: mockSecretService as any,
      syncInstructionsBundleConfigFromFilePath: mockSyncInstructionsBundleConfigFromFilePath,
      workspaceOperationService: mockWorkspaceOperationService as any,
      findServerAdapter: mockFindServerAdapter,
      listAdapterModels: mockListAdapterModels,
      detectAdapterModel: mockDetectAdapterModel,
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
  actor: Record<string, unknown>;
  method: "get" | "post" | "patch";
  path: string;
  body?: unknown;
  query?: Record<string, unknown>;
  params?: Record<string, string>;
}) {
  const req = {
    actor: options.actor,
    body: options.body ?? {},
    query: options.query ?? {},
    params: options.params ?? {},
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
    end() {
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

describe("agent permission routes", () => {
  beforeEach(() => {
    vi.resetModules();
    principalPermissionCalls = [];
    ensureMembershipCalls = [];
    issueListCalls = [];
    issueListResult = [];
    mockAgentService = {
      getById: vi.fn(),
      create: vi.fn(),
      updatePermissions: vi.fn(),
      getChainOfCommand: vi.fn(),
      resolveByReference: vi.fn(),
    };
    mockAccessService = {
      canUser: vi.fn(),
      hasPermission: vi.fn(),
      getMembership: vi.fn(),
      ensureMembership: vi.fn(),
      listPrincipalGrants: vi.fn(),
      setPrincipalPermission: vi.fn(),
    };
    mockApprovalService = {
      create: vi.fn(),
      getById: vi.fn(),
    };
    mockBudgetService = {
      upsertPolicy: vi.fn(),
    };
    mockHeartbeatService = {
      listTaskSessions: vi.fn(),
      resetRuntimeSession: vi.fn(),
    };
    mockIssueApprovalService = {
      linkManyForApproval: vi.fn(),
    };
    mockIssueService = {
      list: vi.fn(),
    };
    mockSecretService = {
      normalizeAdapterConfigForPersistence: vi.fn(),
      resolveAdapterConfigForRuntime: vi.fn(),
    };
    mockAgentInstructionsService = {
      materializeManagedBundle: vi.fn(),
    };
    mockCompanySkillService = {
      listRuntimeSkillEntries: vi.fn(),
      resolveRequestedSkillKeys: vi.fn(),
    };
    mockLogActivity = vi.fn();
    mockSyncInstructionsBundleConfigFromFilePath.mockClear();
    mockInstanceSettingsService = {
      getGeneral: vi.fn(),
    };
    mockFindServerAdapter = vi.fn();
    mockListAdapterModels = vi.fn();
    mockDetectAdapterModel = vi.fn();
    mockAgentService.getById.mockResolvedValue(baseAgent);
    mockAgentService.getChainOfCommand.mockResolvedValue([]);
    mockAgentService.resolveByReference.mockResolvedValue({ ambiguous: false, agent: baseAgent });
    mockAgentService.create.mockResolvedValue(baseAgent);
    mockAgentService.updatePermissions.mockResolvedValue(baseAgent);
    mockAccessService.getMembership.mockResolvedValue({
      id: "membership-1",
      companyId,
      principalType: "agent",
      principalId: agentId,
      status: "active",
      membershipRole: "member",
      createdAt: new Date("2026-03-19T00:00:00.000Z"),
      updatedAt: new Date("2026-03-19T00:00:00.000Z"),
    });
    mockAccessService.listPrincipalGrants.mockResolvedValue([]);
    mockAccessService.ensureMembership.mockImplementation(
      async (
        companyId: string,
        principalType: string,
        principalId: string,
        membershipRole: string,
        status: string,
      ) => {
        ensureMembershipCalls.push({ companyId, principalType, principalId, membershipRole, status });
      },
    );
    mockAccessService.setPrincipalPermission.mockImplementation(
      async (
        companyId: string,
        principalType: string,
        principalId: string,
        permissionKey: string,
        enabled: boolean,
        grantedByUserId: string | null,
      ) => {
        principalPermissionCalls.push({
          companyId,
          principalType,
          principalId,
          permissionKey,
          enabled,
          grantedByUserId,
        });
      },
    );
    mockCompanySkillService.listRuntimeSkillEntries.mockResolvedValue([]);
    mockCompanySkillService.resolveRequestedSkillKeys.mockImplementation(async (_companyId, requested) => requested);
    mockBudgetService.upsertPolicy.mockResolvedValue(undefined);
    mockAgentInstructionsService.materializeManagedBundle.mockImplementation(
      async (agent: Record<string, unknown>, files: Record<string, string>) => ({
        bundle: null,
        adapterConfig: {
          ...((agent.adapterConfig as Record<string, unknown> | undefined) ?? {}),
          instructionsBundleMode: "managed",
          instructionsRootPath: `/tmp/${String(agent.id)}/instructions`,
          instructionsEntryFile: "AGENTS.md",
          instructionsFilePath: `/tmp/${String(agent.id)}/instructions/AGENTS.md`,
          promptTemplate: files["AGENTS.md"] ?? "",
        },
      }),
    );
    mockCompanySkillService.listRuntimeSkillEntries.mockResolvedValue([]);
    mockCompanySkillService.resolveRequestedSkillKeys.mockImplementation(
      async (_companyId: string, requested: string[]) => requested,
    );
    mockSecretService.normalizeAdapterConfigForPersistence.mockImplementation(async (_companyId, config) => config);
    mockSecretService.resolveAdapterConfigForRuntime.mockImplementation(async (_companyId, config) => ({ config }));
    mockInstanceSettingsService.getGeneral.mockResolvedValue({
      censorUsernameInLogs: false,
    });
    mockLogActivity.mockResolvedValue(undefined);
    mockIssueService.list.mockImplementation(async (companyId: string, filters: Record<string, unknown>) => {
      issueListCalls.push({ companyId, filters });
      return issueListResult;
    });
  });

  it("grants tasks:assign by default when board creates a new agent", async () => {
    const res = await callRoute({
      actor: {
      type: "board",
      userId: "board-user",
      source: "local_implicit",
      isInstanceAdmin: true,
      companyIds: [companyId],
    },
      method: "post",
      path: "/companies/:companyId/agents",
      params: { companyId },
      body: {
        name: "Builder",
        role: "engineer",
        adapterType: "process",
        adapterConfig: {},
      },
    });

    expect(res.status).toBe(201);
    expect(ensureMembershipCalls).toContainEqual({
      companyId,
      principalType: "agent",
      principalId: agentId,
      membershipRole: "member",
      status: "active",
    });
    expect(principalPermissionCalls).toContainEqual({
      companyId,
      principalType: "agent",
      principalId: agentId,
      permissionKey: "tasks:assign",
      enabled: true,
      grantedByUserId: "board-user",
    });
  });

  it("exposes explicit task assignment access on agent detail", async () => {
    mockAccessService.listPrincipalGrants.mockResolvedValue([
      {
        id: "grant-1",
        companyId,
        principalType: "agent",
        principalId: agentId,
        permissionKey: "tasks:assign",
        scope: null,
        grantedByUserId: "board-user",
        createdAt: new Date("2026-03-19T00:00:00.000Z"),
        updatedAt: new Date("2026-03-19T00:00:00.000Z"),
      },
    ]);

    const res = await callRoute({
      actor: {
      type: "board",
      userId: "board-user",
      source: "local_implicit",
      isInstanceAdmin: true,
      companyIds: [companyId],
    },
      method: "get",
      path: "/agents/:id",
      params: { id: agentId },
    });

    expect(res.status).toBe(200);
    expect((res.body as any).access.canAssignTasks).toBe(true);
    expect((res.body as any).access.taskAssignSource).toBe("explicit_grant");
  });

  it("keeps task assignment enabled when agent creation privilege is enabled", async () => {
    mockAgentService.updatePermissions.mockResolvedValue({
      ...baseAgent,
      permissions: { canCreateAgents: true },
    });

    const res = await callRoute({
      actor: {
      type: "board",
      userId: "board-user",
      source: "local_implicit",
      isInstanceAdmin: true,
      companyIds: [companyId],
    },
      method: "patch",
      path: "/agents/:id/permissions",
      params: { id: agentId },
      body: { canCreateAgents: true, canAssignTasks: false },
    });

    expect(res.status).toBe(200);
    expect(principalPermissionCalls).toContainEqual({
      companyId,
      principalType: "agent",
      principalId: agentId,
      permissionKey: "tasks:assign",
      enabled: true,
      grantedByUserId: "board-user",
    });
    expect((res.body as any).access.canAssignTasks).toBe(true);
    expect((res.body as any).access.taskAssignSource).toBe("agent_creator");
  });

  it("exposes a dedicated agent route for the inbox mine view", async () => {
    issueListResult = [
      {
        id: "issue-1",
        identifier: "PAP-910",
        title: "Inbox follow-up",
        status: "todo",
      },
    ];

    const res = await callRoute({
      actor: {
      type: "agent",
      agentId,
      companyId,
      runId: "run-1",
      source: "agent_key",
    },
      method: "get",
      path: "/agents/me/inbox/mine",
      query: { userId: "board-user" },
    });

    expect(res.status).toBe(200);
    expect(issueListCalls).toContainEqual({
      companyId,
      filters: {
        touchedByUserId: "board-user",
        inboxArchivedByUserId: "board-user",
        status: INBOX_MINE_ISSUE_STATUS_FILTER,
      },
    });
    expect(res.body).toEqual([
      {
        id: "issue-1",
        identifier: "PAP-910",
        title: "Inbox follow-up",
        status: "todo",
      },
    ]);
  });
});
