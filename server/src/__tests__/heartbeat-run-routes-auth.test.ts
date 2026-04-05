import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const COMPANY_ID = "00000000-0000-0000-0000-000000000001";
const OTHER_COMPANY_ID = "00000000-0000-0000-0000-000000000002";
const RUN_ID = "00000000-0000-0000-0000-000000000010";
const AGENT_ID = "00000000-0000-0000-0000-000000000020";
const OPERATION_ID = "00000000-0000-0000-0000-000000000030";
const EXECUTION_WORKSPACE_ID = "00000000-0000-0000-0000-000000000040";

const mockHeartbeatService = {
  getRun: vi.fn(),
  readLog: vi.fn(),
  listEvents: vi.fn(),
  cancelRun: vi.fn(),
};

const mockInstanceSettingsService = {
  getGeneral: vi.fn(),
};

const mockWorkspaceOperationService = {
  listForRun: vi.fn(),
  getById: vi.fn(),
  readLog: vi.fn(),
};

const mockLogActivity = vi.fn();
const mockSyncInstructionsBundleConfigFromFilePath = vi.fn((_agent, config) => config);
const mockFindServerAdapter = vi.fn();
const mockListAdapterModels = vi.fn();
const mockDetectAdapterModel = vi.fn();
const mockLeaseManagerService = {};

