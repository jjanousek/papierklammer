import type { RequestHandler } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "../middleware/index.js";
import { agentRoutes } from "../routes/agents.js";

let mockAgentService: {
  getById: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
  resolveByReference: ReturnType<typeof vi.fn>;
};
let mockAccessService: {
  canUser: ReturnType<typeof vi.fn>;
  hasPermission: ReturnType<typeof vi.fn>;
  getMembership: ReturnType<typeof vi.fn>;
  listPrincipalGrants: ReturnType<typeof vi.fn>;
  ensureMembership: ReturnType<typeof vi.fn>;
  setPrincipalPermission: ReturnType<typeof vi.fn>;
};
let mockApprovalService: {
  create: ReturnType<typeof vi.fn>;
};
let mockBudgetService: Record<string, never>;
let mockHeartbeatService: Record<string, never>;
let mockIssueApprovalService: {
  linkManyForApproval: ReturnType<typeof vi.fn>;
};
let mockWorkspaceOperationService: Record<string, never>;
let mockAgentInstructionsService: {
  getBundle: ReturnType<typeof vi.fn>;
  readFile: ReturnType<typeof vi.fn>;
  updateBundle: ReturnType<typeof vi.fn>;
  writeFile: ReturnType<typeof vi.fn>;
  deleteFile: ReturnType<typeof vi.fn>;
  exportFiles: ReturnType<typeof vi.fn>;
  ensureManagedBundle: ReturnType<typeof vi.fn>;
  materializeManagedBundle: ReturnType<typeof vi.fn>;
};
let mockCompanySkillService: {
  listRuntimeSkillEntries: ReturnType<typeof vi.fn>;
  resolveRequestedSkillKeys: ReturnType<typeof vi.fn>;
};
let mockSecretService: {
  resolveAdapterConfigForRuntime: ReturnType<typeof vi.fn>;
  normalizeAdapterConfigForPersistence: ReturnType<typeof vi.fn>;
};
let mockLogActivity: ReturnType<typeof vi.fn>;
let mockAdapter: {
  listSkills: ReturnType<typeof vi.fn>;
  syncSkills: ReturnType<typeof vi.fn>;
};

function createDb(requireBoardApprovalForNewAgents = false) {
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(async () => [
          {
            id: "company-1",
            requireBoardApprovalForNewAgents,
          },
        ]),
      })),
    })),
  };
}

function createApp(db: Record<string, unknown> = createDb()) {
  return agentRoutes(db as any, {
    agentService: mockAgentService as any,
    agentInstructionsService: mockAgentInstructionsService as any,
    accessService: mockAccessService as any,
    approvalService: mockApprovalService as any,
    companySkillService: mockCompanySkillService as any,
    budgetService: mockBudgetService as any,
    heartbeatService: mockHeartbeatService as any,
    issueApprovalService: mockIssueApprovalService as any,
    secretService: mockSecretService as any,
    workspaceOperationService: mockWorkspaceOperationService as any,
    logActivity: mockLogActivity,
    syncInstructionsBundleConfigFromFilePath: (_agent, config) => config,
    findServerAdapter: () => mockAdapter as any,
  });
}

function getRouteHandlers(
  db: Record<string, unknown>,
  method: "get" | "post" | "patch" | "delete",
  path: string,
) {
  const router = createApp(db);
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
  db?: Record<string, unknown>;
  method: "get" | "post" | "patch" | "delete";
  path: string;
  body?: unknown;
  query?: Record<string, unknown>;
  params?: Record<string, string>;
}) {
  const req = {
    actor: {
      type: "board",
      userId: "local-board",
      companyIds: ["company-1"],
      source: "local_implicit",
      isInstanceAdmin: false,
    },
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
  } as any;

  try {
    await runHandlers(
      getRouteHandlers(options.db ?? createDb(), options.method, options.path),
      req,
      res,
    );
  } catch (error) {
    errorHandler(error, req, res, (() => undefined) as any);
  }

  return { status: statusCode, body };
}

