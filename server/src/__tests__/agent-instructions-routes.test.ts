import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

let mockAgentService: {
  getById: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  resolveByReference: ReturnType<typeof vi.fn>;
};
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
let mockAccessService: {
  canUser: ReturnType<typeof vi.fn>;
  hasPermission: ReturnType<typeof vi.fn>;
};
let mockSecretService: {
  resolveAdapterConfigForRuntime: ReturnType<typeof vi.fn>;
  normalizeAdapterConfigForPersistence: ReturnType<typeof vi.fn>;
};
let mockLogActivity: ReturnType<typeof vi.fn>;
let agentUpdateCalls: Array<{
  id: string;
  patch: Record<string, unknown>;
  options: Record<string, unknown> | undefined;
}>;
let writeFileCalls: Array<{
  agentId: string;
  path: string;
  content: string;
  options: Record<string, unknown> | undefined;
}>;

async function createApp() {
  const [{ agentRoutes }, { errorHandler }] = await Promise.all([
    vi.importActual<typeof import("../routes/agents.js")>("../routes/agents.js"),
    vi.importActual<typeof import("../middleware/index.js")>("../middleware/index.js"),
  ]);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = {
      type: "board",
      userId: "local-board",
      companyIds: ["company-1"],
      source: "local_implicit",
      isInstanceAdmin: false,
    };
    next();
  });
  app.use("/api", agentRoutes({} as any, {
    agentService: mockAgentService as any,
    agentInstructionsService: mockAgentInstructionsService as any,
    accessService: mockAccessService as any,
    secretService: mockSecretService as any,
    logActivity: mockLogActivity,
    approvalService: {} as any,
    companySkillService: { listRuntimeSkillEntries: vi.fn() } as any,
    budgetService: {} as any,
    heartbeatService: {} as any,
    issueApprovalService: {} as any,
    workspaceOperationService: {} as any,
    syncInstructionsBundleConfigFromFilePath: (_agent, config) => config,
  }));
  app.use(errorHandler);
  return app;
}

function makeAgent() {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    companyId: "company-1",
    name: "Agent",
    role: "engineer",
    title: "Engineer",
    status: "active",
    reportsTo: null,
    capabilities: null,
    adapterType: "codex_local",
    adapterConfig: {},
    runtimeConfig: {},
    permissions: null,
    updatedAt: new Date(),
  };
}

