import { beforeEach, describe, expect, it, vi } from "vitest";
import { costRoutes } from "../routes/costs.js";
import { errorHandler } from "../middleware/index.js";

function makeDb(overrides: Record<string, unknown> = {}) {
  const selectChain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    leftJoin: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    groupBy: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    then: vi.fn().mockResolvedValue([]),
  };

  const thenableChain = Object.assign(Promise.resolve([]), selectChain);

  return {
    select: vi.fn().mockReturnValue(thenableChain),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([]) }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
    }),
    ...overrides,
  };
}

const mockCompanyService = vi.hoisted(() => ({
  getById: vi.fn(),
  update: vi.fn(),
}));
const mockAgentService = vi.hoisted(() => ({
  getById: vi.fn(),
  update: vi.fn(),
}));
const mockHeartbeatService = vi.hoisted(() => ({
  cancelBudgetScopeWork: vi.fn().mockResolvedValue(undefined),
}));
const mockLogActivity = vi.hoisted(() => vi.fn());
const mockFetchAllQuotaWindows = vi.hoisted(() => vi.fn());
const mockCostService = vi.hoisted(() => ({
  createEvent: vi.fn(),
  summary: vi.fn().mockResolvedValue({ spendCents: 0 }),
  byAgent: vi.fn().mockResolvedValue([]),
  byAgentModel: vi.fn().mockResolvedValue([]),
  byProvider: vi.fn().mockResolvedValue([]),
  byBiller: vi.fn().mockResolvedValue([]),
  windowSpend: vi.fn().mockResolvedValue([]),
  byProject: vi.fn().mockResolvedValue([]),
}));
const mockFinanceService = vi.hoisted(() => ({
  createEvent: vi.fn(),
  summary: vi.fn().mockResolvedValue({ debitCents: 0, creditCents: 0, netCents: 0, estimatedDebitCents: 0, eventCount: 0 }),
  byBiller: vi.fn().mockResolvedValue([]),
  byKind: vi.fn().mockResolvedValue([]),
  list: vi.fn().mockResolvedValue([]),
}));
const mockBudgetService = vi.hoisted(() => ({
  overview: vi.fn().mockResolvedValue({
    companyId: "company-1",
    policies: [],
    activeIncidents: [],
    pausedAgentCount: 0,
    pausedProjectCount: 0,
    pendingApprovalCount: 0,
  }),
  upsertPolicy: vi.fn(),
  resolveIncident: vi.fn(),
}));

type RouteMethod = "get" | "patch";

function createRouteHandler(method: RouteMethod, path: string) {
  const router = costRoutes(makeDb() as any, {
    budgetService: mockBudgetService as any,
    costService: mockCostService as any,
    financeService: mockFinanceService as any,
    companyService: mockCompanyService as any,
    agentService: mockAgentService as any,
    heartbeatService: mockHeartbeatService as any,
    logActivity: mockLogActivity,
    fetchAllQuotaWindows: mockFetchAllQuotaWindows,
  }) as unknown as {
    stack?: Array<{
      route?: {
        path?: string;
        methods?: Partial<Record<RouteMethod, boolean>>;
        stack?: Array<{ handle: (req: unknown, res: unknown) => Promise<void> | void }>;
      };
    }>;
  };
  const layer = router.stack?.find(
    (entry) => entry.route?.path === path && entry.route.methods?.[method],
  );
  const handler = layer?.route?.stack?.at(-1)?.handle;
  if (!handler) {
    throw new Error(`Expected ${method.toUpperCase()} ${path} handler to be registered`);
  }
  return handler;
}

