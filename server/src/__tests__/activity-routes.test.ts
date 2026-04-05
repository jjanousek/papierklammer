import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockActivityService = vi.hoisted(() => ({
  list: vi.fn(),
  forIssue: vi.fn(),
  runsForIssue: vi.fn(),
  issuesForRun: vi.fn(),
  create: vi.fn(),
}));

const mockHeartbeatService = vi.hoisted(() => ({
  getRun: vi.fn(),
}));

const mockIssueService = vi.hoisted(() => ({
  getById: vi.fn(),
  getByIdentifier: vi.fn(),
}));

vi.mock("../services/activity.js", () => ({
  activityService: () => mockActivityService,
}));

vi.mock("../services/index.js", () => ({
  heartbeatService: () => mockHeartbeatService,
  issueService: () => mockIssueService,
}));

async function createApp(actor?: Record<string, unknown>) {
  const [{ activityRoutes }, { errorHandler }] = await Promise.all([
    import("../routes/activity.js"),
    import("../middleware/index.js"),
  ]);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = {
      type: "board",
      userId: "user-1",
      companyIds: ["company-1"],
      source: "session",
      isInstanceAdmin: false,
      ...(actor ?? {}),
    };
    next();
  });
  app.use("/api", activityRoutes({} as any));
  app.use(errorHandler);
  return app;
}

describe("activity routes", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("resolves issue identifiers before loading runs", async () => {
    mockIssueService.getByIdentifier.mockResolvedValue({
      id: "issue-uuid-1",
      companyId: "company-1",
    });
    mockActivityService.runsForIssue.mockResolvedValue([
      {
        runId: "run-1",
      },
    ]);

    const res = await request(await createApp()).get("/api/issues/PAP-475/runs");

    expect(res.status).toBe(200);
    expect(mockIssueService.getByIdentifier).toHaveBeenCalledWith("PAP-475");
    expect(mockIssueService.getById).not.toHaveBeenCalled();
    expect(mockActivityService.runsForIssue).toHaveBeenCalledWith("company-1", "issue-uuid-1");
    expect(res.body).toEqual([{ runId: "run-1" }]);
  });

  it("rejects same-company agent access to issue run fan-out", async () => {
    const res = await request(
      await createApp({
        type: "agent",
        agentId: "agent-1",
        companyId: "company-1",
        source: "agent_key",
      }),
    ).get("/api/issues/PAP-475/runs");

    expect(res.status).toBe(403);
    expect(mockIssueService.getByIdentifier).not.toHaveBeenCalled();
    expect(mockActivityService.runsForIssue).not.toHaveBeenCalled();
  });

  it("enforces company access on heartbeat-run issue fan-out", async () => {
    mockHeartbeatService.getRun.mockResolvedValue({
      id: "run-1",
      companyId: "company-1",
    });
    mockActivityService.issuesForRun.mockResolvedValue([
      { issueId: "issue-1", title: "Investigate" },
    ]);

    const res = await request(await createApp()).get("/api/heartbeat-runs/run-1/issues");

    expect(res.status).toBe(200);
    expect(mockHeartbeatService.getRun).toHaveBeenCalledWith("run-1");
    expect(mockActivityService.issuesForRun).toHaveBeenCalledWith("run-1");
    expect(res.body).toEqual([{ issueId: "issue-1", title: "Investigate" }]);
  });

  it("rejects unauthenticated heartbeat-run issue fan-out requests", async () => {
    mockHeartbeatService.getRun.mockResolvedValue({
      id: "run-1",
      companyId: "company-1",
    });

    const res = await request(
      await createApp({
        type: "none",
        source: "none",
      }),
    ).get("/api/heartbeat-runs/run-1/issues");

    expect(res.status).toBe(401);
    expect(mockActivityService.issuesForRun).not.toHaveBeenCalled();
  });

  it("rejects wrong-company agent access to heartbeat-run issue fan-out", async () => {
    mockHeartbeatService.getRun.mockResolvedValue({
      id: "run-1",
      companyId: "company-1",
    });

    const res = await request(
      await createApp({
        type: "agent",
        agentId: "agent-1",
        companyId: "company-2",
        source: "agent_key",
      }),
    ).get("/api/heartbeat-runs/run-1/issues");

    expect(res.status).toBe(403);
    expect(mockActivityService.issuesForRun).not.toHaveBeenCalled();
  });

  it("rejects same-company agent access to heartbeat-run issue fan-out", async () => {
    const res = await request(
      await createApp({
        type: "agent",
        agentId: "agent-1",
        companyId: "company-1",
        source: "agent_key",
      }),
    ).get("/api/heartbeat-runs/run-1/issues");

    expect(res.status).toBe(403);
    expect(mockHeartbeatService.getRun).not.toHaveBeenCalled();
    expect(mockActivityService.issuesForRun).not.toHaveBeenCalled();
  });
});