describe("agent instructions bundle routes", () => {
  beforeEach(() => {
    agentUpdateCalls = [];
    writeFileCalls = [];
    mockAgentService = {
      getById: vi.fn(),
      update: vi.fn(),
      resolveByReference: vi.fn(),
    };
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
    mockAccessService = {
      canUser: vi.fn(),
      hasPermission: vi.fn(),
    };
    mockSecretService = {
      resolveAdapterConfigForRuntime: vi.fn(),
      normalizeAdapterConfigForPersistence: vi.fn(async (_companyId: string, config: Record<string, unknown>) => config),
    };
    mockLogActivity = vi.fn();
    mockAgentService.getById.mockResolvedValue(makeAgent());
    mockAgentService.update.mockImplementation(
      async (id: string, patch: Record<string, unknown>, options?: Record<string, unknown>) => {
        agentUpdateCalls.push({ id, patch, options });
        const existing = await mockAgentService.getById(id);
        return {
          ...(existing ?? makeAgent()),
          ...patch,
          adapterConfig: patch.adapterConfig ?? (existing?.adapterConfig ?? {}),
        };
      },
    );
    mockAgentInstructionsService.getBundle.mockResolvedValue({
      agentId: "11111111-1111-4111-8111-111111111111",
      companyId: "company-1",
      mode: "managed",
      rootPath: "/tmp/agent-1",
      managedRootPath: "/tmp/agent-1",
      entryFile: "AGENTS.md",
      resolvedEntryPath: "/tmp/agent-1/AGENTS.md",
      editable: true,
      warnings: [],
      legacyPromptTemplateActive: false,
      legacyBootstrapPromptTemplateActive: false,
      files: [{
        path: "AGENTS.md",
        size: 12,
        language: "markdown",
        markdown: true,
        isEntryFile: true,
        editable: true,
        deprecated: false,
        virtual: false,
      }],
    });
    mockAgentInstructionsService.readFile.mockResolvedValue({
      path: "AGENTS.md",
      size: 12,
      language: "markdown",
      markdown: true,
      isEntryFile: true,
      editable: true,
      deprecated: false,
      virtual: false,
      content: "# Agent\n",
    });
    mockAgentInstructionsService.writeFile.mockImplementation(
      async (
        agent: { id: string },
        path: string,
        content: string,
        options?: Record<string, unknown>,
      ) => {
        writeFileCalls.push({ agentId: agent.id, path, content, options });
        return {
          bundle: null,
          file: {
            path: "AGENTS.md",
            size: 18,
            language: "markdown",
            markdown: true,
            isEntryFile: true,
            editable: true,
            deprecated: false,
            virtual: false,
            content: "# Updated Agent\n",
          },
          adapterConfig: {
            instructionsBundleMode: "managed",
            instructionsRootPath: "/tmp/agent-1",
            instructionsEntryFile: "AGENTS.md",
            instructionsFilePath: "/tmp/agent-1/AGENTS.md",
          },
        };
      },
    );
  });

  it("returns bundle metadata", async () => {
    const res = await request(await createApp())
      .get("/api/agents/11111111-1111-4111-8111-111111111111/instructions-bundle?companyId=company-1");

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({
      mode: "managed",
      rootPath: "/tmp/agent-1",
      managedRootPath: "/tmp/agent-1",
      entryFile: "AGENTS.md",
    });
    expect(mockAgentInstructionsService.getBundle).toHaveBeenCalled();
  });

  it("writes a bundle file and persists compatibility config", async () => {
    mockSecretService.normalizeAdapterConfigForPersistence.mockImplementationOnce(
      async (_companyId: string, config: Record<string, unknown>) => ({
        ...config,
        normalizedForPersistence: true,
      }),
    );

    const res = await request(await createApp())
      .put("/api/agents/11111111-1111-4111-8111-111111111111/instructions-bundle/file?companyId=company-1")
      .send({
        path: "AGENTS.md",
        content: "# Updated Agent\n",
        clearLegacyPromptTemplate: true,
      });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(writeFileCalls).toEqual([
      {
        agentId: "11111111-1111-4111-8111-111111111111",
        path: "AGENTS.md",
        content: "# Updated Agent\n",
        options: { clearLegacyPromptTemplate: true },
      },
    ]);
    expect(agentUpdateCalls).toEqual([
      {
        id: "11111111-1111-4111-8111-111111111111",
        patch: {
          adapterConfig: {
            instructionsBundleMode: "managed",
            instructionsRootPath: "/tmp/agent-1",
            instructionsEntryFile: "AGENTS.md",
            instructionsFilePath: "/tmp/agent-1/AGENTS.md",
            normalizedForPersistence: true,
          },
        },
        options: {
          recordRevision: {
            createdByAgentId: null,
            createdByUserId: "local-board",
            source: "instructions_bundle_file_put",
          },
        },
      },
    ]);
  });

  it("preserves managed instructions config when switching adapters", async () => {
    mockAgentService.getById.mockResolvedValue({
      ...makeAgent(),
      adapterType: "codex_local",
      adapterConfig: {
        instructionsBundleMode: "managed",
        instructionsRootPath: "/tmp/agent-1",
        instructionsEntryFile: "AGENTS.md",
        instructionsFilePath: "/tmp/agent-1/AGENTS.md",
        model: "gpt-5.4",
      },
    });

    const res = await request(await createApp())
      .patch("/api/agents/11111111-1111-4111-8111-111111111111?companyId=company-1")
      .send({
        adapterType: "claude_local",
        adapterConfig: {
          model: "claude-sonnet-4",
        },
      });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.adapterType).toBe("claude_local");
    expect(res.body.adapterConfig).toMatchObject({
      model: "claude-sonnet-4",
      instructionsBundleMode: "managed",
      instructionsRootPath: "/tmp/agent-1",
      instructionsEntryFile: "AGENTS.md",
      instructionsFilePath: "/tmp/agent-1/AGENTS.md",
    });
  });

  it("merges same-adapter config patches so instructions metadata is not dropped", async () => {
    mockAgentService.getById.mockResolvedValue({
      ...makeAgent(),
      adapterType: "codex_local",
      adapterConfig: {
        instructionsBundleMode: "managed",
        instructionsRootPath: "/tmp/agent-1",
        instructionsEntryFile: "AGENTS.md",
        instructionsFilePath: "/tmp/agent-1/AGENTS.md",
        model: "gpt-5.4",
      },
    });

    const res = await request(await createApp())
      .patch("/api/agents/11111111-1111-4111-8111-111111111111?companyId=company-1")
      .send({
        adapterConfig: {
          command: "codex --profile engineer",
        },
      });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.adapterConfig).toMatchObject({
      command: "codex --profile engineer",
      model: "gpt-5.4",
      instructionsBundleMode: "managed",
      instructionsRootPath: "/tmp/agent-1",
      instructionsEntryFile: "AGENTS.md",
      instructionsFilePath: "/tmp/agent-1/AGENTS.md",
    });
  });

  it("replaces adapter config when replaceAdapterConfig is true", async () => {
    mockAgentService.getById.mockResolvedValue({
      ...makeAgent(),
      adapterType: "codex_local",
      adapterConfig: {
        instructionsBundleMode: "managed",
        instructionsRootPath: "/tmp/agent-1",
        instructionsEntryFile: "AGENTS.md",
        instructionsFilePath: "/tmp/agent-1/AGENTS.md",
        model: "gpt-5.4",
      },
    });

    const res = await request(await createApp())
      .patch("/api/agents/11111111-1111-4111-8111-111111111111?companyId=company-1")
      .send({
        replaceAdapterConfig: true,
        adapterConfig: {
          command: "codex --profile engineer",
        },
      });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.adapterConfig).toMatchObject({
      command: "codex --profile engineer",
    });
    expect(res.body.adapterConfig.instructionsBundleMode).toBeUndefined();
    expect(res.body.adapterConfig.instructionsRootPath).toBeUndefined();
    expect(res.body.adapterConfig.instructionsEntryFile).toBeUndefined();
    expect(res.body.adapterConfig.instructionsFilePath).toBeUndefined();
  });
});
