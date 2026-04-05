import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { agentRoutes } from "../routes/agents.js";
import { errorHandler } from "../middleware/index.js";

const COMPANY_ID = "00000000-0000-0000-0000-000000000001";
const OTHER_COMPANY_ID = "00000000-0000-0000-0000-000000000002";
const RUN_ID = "00000000-0000-0000-0000-000000000010";
const AGENT_ID = "00000000-0000-0000-0000-000000000020";
const OPERATION_ID = "00000000-0000-0000-0000-000000000030";
const EXECUTION_WORKSPACE_ID = "00000000-0000-0000-0000-000000000040";

function cloneActor(actor: Record<string, unknown>) {
  return {
    ...actor,
    companyIds: Array.isArray(actor.companyIds) ? [...actor.companyIds] : actor.companyIds,
  };
}

function createHarness(actor: Record<string, unknown>) {
  const heartbeatService = {
    getRun: vi.fn().mockResolvedValue({
      id: RUN_ID,
      companyId: COMPANY_ID,
      agentId: AGENT_ID,
      status: "running",
      logStore: "local_file",
      logRef: "log-ref",
      contextSnapshot: { executionWorkspaceId: EXECUTION_WORKSPACE_ID },
    }),
    readLog: vi.fn().mockResolvedValue({
      offset: 0,
      nextOffset: 12,
      complete: true,
      content: "run output",
    }),
    listEvents: vi.fn().mockResolvedValue([
      {
        seq: 1,
        type: "run.started",
        payload: { detail: "started" },
        createdAt: "2026-04-05T00:00:00.000Z",
      },
    ]),
    cancelRun: vi.fn().mockResolvedValue({
      id: RUN_ID,
      companyId: COMPANY_ID,
      agentId: AGENT_ID,
      status: "cancelled",
    }),
  };

  const instanceSettingsService = {
    getGeneral: vi.fn().mockResolvedValue({
      censorUsernameInLogs: false,
    }),
  };

  const workspaceOperationService = {
    listForRun: vi.fn().mockResolvedValue([]),
    getById: vi.fn().mockResolvedValue({
      id: OPERATION_ID,
      companyId: COMPANY_ID,
    }),
    readLog: vi.fn().mockResolvedValue({
      offset: 0,
      nextOffset: 15,
      complete: true,
      content: "workspace log",
    }),
  };

  const logActivity = vi.fn().mockResolvedValue(undefined);
  const syncInstructionsBundleConfigFromFilePath = vi.fn((_agent, config) => config);
  const findServerAdapter = vi.fn();
  const listAdapterModels = vi.fn();
  const detectAdapterModel = vi.fn();
  const leaseManagerService = {};

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = cloneActor(actor);
    next();
  });
  app.use(
    "/api",
    agentRoutes({} as any, {
      heartbeatService: heartbeatService as any,
      instanceSettingsService: instanceSettingsService as any,
      logActivity,
      workspaceOperationService: workspaceOperationService as any,
      leaseManagerService: leaseManagerService as any,
      syncInstructionsBundleConfigFromFilePath,
      findServerAdapter,
      listAdapterModels,
      detectAdapterModel,
    }),
  );
  app.use(errorHandler);

  return {
    app,
    heartbeatService,
    workspaceOperationService,
  };
}

