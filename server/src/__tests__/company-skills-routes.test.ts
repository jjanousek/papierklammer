import type { RequestHandler } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "../middleware/index.js";
import { companySkillRoutes } from "../routes/company-skills.js";

const mockAgentService = {
  getById: vi.fn(),
};

const mockAccessService = {
  canUser: vi.fn(),
  hasPermission: vi.fn(),
};

const mockCompanySkillService = {
  createLocalSkill: vi.fn(),
  importFromSource: vi.fn(),
};

const mockLogActivity = vi.fn();

function getRouteHandlers(method: "post", path: string) {
  const router = companySkillRoutes({} as any, {
    accessService: mockAccessService as any,
    agentService: mockAgentService as any,
    companySkillService: mockCompanySkillService as any,
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

async function invokeRoute({
  actor,
  path,
  params,
  body,
}: {
  actor: Record<string, unknown>;
  path: "/companies/:companyId/skills" | "/companies/:companyId/skills/import";
  params: Record<string, unknown>;
  body: Record<string, unknown>;
}) {
  const req = {
    actor,
    body,
    params,
    query: {},
    method: "POST",
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
    await runHandlers(getRouteHandlers("post", path), req, res);
  } catch (error) {
    errorHandler(error, req, res, (() => undefined) as any);
  }

  return {
    status: statusCode,
    body: responseBody,
  };
}

describe("company skill mutation permissions", () => {
  beforeEach(() => {
    mockAgentService.getById.mockReset();
    mockAccessService.canUser.mockReset();
    mockAccessService.hasPermission.mockReset();
    mockCompanySkillService.createLocalSkill.mockReset();
    mockCompanySkillService.importFromSource.mockReset();
    mockLogActivity.mockReset();
    mockCompanySkillService.createLocalSkill.mockResolvedValue({
      id: "skill-1",
      slug: "company-skill",
      name: "Company Skill",
      description: null,
      markdown: "# Company Skill",
    });
    mockCompanySkillService.importFromSource.mockResolvedValue({
      imported: [],
      warnings: [],
    });
    mockLogActivity.mockResolvedValue(undefined);
    mockAccessService.canUser.mockResolvedValue(true);
    mockAccessService.hasPermission.mockResolvedValue(false);
  });

  it("preserves the 201 contract when local board operators create company skills", async () => {
    const body = {
      name: "Company Skill",
      slug: "company-skill",
      markdown: "# Company Skill",
    };

    const res = await invokeRoute({
      actor: {
        type: "board",
        userId: "local-board",
        companyIds: ["company-1"],
        source: "local_implicit",
        isInstanceAdmin: false,
      },
      path: "/companies/:companyId/skills",
      params: { companyId: "company-1" },
      body,
    });

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(mockCompanySkillService.createLocalSkill).toHaveBeenCalledWith(
      "company-1",
      body,
    );
  });

  it("blocks same-company agents without management permission from mutating company skills", async () => {
    mockAgentService.getById.mockResolvedValue({
      id: "agent-1",
      companyId: "company-1",
      permissions: {},
    });

    const res = await invokeRoute({
      actor: {
        type: "agent",
        agentId: "agent-1",
        companyId: "company-1",
        runId: "run-1",
      },
      path: "/companies/:companyId/skills",
      params: { companyId: "company-1" },
      body: {
        name: "Company Skill",
      },
    });

    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(mockCompanySkillService.createLocalSkill).not.toHaveBeenCalled();
    expect(mockCompanySkillService.importFromSource).not.toHaveBeenCalled();
  });

  it("preserves the 201 contract when local board operators import company skills", async () => {
    const res = await invokeRoute({
      actor: {
        type: "board",
        userId: "local-board",
        companyIds: ["company-1"],
        source: "local_implicit",
        isInstanceAdmin: false,
      },
      path: "/companies/:companyId/skills/import",
      params: { companyId: "company-1" },
      body: { source: "https://github.com/vercel-labs/agent-browser" },
    });

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(mockCompanySkillService.importFromSource).toHaveBeenCalledWith(
      "company-1",
      "https://github.com/vercel-labs/agent-browser",
    );
  });

  it("allows agents with canCreateAgents to mutate company skills", async () => {
    mockAgentService.getById.mockResolvedValue({
      id: "agent-1",
      companyId: "company-1",
      permissions: { canCreateAgents: true },
    });

    const res = await invokeRoute({
      actor: {
        type: "agent",
        agentId: "agent-1",
        companyId: "company-1",
        runId: "run-1",
      },
      path: "/companies/:companyId/skills",
      params: { companyId: "company-1" },
      body: {
        name: "Company Skill",
      },
    });

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(mockCompanySkillService.createLocalSkill).toHaveBeenCalled();
  });
});
