import type { RequestHandler } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "../middleware/index.js";
import { companyRoutes } from "../routes/companies.js";

const mockCompanyService = vi.hoisted(() => ({
  list: vi.fn(),
  stats: vi.fn(),
  getById: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  archive: vi.fn(),
  remove: vi.fn(),
}));

const mockAgentService = vi.hoisted(() => ({
  getById: vi.fn(),
}));

const mockAccessService = vi.hoisted(() => ({
  ensureMembership: vi.fn(),
}));

const mockBudgetService = vi.hoisted(() => ({
  upsertPolicy: vi.fn(),
}));

const mockCompanyPortabilityService = vi.hoisted(() => ({
  exportBundle: vi.fn(),
  previewExport: vi.fn(),
  previewImport: vi.fn(),
  importBundle: vi.fn(),
}));

const mockLogActivity = vi.hoisted(() => vi.fn());

function getRouteHandlers(method: "post", path: string) {
  const router = companyRoutes({} as any, undefined, {
    accessService: mockAccessService as any,
    agentService: mockAgentService as any,
    budgetService: mockBudgetService as any,
    companyPortabilityService: mockCompanyPortabilityService as any,
    companyService: mockCompanyService as any,
    logActivity: mockLogActivity,
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
  path: "/:companyId/exports/preview" | "/:companyId/imports/preview" | "/import/preview";
  params: Record<string, string>;
  body: unknown;
  originalUrl: string;
}) {
  const req = {
    actor: options.actor,
    body: options.body,
    params: options.params,
    query: {},
    method: "POST",
    originalUrl: options.originalUrl,
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
    await runHandlers(getRouteHandlers("post", options.path), req, res);
  } catch (error) {
    errorHandler(error, req, res, (() => undefined) as any);
  }

  return { status: statusCode, body };
}

describe("company portability routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAgentService.getById.mockReset();
    mockCompanyPortabilityService.exportBundle.mockReset();
    mockCompanyPortabilityService.previewExport.mockReset();
    mockCompanyPortabilityService.previewImport.mockReset();
    mockCompanyPortabilityService.importBundle.mockReset();
    mockLogActivity.mockReset();
  });

  it("rejects non-CEO agents from CEO-safe export preview routes", async () => {
    mockAgentService.getById.mockResolvedValue({
      id: "agent-1",
      companyId: "11111111-1111-4111-8111-111111111111",
      role: "engineer",
    });
    const res = await callRoute({
      actor: {
        type: "agent",
        agentId: "agent-1",
        companyId: "11111111-1111-4111-8111-111111111111",
        source: "agent_key",
        runId: "run-1",
      },
      path: "/:companyId/exports/preview",
      params: {
        companyId: "11111111-1111-4111-8111-111111111111",
      },
      originalUrl: "/api/companies/11111111-1111-4111-8111-111111111111/exports/preview",
      body: { include: { company: true, agents: true, projects: true } },
    });

    expect(res.status).toBe(403);
    expect((res.body as any).error).toContain("Only CEO agents");
    expect(mockCompanyPortabilityService.previewExport).not.toHaveBeenCalled();
  });

  it("allows CEO agents to use company-scoped export preview routes", async () => {
    mockAgentService.getById.mockResolvedValue({
      id: "agent-1",
      companyId: "11111111-1111-4111-8111-111111111111",
      role: "ceo",
    });
    mockCompanyPortabilityService.previewExport.mockResolvedValue({
      rootPath: "paperclip",
      manifest: { agents: [], skills: [], projects: [], issues: [], envInputs: [], includes: { company: true, agents: true, projects: true, issues: false, skills: false }, company: null, schemaVersion: 1, generatedAt: new Date().toISOString(), source: null },
      files: {},
      fileInventory: [],
      counts: { files: 0, agents: 0, skills: 0, projects: 0, issues: 0 },
      warnings: [],
      paperclipExtensionPath: ".paperclip.yaml",
    });
    const res = await callRoute({
      actor: {
        type: "agent",
        agentId: "agent-1",
        companyId: "11111111-1111-4111-8111-111111111111",
        source: "agent_key",
        runId: "run-1",
      },
      path: "/:companyId/exports/preview",
      params: {
        companyId: "11111111-1111-4111-8111-111111111111",
      },
      originalUrl: "/api/companies/11111111-1111-4111-8111-111111111111/exports/preview",
      body: { include: { company: true, agents: true, projects: true } },
    });

    expect(res.status).toBe(200);
    expect(mockCompanyPortabilityService.previewExport).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111", {
      include: { company: true, agents: true, projects: true },
    });
  });

  it("rejects replace collision strategy on CEO-safe import routes", async () => {
    mockAgentService.getById.mockResolvedValue({
      id: "agent-1",
      companyId: "11111111-1111-4111-8111-111111111111",
      role: "ceo",
    });
    const res = await callRoute({
      actor: {
        type: "agent",
        agentId: "agent-1",
        companyId: "11111111-1111-4111-8111-111111111111",
        source: "agent_key",
        runId: "run-1",
      },
      path: "/:companyId/imports/preview",
      params: {
        companyId: "11111111-1111-4111-8111-111111111111",
      },
      originalUrl: "/api/companies/11111111-1111-4111-8111-111111111111/imports/preview",
      body: {
        source: { type: "inline", files: { "COMPANY.md": "---\nname: Test\n---\n" } },
        include: { company: true, agents: true, projects: false, issues: false },
        target: { mode: "existing_company", companyId: "11111111-1111-4111-8111-111111111111" },
        collisionStrategy: "replace",
      },
    });

    expect(res.status).toBe(403);
    expect((res.body as any).error).toContain("does not allow replace");
    expect(mockCompanyPortabilityService.previewImport).not.toHaveBeenCalled();
  });

  it("keeps global import preview routes board-only", async () => {
    const res = await callRoute({
      actor: {
        type: "agent",
        agentId: "agent-1",
        companyId: "11111111-1111-4111-8111-111111111111",
        source: "agent_key",
        runId: "run-1",
      },
      path: "/import/preview",
      params: {},
      originalUrl: "/api/companies/import/preview",
      body: {
        source: { type: "inline", files: { "COMPANY.md": "---\nname: Test\n---\n" } },
        include: { company: true, agents: true, projects: false, issues: false },
        target: { mode: "existing_company", companyId: "11111111-1111-4111-8111-111111111111" },
        collisionStrategy: "rename",
      },
    });

    expect(res.status).toBe(403);
    expect((res.body as any).error).toContain("Board access required");
  });
});