describe("heartbeat run route company isolation", () => {

  it("allows same-company board access to run-log detail endpoints", async () => {
    const harness = createHarness({
      type: "board",
      userId: "board-user",
      companyIds: [COMPANY_ID],
      source: "session",
      isInstanceAdmin: false,
    });
    const res = await request(
      harness.app,
    ).get(`/api/heartbeat-runs/${RUN_ID}/log`);

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(harness.heartbeatService.getRun).toHaveBeenCalledWith(RUN_ID);
    expect(harness.heartbeatService.readLog).toHaveBeenCalledWith(RUN_ID, {
      offset: 0,
      limitBytes: 256000,
    });
    expect(res.body.content).toBe("run output");
  });

  it("allows same-company agent access to run-log streaming endpoints", async () => {
    const harness = createHarness({
      type: "agent",
      agentId: AGENT_ID,
      companyId: COMPANY_ID,
      source: "agent_key",
    });
    const res = await request(
      harness.app,
    ).get(`/api/heartbeat-runs/${RUN_ID}/log`);

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(harness.heartbeatService.getRun).toHaveBeenCalledWith(RUN_ID);
    expect(harness.heartbeatService.readLog).toHaveBeenCalledWith(RUN_ID, {
      offset: 0,
      limitBytes: 256000,
    });
    expect(res.body.content).toBe("run output");
  });

  it("allows same-company board access to run detail endpoints", async () => {
    const harness = createHarness({
      type: "board",
      userId: "board-user",
      companyIds: [COMPANY_ID],
      source: "session",
      isInstanceAdmin: false,
    });
    const res = await request(
      harness.app,
    ).get(`/api/heartbeat-runs/${RUN_ID}`);

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(harness.heartbeatService.getRun).toHaveBeenCalledWith(RUN_ID);
    expect(res.body.id).toBe(RUN_ID);
  });

  it("rejects unauthenticated access to run-log detail endpoints", async () => {
    const harness = createHarness({ type: "none", source: "none" });
    const res = await request(harness.app).get(`/api/heartbeat-runs/${RUN_ID}/log`);

    expect(res.status).toBe(401);
    expect(harness.heartbeatService.readLog).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated access to run event detail endpoints", async () => {
    const harness = createHarness({ type: "none", source: "none" });
    const res = await request(harness.app).get(`/api/heartbeat-runs/${RUN_ID}/events`);

    expect(res.status).toBe(401);
    expect(harness.heartbeatService.listEvents).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated access to run detail endpoints", async () => {
    const harness = createHarness({ type: "none", source: "none" });
    const res = await request(harness.app).get(`/api/heartbeat-runs/${RUN_ID}`);

    expect(res.status).toBe(401);
    expect(harness.heartbeatService.getRun).not.toHaveBeenCalled();
  });

  it("rejects wrong-company agent access to run-log detail endpoints", async () => {
    const harness = createHarness({
      type: "agent",
      agentId: AGENT_ID,
      companyId: OTHER_COMPANY_ID,
      source: "agent_key",
    });
    const res = await request(harness.app).get(`/api/heartbeat-runs/${RUN_ID}/log`);

    expect(res.status).toBe(403);
    expect(harness.heartbeatService.readLog).not.toHaveBeenCalled();
  });

  it("rejects wrong-company agent access to run event detail endpoints", async () => {
    const harness = createHarness({
      type: "agent",
      agentId: AGENT_ID,
      companyId: OTHER_COMPANY_ID,
      source: "agent_key",
    });
    const res = await request(harness.app).get(`/api/heartbeat-runs/${RUN_ID}/events`);

    expect(res.status).toBe(403);
    expect(harness.heartbeatService.listEvents).not.toHaveBeenCalled();
  });

  it("rejects same-company agent access to run detail endpoints", async () => {
    const harness = createHarness({
      type: "agent",
      agentId: AGENT_ID,
      companyId: COMPANY_ID,
      source: "agent_key",
    });
    const res = await request(harness.app).get(`/api/heartbeat-runs/${RUN_ID}`);

    expect(res.status).toBe(403);
    expect(harness.heartbeatService.getRun).not.toHaveBeenCalled();
  });

  it("allows same-company agent access to run event detail endpoints", async () => {
    const harness = createHarness({
      type: "agent",
      agentId: AGENT_ID,
      companyId: COMPANY_ID,
      source: "agent_key",
    });
    const res = await request(
      harness.app,
    ).get(`/api/heartbeat-runs/${RUN_ID}/events`);

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(harness.heartbeatService.getRun).toHaveBeenCalledWith(RUN_ID);
    expect(harness.heartbeatService.listEvents).toHaveBeenCalledWith(RUN_ID, 0, 200);
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
    const harness = createHarness({
      type: "agent",
      agentId: AGENT_ID,
      companyId: COMPANY_ID,
      source: "agent_key",
    });
    const res = await request(harness.app).get(`/api/heartbeat-runs/${RUN_ID}/workspace-operations`);

    expect(res.status).toBe(403);
    expect(harness.heartbeatService.getRun).not.toHaveBeenCalled();
    expect(harness.workspaceOperationService.listForRun).not.toHaveBeenCalled();
  });

  it("allows same-company board access to run workspace-operation fan-out", async () => {
    const harness = createHarness({
      type: "board",
      userId: "board-user",
      companyIds: [COMPANY_ID],
      source: "session",
      isInstanceAdmin: false,
    });
    harness.workspaceOperationService.listForRun.mockResolvedValue([
      {
        id: OPERATION_ID,
        companyId: COMPANY_ID,
        heartbeatRunId: RUN_ID,
        executionWorkspaceId: EXECUTION_WORKSPACE_ID,
      },
    ]);

    const res = await request(
      harness.app,
    ).get(`/api/heartbeat-runs/${RUN_ID}/workspace-operations`);

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(harness.heartbeatService.getRun).toHaveBeenCalledWith(RUN_ID);
    expect(harness.workspaceOperationService.listForRun).toHaveBeenCalledWith(
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
    const harness = createHarness({ type: "none", source: "none" });
    const res = await request(harness.app).get(`/api/heartbeat-runs/${RUN_ID}/workspace-operations`);

    expect(res.status).toBe(401);
    expect(harness.heartbeatService.getRun).not.toHaveBeenCalled();
    expect(harness.workspaceOperationService.listForRun).not.toHaveBeenCalled();
  });

  it("rejects wrong-company board access to run workspace-operation fan-out", async () => {
    const harness = createHarness({
      type: "board",
      userId: "board-user",
      companyIds: [OTHER_COMPANY_ID],
      source: "session",
      isInstanceAdmin: false,
    });
    const res = await request(harness.app).get(`/api/heartbeat-runs/${RUN_ID}/workspace-operations`);

    expect(res.status).toBe(403);
    expect(harness.heartbeatService.getRun).toHaveBeenCalledWith(RUN_ID);
    expect(harness.workspaceOperationService.listForRun).not.toHaveBeenCalled();
  });

  it("allows same-company board access to workspace-operation log endpoints", async () => {
    const harness = createHarness({
      type: "board",
      userId: "board-user",
      companyIds: [COMPANY_ID],
      source: "session",
      isInstanceAdmin: false,
    });
    const res = await request(
      harness.app,
    ).get(`/api/workspace-operations/${OPERATION_ID}/log`);

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(harness.workspaceOperationService.getById).toHaveBeenCalledWith(OPERATION_ID);
    expect(harness.workspaceOperationService.readLog).toHaveBeenCalledWith(OPERATION_ID, {
      offset: 0,
      limitBytes: 256000,
    });
    expect(res.body.content).toBe("workspace log");
  });

  it("rejects unauthenticated access to workspace-operation log endpoints", async () => {
    const harness = createHarness({ type: "none", source: "none" });
    const res = await request(harness.app).get(`/api/workspace-operations/${OPERATION_ID}/log`);

    expect(res.status).toBe(401);
    expect(harness.workspaceOperationService.getById).not.toHaveBeenCalled();
    expect(harness.workspaceOperationService.readLog).not.toHaveBeenCalled();
  });

  it("rejects same-company agent access to workspace-operation log endpoints", async () => {
    const harness = createHarness({
      type: "agent",
      agentId: AGENT_ID,
      companyId: COMPANY_ID,
      source: "agent_key",
    });
    const res = await request(harness.app).get(`/api/workspace-operations/${OPERATION_ID}/log`);

    expect(res.status).toBe(403);
    expect(harness.workspaceOperationService.getById).not.toHaveBeenCalled();
    expect(harness.workspaceOperationService.readLog).not.toHaveBeenCalled();
  });

  it("rejects wrong-company board access to workspace-operation log endpoints", async () => {
    const harness = createHarness({
      type: "board",
      userId: "board-user",
      companyIds: [OTHER_COMPANY_ID],
      source: "session",
      isInstanceAdmin: false,
    });
    const res = await request(harness.app).get(`/api/workspace-operations/${OPERATION_ID}/log`);

    expect(res.status).toBe(403);
    expect(harness.workspaceOperationService.getById).toHaveBeenCalledWith(OPERATION_ID);
    expect(harness.workspaceOperationService.readLog).not.toHaveBeenCalled();
  });

  it("allows same-company board access to run cancellation", async () => {
    const harness = createHarness({
      type: "board",
      userId: "board-user",
      companyIds: [COMPANY_ID],
      source: "session",
      isInstanceAdmin: false,
    });
    const res = await request(
      harness.app,
    ).post(`/api/heartbeat-runs/${RUN_ID}/cancel`);

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(harness.heartbeatService.getRun).toHaveBeenCalledWith(RUN_ID);
    expect(harness.heartbeatService.cancelRun).toHaveBeenCalledWith(RUN_ID);
    expect(res.body.status).toBe("cancelled");
  });

  it("rejects agent access to board-scoped run cancellation", async () => {
    const harness = createHarness({
      type: "agent",
      agentId: AGENT_ID,
      companyId: COMPANY_ID,
      source: "agent_key",
    });
    const res = await request(harness.app).post(`/api/heartbeat-runs/${RUN_ID}/cancel`);

    expect(res.status).toBe(403);
    expect(harness.heartbeatService.getRun).not.toHaveBeenCalled();
    expect(harness.heartbeatService.cancelRun).not.toHaveBeenCalled();
  });

  it("rejects wrong-company board access before mutating a run", async () => {
    const harness = createHarness({
      type: "board",
      userId: "board-user",
      companyIds: [OTHER_COMPANY_ID],
      source: "session",
      isInstanceAdmin: false,
    });
    const res = await request(harness.app).post(`/api/heartbeat-runs/${RUN_ID}/cancel`);

    expect(res.status).toBe(403);
    expect(harness.heartbeatService.getRun).toHaveBeenCalledWith(RUN_ID);
    expect(harness.heartbeatService.cancelRun).not.toHaveBeenCalled();
  });
});
