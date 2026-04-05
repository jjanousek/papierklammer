import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

const mockCompanyService = vi.hoisted(() => ({
  list: vi.fn(),
  stats: vi.fn(),
  getById: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  archive: vi.fn(),
  remove: vi.fn(),
}));

const mockCompanyPortabilityService = vi.hoisted(() => ({
  exportBundle: vi.fn(),
  previewExport: vi.fn(),
  previewImport: vi.fn(),
  importBundle: vi.fn(),
}));

const mockAccessService = vi.hoisted(() => ({
  canUser: vi.fn(),
  ensureMembership: vi.fn(),
}));

const mockBudgetService = vi.hoisted(() => ({
  upsertPolicy: vi.fn(),
}));

const mockAgentService = vi.hoisted(() => ({
  getById: vi.fn(),
}));

const mockLogActivity = vi.hoisted(() => vi.fn());

describe("company routes malformed issue path guard", () => {
  it("returns a clear error when companyId is missing for issues list path", async () => {
    vi.resetModules();
    vi.clearAllMocks();
    const { companyRoutes } = await import("../routes/companies.js");
    const app = express();
    app.use((req, _res, next) => {
      (req as any).actor = {
        type: "agent",
        agentId: "agent-1",
        companyId: "company-1",
        source: "agent_key",
      };
      next();
    });
    app.use(
      "/api/companies",
      companyRoutes({} as any, undefined, {
        companyService: mockCompanyService as any,
        companyPortabilityService: mockCompanyPortabilityService as any,
        accessService: mockAccessService as any,
        budgetService: mockBudgetService as any,
        agentService: mockAgentService as any,
        logActivity: mockLogActivity,
      }),
    );

    const res = await request(app).get("/api/companies/issues");

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: "Missing companyId in path. Use /api/companies/{companyId}/issues.",
    });
  });
});
