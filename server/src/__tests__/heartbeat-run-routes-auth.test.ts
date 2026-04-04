import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const COMPANY_ID = "00000000-0000-0000-0000-000000000001";
const OTHER_COMPANY_ID = "00000000-0000-0000-0000-000000000002";
const RUN_ID = "00000000-0000-0000-0000-000000000010";
const AGENT_ID = "00000000-0000-0000-0000-000000000020";

const mockHeartbeatService = vi.hoisted(() => ({
  getRun: vi.fn(),
  readLog: vi.fn(),
  cancelRun: vi.fn(),
}));

const mockInstanceSettingsService = vi.hoisted(() => ({
  getGeneral: vi.fn(),
}));

const mockLogActivity = vi.hoisted(() => vi.fn());

vi.mock("../services/index.js", () => ({
  agentService: () => ({}),
  agentInstructionsService: () => ({}),
  accessService: () => ({}),
  approvalService: () => ({}),
  companySkillService: () => ({}),
  budgetService: () => ({}),
  heartbeatService: () => mockHeartbeatService,
  issueApprovalService: () => ({}),
  issueService: () => ({}),
  logActivity: mockLogActivity,
  secretService: () => ({}),
  syncInstructionsBundleConfigFromFilePath: vi.fn((_agent, config) => config),
  workspaceOperationService: () => ({}),
}));

vi.mock("../services/instance-settings.js", () => ({
  instanceSettingsService: () => mockInstanceSettingsService,
}));

vi.mock("../services/lease-manager.js", () => ({
  leaseManagerService: () => ({}),
}));

vi.mock("../adapters/index.js", () => ({
  findServerAdapter: vi.fn(),
  listAdapterModels: vi.fn(),
  detectAdapterModel: vi.fn(),
}));

async function createApp(actor: Record<string, unknown>) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = actor;
    next();
  });

  const [{ agentRoutes }, { errorHandler }] = await Promise.all([
    import("../routes/agents.js"),
    import("../middleware/index.js"),
  ]);

  app.use("/api", agentRoutes({} as any));
  app.use(errorHandler);
  return app;
}

describe("heartbeat run route company isolation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHeartbeatService.getRun.mockResolvedValue({
      id: RUN_ID,
      companyId: COMPANY_ID,
      agentId: AGENT_ID,
      status: "running",
      logStore: "local_file",
      logRef: "log-ref",
      contextSnapshot: {},
    });
    mockHeartbeatService.readLog.mockResolvedValue({
      offset: 0,
      nextOffset: 12,
      complete: true,
      content: "run output",
    });
    mockHeartbeatService.cancelRun.mockResolvedValue({
      id: RUN_ID,
      companyId: COMPANY_ID,
      agentId: AGENT_ID,
      status: "cancelled",
    });
    mockInstanceSettingsService.getGeneral.mockResolvedValue({
      censorUsernameInLogs: false,
    });
    mockLogActivity.mockResolvedValue(undefined);
  });

  it("allows same-company board access to run-log detail endpoints", async () => {
    const res = await request(
      await createApp({
        type: "board",
        userId: "board-user",
        companyIds: [COMPANY_ID],
        source: "session",
        isInstanceAdmin: false,
      }),
    ).get(`/api/heartbeat-runs/${RUN_ID}/log`);

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(mockHeartbeatService.getRun).toHaveBeenCalledWith(RUN_ID);
    expect(mockHeartbeatService.readLog).toHaveBeenCalledWith(RUN_ID, {
      offset: 0,
      limitBytes: 256000,
    });
    expect(res.body.content).toBe("run output");
  });

  it("rejects unauthenticated access to run-log detail endpoints", async () => {
    const res = await request(
      await createApp({
        type: "none",
        source: "none",
      }),
    ).get(`/api/heartbeat-runs/${RUN_ID}/log`);

    expect(res.status).toBe(401);
    expect(mockHeartbeatService.readLog).not.toHaveBeenCalled();
  });

  it("rejects wrong-company agent access to run-log detail endpoints", async () => {
    const res = await request(
      await createApp({
        type: "agent",
        agentId: AGENT_ID,
        companyId: OTHER_COMPANY_ID,
        source: "agent_key",
      }),
    ).get(`/api/heartbeat-runs/${RUN_ID}/log`);

    expect(res.status).toBe(403);
    expect(mockHeartbeatService.readLog).not.toHaveBeenCalled();
  });

  it("allows same-company board access to run cancellation", async () => {
    const res = await request(
      await createApp({
        type: "board",
        userId: "board-user",
        companyIds: [COMPANY_ID],
        source: "session",
        isInstanceAdmin: false,
      }),
    ).post(`/api/heartbeat-runs/${RUN_ID}/cancel`);

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(mockHeartbeatService.getRun).toHaveBeenCalledWith(RUN_ID);
    expect(mockHeartbeatService.cancelRun).toHaveBeenCalledWith(RUN_ID);
    expect(res.body.status).toBe("cancelled");
  });

  it("rejects agent access to board-scoped run cancellation", async () => {
    const res = await request(
      await createApp({
        type: "agent",
        agentId: AGENT_ID,
        companyId: COMPANY_ID,
        source: "agent_key",
      }),
    ).post(`/api/heartbeat-runs/${RUN_ID}/cancel`);

    expect(res.status).toBe(403);
    expect(mockHeartbeatService.getRun).not.toHaveBeenCalled();
    expect(mockHeartbeatService.cancelRun).not.toHaveBeenCalled();
  });

  it("rejects wrong-company board access before mutating a run", async () => {
    const res = await request(
      await createApp({
        type: "board",
        userId: "board-user",
        companyIds: [OTHER_COMPANY_ID],
        source: "session",
        isInstanceAdmin: false,
      }),
    ).post(`/api/heartbeat-runs/${RUN_ID}/cancel`);

    expect(res.status).toBe(403);
    expect(mockHeartbeatService.getRun).toHaveBeenCalledWith(RUN_ID);
    expect(mockHeartbeatService.cancelRun).not.toHaveBeenCalled();
  });
});