async function createApp(actor: Record<string, unknown>) {
  vi.resetModules();
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
  app.use(
    "/api",
    agentRoutes({} as any, {
      heartbeatService: mockHeartbeatService as any,
      instanceSettingsService: mockInstanceSettingsService as any,
      logActivity: mockLogActivity,
      workspaceOperationService: mockWorkspaceOperationService as any,
      leaseManagerService: mockLeaseManagerService as any,
      syncInstructionsBundleConfigFromFilePath: mockSyncInstructionsBundleConfigFromFilePath,
      findServerAdapter: mockFindServerAdapter,
      listAdapterModels: mockListAdapterModels,
      detectAdapterModel: mockDetectAdapterModel,
    }),
  );
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
      contextSnapshot: { executionWorkspaceId: EXECUTION_WORKSPACE_ID },
    });
    mockHeartbeatService.readLog.mockResolvedValue({
      offset: 0,
      nextOffset: 12,
      complete: true,
      content: "run output",
    });
    mockHeartbeatService.listEvents.mockResolvedValue([
      {
        seq: 1,
        type: "run.started",
        payload: { detail: "started" },
        createdAt: "2026-04-05T00:00:00.000Z",
      },
    ]);
    mockHeartbeatService.cancelRun.mockResolvedValue({
      id: RUN_ID,
      companyId: COMPANY_ID,
      agentId: AGENT_ID,
      status: "cancelled",
    });
    mockWorkspaceOperationService.listForRun.mockResolvedValue([]);
    mockWorkspaceOperationService.getById.mockResolvedValue({
      id: OPERATION_ID,
      companyId: COMPANY_ID,
    });
    mockWorkspaceOperationService.readLog.mockResolvedValue({
      offset: 0,
      nextOffset: 15,
      complete: true,
      content: "workspace log",
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

  it("allows same-company agent access to run-log streaming endpoints", async () => {
    const res = await request(
      await createApp({
        type: "agent",
        agentId: AGENT_ID,
        companyId: COMPANY_ID,
        source: "agent_key",
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

  it("allows same-company board access to run detail endpoints", async () => {
    const res = await request(
      await createApp({
        type: "board",
        userId: "board-user",
        companyIds: [COMPANY_ID],
        source: "session",
        isInstanceAdmin: false,
      }),
    ).get(`/api/heartbeat-runs/${RUN_ID}`);

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(mockHeartbeatService.getRun).toHaveBeenCalledWith(RUN_ID);
    expect(res.body.id).toBe(RUN_ID);
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

  it("rejects unauthenticated access to run event detail endpoints", async () => {
    const res = await request(
      await createApp({
        type: "none",
        source: "none",
      }),
    ).get(`/api/heartbeat-runs/${RUN_ID}/events`);

    expect(res.status).toBe(401);
    expect(mockHeartbeatService.listEvents).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated access to run detail endpoints", async () => {
    const res = await request(
      await createApp({
        type: "none",
        source: "none",
      }),
    ).get(`/api/heartbeat-runs/${RUN_ID}`);

    expect(res.status).toBe(401);
    expect(mockHeartbeatService.getRun).not.toHaveBeenCalled();
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

  it("rejects wrong-company agent access to run event detail endpoints", async () => {
    const res = await request(
      await createApp({
        type: "agent",
        agentId: AGENT_ID,
        companyId: OTHER_COMPANY_ID,
        source: "agent_key",
      }),
    ).get(`/api/heartbeat-runs/${RUN_ID}/events`);

    expect(res.status).toBe(403);
    expect(mockHeartbeatService.listEvents).not.toHaveBeenCalled();
  });

  it("rejects same-company agent access to run detail endpoints", async () => {
    const res = await request(
      await createApp({
        type: "agent",
        agentId: AGENT_ID,
        companyId: COMPANY_ID,
        source: "agent_key",
      }),
    ).get(`/api/heartbeat-runs/${RUN_ID}`);

    expect(res.status).toBe(403);
    expect(mockHeartbeatService.getRun).not.toHaveBeenCalled();
  });

  it("allows same-company agent access to run event detail endpoints", async () => {
    const res = await request(
      await createApp({
        type: "agent",
        agentId: AGENT_ID,
        companyId: COMPANY_ID,
        source: "agent_key",
      }),
    ).get(`/api/heartbeat-runs/${RUN_ID}/events`);

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(mockHeartbeatService.getRun).toHaveBeenCalledWith(RUN_ID);
    expect(mockHeartbeatService.listEvents).toHaveBeenCalledWith(RUN_ID, 0, 200);
    expect(res.body).toEqual([
      {
        seq: 1,
        type: "run.started",
        payload: { detail: "started" },
        createdAt: "2026-04-05T00:00:00.000Z",
      },
    ]);
  });

  it("rejects same-company agent access to run workspace-operation fan-out", async () => {
    const res = await request(
      await createApp({
        type: "agent",
        agentId: AGENT_ID,
        companyId: COMPANY_ID,
        source: "agent_key",
      }),
    ).get(`/api/heartbeat-runs/${RUN_ID}/workspace-operations`);

    expect(res.status).toBe(403);
    expect(mockHeartbeatService.getRun).not.toHaveBeenCalled();
    expect(mockWorkspaceOperationService.listForRun).not.toHaveBeenCalled();
  });

  it("allows same-company board access to run workspace-operation fan-out", async () => {
    mockWorkspaceOperationService.listForRun.mockResolvedValue([
      {
        id: OPERATION_ID,
        companyId: COMPANY_ID,
        heartbeatRunId: RUN_ID,
        executionWorkspaceId: EXECUTION_WORKSPACE_ID,
      },
    ]);

    const res = await request(
      await createApp({
        type: "board",
        userId: "board-user",
        companyIds: [COMPANY_ID],
        source: "session",
        isInstanceAdmin: false,
      }),
    ).get(`/api/heartbeat-runs/${RUN_ID}/workspace-operations`);

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(mockHeartbeatService.getRun).toHaveBeenCalledWith(RUN_ID);
    expect(mockWorkspaceOperationService.listForRun).toHaveBeenCalledWith(
      RUN_ID,
      EXECUTION_WORKSPACE_ID,
    );
    expect(res.body).toEqual([
      {
        id: OPERATION_ID,
        companyId: COMPANY_ID,
        heartbeatRunId: RUN_ID,
        executionWorkspaceId: EXECUTION_WORKSPACE_ID,
      },
    ]);
  });

  it("rejects unauthenticated access to run workspace-operation fan-out", async () => {
    const res = await request(
      await createApp({
        type: "none",
        source: "none",
      }),
    ).get(`/api/heartbeat-runs/${RUN_ID}/workspace-operations`);

    expect(res.status).toBe(401);
    expect(mockHeartbeatService.getRun).not.toHaveBeenCalled();
    expect(mockWorkspaceOperationService.listForRun).not.toHaveBeenCalled();
  });

  it("rejects wrong-company board access to run workspace-operation fan-out", async () => {
    const res = await request(
      await createApp({
        type: "board",
        userId: "board-user",
        companyIds: [OTHER_COMPANY_ID],
        source: "session",
        isInstanceAdmin: false,
      }),
    ).get(`/api/heartbeat-runs/${RUN_ID}/workspace-operations`);

    expect(res.status).toBe(403);
    expect(mockHeartbeatService.getRun).toHaveBeenCalledWith(RUN_ID);
    expect(mockWorkspaceOperationService.listForRun).not.toHaveBeenCalled();
  });

  it("allows same-company board access to workspace-operation log endpoints", async () => {
    const res = await request(
      await createApp({
        type: "board",
        userId: "board-user",
        companyIds: [COMPANY_ID],
        source: "session",
        isInstanceAdmin: false,
      }),
    ).get(`/api/workspace-operations/${OPERATION_ID}/log`);

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(mockWorkspaceOperationService.getById).toHaveBeenCalledWith(OPERATION_ID);
    expect(mockWorkspaceOperationService.readLog).toHaveBeenCalledWith(OPERATION_ID, {
      offset: 0,
      limitBytes: 256000,
    });
    expect(res.body.content).toBe("workspace log");
  });

  it("rejects unauthenticated access to workspace-operation log endpoints", async () => {
    const res = await request(
      await createApp({
        type: "none",
        source: "none",
      }),
    ).get(`/api/workspace-operations/${OPERATION_ID}/log`);

    expect(res.status).toBe(401);
    expect(mockWorkspaceOperationService.getById).not.toHaveBeenCalled();
    expect(mockWorkspaceOperationService.readLog).not.toHaveBeenCalled();
  });

  it("rejects same-company agent access to workspace-operation log endpoints", async () => {
    const res = await request(
      await createApp({
        type: "agent",
        agentId: AGENT_ID,
        companyId: COMPANY_ID,
        source: "agent_key",
      }),
    ).get(`/api/workspace-operations/${OPERATION_ID}/log`);

    expect(res.status).toBe(403);
    expect(mockWorkspaceOperationService.getById).not.toHaveBeenCalled();
    expect(mockWorkspaceOperationService.readLog).not.toHaveBeenCalled();
  });

  it("rejects wrong-company board access to workspace-operation log endpoints", async () => {
    const res = await request(
      await createApp({
        type: "board",
        userId: "board-user",
        companyIds: [OTHER_COMPANY_ID],
        source: "session",
        isInstanceAdmin: false,
      }),
    ).get(`/api/workspace-operations/${OPERATION_ID}/log`);

    expect(res.status).toBe(403);
    expect(mockWorkspaceOperationService.getById).toHaveBeenCalledWith(OPERATION_ID);
    expect(mockWorkspaceOperationService.readLog).not.toHaveBeenCalled();
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