function makeAgent(adapterType: string) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    companyId: "company-1",
    name: "Agent",
    role: "engineer",
    title: "Engineer",
    status: "active",
    reportsTo: null,
    capabilities: null,
    adapterType,
    adapterConfig: {},
    runtimeConfig: {},
    permissions: null,
    updatedAt: new Date(),
  };
}

describe("agent skill routes", () => {
  beforeEach(() => {
    mockAgentService = {
      getById: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
      resolveByReference: vi.fn(),
    };
    mockAccessService = {
      canUser: vi.fn(),
      hasPermission: vi.fn(),
      getMembership: vi.fn(),
      listPrincipalGrants: vi.fn(),
      ensureMembership: vi.fn(),
      setPrincipalPermission: vi.fn(),
    };
    mockApprovalService = {
      create: vi.fn(),
    };
    mockBudgetService = {};
    mockHeartbeatService = {};
    mockIssueApprovalService = {
      linkManyForApproval: vi.fn(),
    };
    mockWorkspaceOperationService = {};
    mockAgentInstructionsService = {
      getBundle: vi.fn(),
      readFile: vi.fn(),
      updateBundle: vi.fn(),
      writeFile: vi.fn(),
      deleteFile: vi.fn(),
      exportFiles: vi.fn(),
      ensureManagedBundle: vi.fn(),
      materializeManagedBundle: vi.fn(),
    };
    mockCompanySkillService = {
      listRuntimeSkillEntries: vi.fn(),
      resolveRequestedSkillKeys: vi.fn(),
    };
    mockSecretService = {
      resolveAdapterConfigForRuntime: vi.fn(),
      normalizeAdapterConfigForPersistence: vi.fn(async (_companyId: string, config: Record<string, unknown>) => config),
    };
    mockLogActivity = vi.fn();
    mockAdapter = {
      listSkills: vi.fn(),
      syncSkills: vi.fn(),
    };
    mockAgentService.resolveByReference.mockResolvedValue({
      ambiguous: false,
      agent: makeAgent("claude_local"),
    });
    mockSecretService.resolveAdapterConfigForRuntime.mockResolvedValue({ config: { env: {} } });
    mockCompanySkillService.listRuntimeSkillEntries.mockResolvedValue([
      {
        key: "papierklammer/papierklammer/papierklammer",
        runtimeName: "papierklammer",
        source: "/tmp/papierklammer",
        required: true,
        requiredReason: "required",
      },
    ]);
    mockCompanySkillService.resolveRequestedSkillKeys.mockImplementation(
      async (_companyId: string, requested: string[]) =>
        requested.map((value) =>
          value === "paperclip"
            ? "papierklammer/papierklammer/papierklammer"
            : value,
        ),
    );
    mockAdapter.listSkills.mockResolvedValue({
      adapterType: "claude_local",
      supported: true,
      mode: "ephemeral",
      desiredSkills: ["papierklammer/papierklammer/papierklammer"],
      entries: [],
      warnings: [],
    });
    mockAdapter.syncSkills.mockResolvedValue({
      adapterType: "claude_local",
      supported: true,
      mode: "ephemeral",
      desiredSkills: ["papierklammer/papierklammer/papierklammer"],
      entries: [],
      warnings: [],
    });
    mockAgentService.update.mockImplementation(async (_id: string, patch: Record<string, unknown>) => ({
      ...makeAgent("claude_local"),
      adapterConfig: patch.adapterConfig ?? {},
    }));
    mockAgentService.create.mockImplementation(async (_companyId: string, input: Record<string, unknown>) => ({
      ...makeAgent(String(input.adapterType ?? "claude_local")),
      ...input,
      adapterConfig: input.adapterConfig ?? {},
      runtimeConfig: input.runtimeConfig ?? {},
      budgetMonthlyCents: Number(input.budgetMonthlyCents ?? 0),
      permissions: null,
    }));
    mockApprovalService.create.mockImplementation(async (_companyId: string, input: Record<string, unknown>) => ({
      id: "approval-1",
      companyId: "company-1",
      type: "hire_agent",
      status: "pending",
      payload: input.payload ?? {},
    }));
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
    mockLogActivity.mockResolvedValue(undefined);
    mockAccessService.canUser.mockResolvedValue(true);
    mockAccessService.hasPermission.mockResolvedValue(true);
    mockAccessService.getMembership.mockResolvedValue(null);
    mockAccessService.listPrincipalGrants.mockResolvedValue([]);
    mockAccessService.ensureMembership.mockResolvedValue(undefined);
    mockAccessService.setPrincipalPermission.mockResolvedValue(undefined);
  });

  it("skips runtime materialization when listing Claude skills", async () => {
    mockAgentService.getById.mockResolvedValue(makeAgent("claude_local"));

    const res = await callRoute({
      method: "get",
      path: "/agents/:id/skills",
      params: { id: "11111111-1111-4111-8111-111111111111" },
      query: { companyId: "company-1" },
    });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(mockCompanySkillService.listRuntimeSkillEntries).toHaveBeenCalledWith("company-1", {
      materializeMissing: false,
    });
    expect(mockAdapter.listSkills).toHaveBeenCalledWith(
      expect.objectContaining({
        adapterType: "claude_local",
        config: expect.objectContaining({
          paperclipRuntimeSkills: expect.any(Array),
        }),
      }),
    );
  });

  it("keeps runtime materialization for persistent skill adapters", async () => {
    mockAgentService.getById.mockResolvedValue(makeAgent("codex_local"));
    mockAdapter.listSkills.mockResolvedValue({
      adapterType: "codex_local",
      supported: true,
      mode: "persistent",
      desiredSkills: ["papierklammer/papierklammer/papierklammer"],
      entries: [],
      warnings: [],
    });

    const res = await callRoute({
      method: "get",
      path: "/agents/:id/skills",
      params: { id: "11111111-1111-4111-8111-111111111111" },
      query: { companyId: "company-1" },
    });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(mockCompanySkillService.listRuntimeSkillEntries).toHaveBeenCalledWith("company-1", {
      materializeMissing: true,
    });
  });

  it("skips runtime materialization when syncing Claude skills", async () => {
    mockAgentService.getById.mockResolvedValue(makeAgent("claude_local"));

    const res = await callRoute({
      method: "post",
      path: "/agents/:id/skills/sync",
      params: { id: "11111111-1111-4111-8111-111111111111" },
      query: { companyId: "company-1" },
      body: { desiredSkills: ["papierklammer/papierklammer/papierklammer"] },
    });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(mockCompanySkillService.listRuntimeSkillEntries).toHaveBeenCalledWith("company-1", {
      materializeMissing: false,
    });
    expect(mockAdapter.syncSkills).toHaveBeenCalled();
  });

  it("rejects legacy bundled skill references before syncing", async () => {
    mockAgentService.getById.mockResolvedValue(makeAgent("claude_local"));

    const res = await callRoute({
      method: "post",
      path: "/agents/:id/skills/sync",
      params: { id: "11111111-1111-4111-8111-111111111111" },
      query: { companyId: "company-1" },
      body: { desiredSkills: ["paperclip"] },
    });

    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(mockCompanySkillService.resolveRequestedSkillKeys).not.toHaveBeenCalled();
    expect(mockAgentService.update).not.toHaveBeenCalled();
  });

  it("rejects legacy bundled skill references when creating an agent directly", async () => {
    const res = await callRoute({
      method: "post",
      path: "/companies/:companyId/agents",
      params: { companyId: "company-1" },
      body: {
        name: "QA Agent",
        role: "engineer",
        adapterType: "claude_local",
        desiredSkills: ["paperclip"],
        adapterConfig: {},
      },
    });

    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(mockCompanySkillService.resolveRequestedSkillKeys).not.toHaveBeenCalled();
    expect(mockAgentService.create).not.toHaveBeenCalled();
  });

  it("materializes a managed AGENTS.md for directly created local agents", async () => {
    const res = await callRoute({
      method: "post",
      path: "/companies/:companyId/agents",
      params: { companyId: "company-1" },
      body: {
        name: "QA Agent",
        role: "engineer",
        adapterType: "claude_local",
        adapterConfig: {
          promptTemplate: "You are QA.",
        },
      },
    });

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(mockAgentInstructionsService.materializeManagedBundle).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "11111111-1111-4111-8111-111111111111",
        adapterType: "claude_local",
      }),
      { "AGENTS.md": "You are QA." },
      { entryFile: "AGENTS.md", replaceExisting: false },
    );
    expect(mockAgentService.update).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
      expect.objectContaining({
        adapterConfig: expect.objectContaining({
          instructionsBundleMode: "managed",
          instructionsEntryFile: "AGENTS.md",
          instructionsFilePath: "/tmp/11111111-1111-4111-8111-111111111111/instructions/AGENTS.md",
        }),
      }),
    );
    expect(mockAgentService.update.mock.calls.at(-1)?.[1]).not.toMatchObject({
      adapterConfig: expect.objectContaining({
        promptTemplate: expect.anything(),
      }),
    });
  });

  it("materializes the bundled CEO instruction set for default CEO agents", async () => {
    const res = await callRoute({
      method: "post",
      path: "/companies/:companyId/agents",
      params: { companyId: "company-1" },
      body: {
        name: "CEO",
        role: "ceo",
        adapterType: "claude_local",
        adapterConfig: {},
      },
    });

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(mockAgentInstructionsService.materializeManagedBundle).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "11111111-1111-4111-8111-111111111111",
        role: "ceo",
        adapterType: "claude_local",
      }),
      expect.objectContaining({
        "AGENTS.md": expect.stringContaining("You are the CEO."),
        "HEARTBEAT.md": expect.stringContaining("CEO Heartbeat Checklist"),
        "SOUL.md": expect.stringContaining("CEO Persona"),
        "TOOLS.md": expect.stringContaining("# Tools"),
      }),
      { entryFile: "AGENTS.md", replaceExisting: false },
    );
  });

  it("materializes the bundled default instruction set for non-CEO agents with no prompt template", async () => {
    const res = await callRoute({
      method: "post",
      path: "/companies/:companyId/agents",
      params: { companyId: "company-1" },
      body: {
        name: "Engineer",
        role: "engineer",
        adapterType: "claude_local",
        adapterConfig: {},
      },
    });

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(mockAgentInstructionsService.materializeManagedBundle).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "11111111-1111-4111-8111-111111111111",
        role: "engineer",
        adapterType: "claude_local",
      }),
      expect.objectContaining({
        "AGENTS.md": expect.stringContaining("Keep the work moving until it's done."),
      }),
      { entryFile: "AGENTS.md", replaceExisting: false },
    );
  });

  it("rejects legacy bundled skill references in hire approvals", async () => {
    const db = createDb(true);

    const res = await callRoute({
      db,
      method: "post",
      path: "/companies/:companyId/agent-hires",
      params: { companyId: "company-1" },
      body: {
        name: "QA Agent",
        role: "engineer",
        adapterType: "claude_local",
        desiredSkills: ["paperclip"],
        adapterConfig: {},
      },
    });

    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(mockCompanySkillService.resolveRequestedSkillKeys).not.toHaveBeenCalled();
    expect(mockApprovalService.create).not.toHaveBeenCalled();
  });

  it("uses managed AGENTS config in hire approval payloads", async () => {
    const res = await callRoute({
      db: createDb(true),
      method: "post",
      path: "/companies/:companyId/agent-hires",
      params: { companyId: "company-1" },
      body: {
        name: "QA Agent",
        role: "engineer",
        adapterType: "claude_local",
        adapterConfig: {
          promptTemplate: "You are QA.",
        },
      },
    });

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(mockApprovalService.create).toHaveBeenCalledWith(
      "company-1",
      expect.objectContaining({
        payload: expect.objectContaining({
          adapterConfig: expect.objectContaining({
            instructionsBundleMode: "managed",
            instructionsEntryFile: "AGENTS.md",
            instructionsFilePath: "/tmp/11111111-1111-4111-8111-111111111111/instructions/AGENTS.md",
          }),
        }),
      }),
    );
    const approvalInput = mockApprovalService.create.mock.calls.at(-1)?.[1] as
      | { payload?: { adapterConfig?: Record<string, unknown> } }
      | undefined;
    expect(approvalInput?.payload?.adapterConfig?.promptTemplate).toBeUndefined();
  });
});