function createResponseCapture() {
  return {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
}

async function invokeRoute({
  actor = { type: "board", userId: "board-user", source: "local_implicit" },
  method,
  path,
  params = {},
  query = {},
  body = {},
}: {
  actor?: any;
  method: RouteMethod;
  path: string;
  params?: Record<string, unknown>;
  query?: Record<string, unknown>;
  body?: Record<string, unknown>;
}) {
  const handler = createRouteHandler(method, path);
  const req = {
    actor,
    method: method.toUpperCase(),
    originalUrl: path,
    params,
    query,
    body,
  };
  const res = createResponseCapture();

  try {
    await handler(req, res);
  } catch (error) {
    errorHandler(error, req as any, res as any, () => undefined);
  }

  return res;
}

beforeEach(() => {
  mockCompanyService.getById.mockReset();
  mockCompanyService.update.mockReset();
  mockAgentService.getById.mockReset();
  mockAgentService.update.mockReset();
  mockHeartbeatService.cancelBudgetScopeWork.mockReset().mockResolvedValue(undefined);
  mockLogActivity.mockReset();
  mockFetchAllQuotaWindows.mockReset();
  mockCostService.createEvent.mockReset();
  mockCostService.summary.mockReset().mockResolvedValue({ spendCents: 0 });
  mockCostService.byAgent.mockReset().mockResolvedValue([]);
  mockCostService.byAgentModel.mockReset().mockResolvedValue([]);
  mockCostService.byProvider.mockReset().mockResolvedValue([]);
  mockCostService.byBiller.mockReset().mockResolvedValue([]);
  mockCostService.windowSpend.mockReset().mockResolvedValue([]);
  mockCostService.byProject.mockReset().mockResolvedValue([]);
  mockFinanceService.createEvent.mockReset();
  mockFinanceService.summary
    .mockReset()
    .mockResolvedValue({ debitCents: 0, creditCents: 0, netCents: 0, estimatedDebitCents: 0, eventCount: 0 });
  mockFinanceService.byBiller.mockReset().mockResolvedValue([]);
  mockFinanceService.byKind.mockReset().mockResolvedValue([]);
  mockFinanceService.list.mockReset().mockResolvedValue([]);
  mockBudgetService.overview.mockReset().mockResolvedValue({
    companyId: "company-1",
    policies: [],
    activeIncidents: [],
    pausedAgentCount: 0,
    pausedProjectCount: 0,
    pendingApprovalCount: 0,
  });
  mockBudgetService.upsertPolicy.mockReset();
  mockBudgetService.resolveIncident.mockReset();
  mockCompanyService.update.mockResolvedValue({
    id: "company-1",
    name: "Paperclip",
    budgetMonthlyCents: 100,
    spentMonthlyCents: 0,
  });
  mockAgentService.update.mockResolvedValue({
    id: "agent-1",
    companyId: "company-1",
    name: "Budget Agent",
    budgetMonthlyCents: 100,
    spentMonthlyCents: 0,
  });
  mockBudgetService.upsertPolicy.mockResolvedValue(undefined);
});

describe("cost routes", () => {
  it("accepts valid ISO date strings and passes them to cost summary routes", async () => {
    const res = await invokeRoute({
      method: "get",
      path: "/companies/:companyId/costs/summary",
      params: { companyId: "company-1" },
      query: { from: "2026-01-01T00:00:00.000Z", to: "2026-01-31T23:59:59.999Z" },
    });
    expect(res.statusCode).toBe(200);
    expect(mockCostService.summary).toHaveBeenCalledWith("company-1", {
      from: new Date("2026-01-01T00:00:00.000Z"),
      to: new Date("2026-01-31T23:59:59.999Z"),
    });
  });

  it("returns 400 for an invalid 'from' date string", async () => {
    const res = await invokeRoute({
      method: "get",
      path: "/companies/:companyId/costs/summary",
      params: { companyId: "company-1" },
      query: { from: "not-a-date" },
    });
    expect(res.statusCode).toBe(400);
    expect((res.body as any).error).toMatch(/invalid 'from' date/i);
  });

  it("returns 400 for an invalid 'to' date string", async () => {
    const res = await invokeRoute({
      method: "get",
      path: "/companies/:companyId/costs/summary",
      params: { companyId: "company-1" },
      query: { to: "banana" },
    });
    expect(res.statusCode).toBe(400);
    expect((res.body as any).error).toMatch(/invalid 'to' date/i);
  });

  it("returns finance summary rows for valid requests", async () => {
    const res = await invokeRoute({
      method: "get",
      path: "/companies/:companyId/costs/finance-summary",
      params: { companyId: "company-1" },
      query: { from: "2026-02-01T00:00:00.000Z", to: "2026-02-28T23:59:59.999Z" },
    });
    expect(res.statusCode).toBe(200);
    expect(mockFinanceService.summary).toHaveBeenCalled();
  });

  it("returns 400 for invalid finance event list limits", async () => {
    const res = await invokeRoute({
      method: "get",
      path: "/companies/:companyId/costs/finance-events",
      params: { companyId: "company-1" },
      query: { limit: "0" },
    });
    expect(res.statusCode).toBe(400);
    expect((res.body as any).error).toMatch(/invalid 'limit'/i);
  });

  it("accepts valid finance event list limits", async () => {
    const res = await invokeRoute({
      method: "get",
      path: "/companies/:companyId/costs/finance-events",
      params: { companyId: "company-1" },
      query: { limit: "25" },
    });
    expect(res.statusCode).toBe(200);
    expect(mockFinanceService.list).toHaveBeenCalledWith("company-1", undefined, 25);
  });

  it("rejects company budget updates for board users outside the company", async () => {
    const res = await invokeRoute({
      actor: {
        type: "board",
        userId: "board-user",
        source: "session",
        isInstanceAdmin: false,
        companyIds: ["company-2"],
      },
      method: "patch",
      path: "/companies/:companyId/budgets",
      params: { companyId: "company-1" },
      body: { budgetMonthlyCents: 2500 },
    });

    expect(res.statusCode).toBe(403);
    expect(mockCompanyService.update).not.toHaveBeenCalled();
  });

  it("rejects agent budget updates for board users outside the agent company", async () => {
    mockAgentService.getById.mockResolvedValue({
      id: "agent-1",
      companyId: "company-1",
      name: "Budget Agent",
      budgetMonthlyCents: 100,
      spentMonthlyCents: 0,
    });
    const res = await invokeRoute({
      actor: {
        type: "board",
        userId: "board-user",
        source: "session",
        isInstanceAdmin: false,
        companyIds: ["company-2"],
      },
      method: "patch",
      path: "/agents/:agentId/budgets",
      params: { agentId: "agent-1" },
      body: { budgetMonthlyCents: 2500 },
    });

    expect(res.statusCode).toBe(403);
    expect(mockAgentService.update).not.toHaveBeenCalled();
  });
});
