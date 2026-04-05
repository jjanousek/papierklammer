import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const issueId = "11111111-1111-4111-8111-111111111111";
const companyId = "22222222-2222-4222-8222-222222222222";

const mockIssueService = vi.hoisted(() => ({
  getById: vi.fn(),
}));

const mockDocumentsService = vi.hoisted(() => ({
  listIssueDocumentRevisions: vi.fn(),
  restoreIssueDocumentRevision: vi.fn(),
}));

const mockAccessService = vi.hoisted(() => ({
  canUser: vi.fn(),
  hasPermission: vi.fn(),
}));

const mockHeartbeatService = vi.hoisted(() => ({
  wakeup: vi.fn(async () => undefined),
  reportRunActivity: vi.fn(async () => undefined),
  getRun: vi.fn(async () => null),
  getActiveRunForAgent: vi.fn(async () => null),
  cancelRun: vi.fn(async () => null),
}));

const mockAgentService = vi.hoisted(() => ({
  getById: vi.fn(),
}));

const mockLogActivity = vi.hoisted(() => vi.fn(async () => undefined));
const mockEventLogEmit = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("../services/event-log.js", () => ({
  eventLogService: () => ({ emit: mockEventLogEmit }),
}));

vi.mock("../services/intent-queue.js", () => ({
  intentQueueService: () => ({
    createIntent: vi.fn(async () => ({})),
    invalidateForClosedIssue: vi.fn(async () => 0),
  }),
}));

vi.mock("../services/lease-manager.js", () => ({
  leaseManagerService: () => ({
    renewLeaseForIssueActivity: vi.fn(async () => undefined),
  }),
}));

vi.mock("../services/projections.js", () => ({
  projectionService: () => ({
    invalidateOnDone: vi.fn(async () => ({ rejectedIntents: 0, releasedLeases: 0 })),
    getIssueProjection: vi.fn(async () => null),
    projectIssuesList: vi.fn(async (rows: unknown[]) => rows),
  }),
}));

vi.mock("../services/issue-assignment-wakeup.js", () => ({
  queueIssueAssignmentIntent: vi.fn(async () => undefined),
}));

vi.mock("../services/dependency.js", () => ({
  dependencyService: () => ({
    listForIssue: vi.fn(async () => []),
    create: vi.fn(),
    remove: vi.fn(),
  }),
}));

vi.mock("../services/index.js", () => ({
  accessService: () => mockAccessService,
  agentService: () => mockAgentService,
  documentService: () => mockDocumentsService,
  executionWorkspaceService: () => ({}),
  goalService: () => ({}),
  heartbeatService: () => mockHeartbeatService,
  issueApprovalService: () => ({}),
  issueService: () => mockIssueService,
  logActivity: mockLogActivity,
  projectService: () => ({}),
  routineService: () => ({
    syncRunStatusForIssue: vi.fn(async () => undefined),
  }),
  workProductService: () => ({}),
}));

async function createApp() {
  const [{ issueRoutes }, { errorHandler }] = await Promise.all([
    import("../routes/issues.js"),
    import("../middleware/index.js"),
  ]);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = {
      type: "board",
      userId: "board-user",
      companyIds: [companyId],
      source: "local_implicit",
      isInstanceAdmin: false,
    };
    next();
  });
  app.use("/api", issueRoutes({} as any, {} as any));
  app.use(errorHandler);
  return app;
}

describe("issue document revision routes", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockHeartbeatService.wakeup.mockReset().mockResolvedValue(undefined);
    mockHeartbeatService.reportRunActivity.mockReset().mockResolvedValue(undefined);
    mockHeartbeatService.getRun.mockReset().mockResolvedValue(null);
    mockHeartbeatService.getActiveRunForAgent.mockReset().mockResolvedValue(null);
    mockHeartbeatService.cancelRun.mockReset().mockResolvedValue(null);
    mockEventLogEmit.mockReset().mockResolvedValue(undefined);
    mockIssueService.getById.mockResolvedValue({
      id: issueId,
      companyId,
      identifier: "PAP-881",
      title: "Document revisions",
      status: "in_progress",
    });
    mockDocumentsService.listIssueDocumentRevisions.mockResolvedValue([
      {
        id: "revision-2",
        companyId,
        documentId: "document-1",
        issueId,
        key: "plan",
        revisionNumber: 2,
        title: "Plan v2",
        format: "markdown",
        body: "# Two",
        changeSummary: null,
        createdByAgentId: null,
        createdByUserId: "board-user",
        createdAt: new Date("2026-03-26T12:00:00.000Z"),
      },
    ]);
    mockDocumentsService.restoreIssueDocumentRevision.mockResolvedValue({
      restoredFromRevisionId: "revision-1",
      restoredFromRevisionNumber: 1,
      document: {
        id: "document-1",
        companyId,
        issueId,
        key: "plan",
        title: "Plan v1",
        format: "markdown",
        body: "# One",
        latestRevisionId: "revision-3",
        latestRevisionNumber: 3,
        createdByAgentId: null,
        createdByUserId: "board-user",
        updatedByAgentId: null,
        updatedByUserId: "board-user",
        createdAt: new Date("2026-03-26T12:00:00.000Z"),
        updatedAt: new Date("2026-03-26T12:10:00.000Z"),
      },
    });
  });

  it("returns revision snapshots including title and format", async () => {
    const res = await request(await createApp()).get(`/api/issues/${issueId}/documents/plan/revisions`);

    expect(res.status).toBe(200);
    expect(mockDocumentsService.listIssueDocumentRevisions).toHaveBeenCalledWith(issueId, "plan");
    expect(res.body).toEqual([
      expect.objectContaining({
        revisionNumber: 2,
        title: "Plan v2",
        format: "markdown",
        body: "# Two",
      }),
    ]);
  });

  it("restores a revision through the append-only route and logs the action", async () => {
    const res = await request(await createApp())
      .post(`/api/issues/${issueId}/documents/plan/revisions/revision-1/restore`)
      .send({});

    expect(res.status).toBe(200);
    expect(mockDocumentsService.restoreIssueDocumentRevision).toHaveBeenCalledWith({
      issueId,
      key: "plan",
      revisionId: "revision-1",
      createdByAgentId: null,
      createdByUserId: "board-user",
    });
    expect(mockLogActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "issue.document_restored",
        details: expect.objectContaining({
          key: "plan",
          restoredFromRevisionId: "revision-1",
          restoredFromRevisionNumber: 1,
          revisionNumber: 3,
        }),
      }),
    );
    expect(res.body).toEqual(expect.objectContaining({
      key: "plan",
      title: "Plan v1",
      latestRevisionNumber: 3,
    }));
  });

  it("rejects invalid document keys before attempting restore", async () => {
    const res = await request(await createApp())
      .post(`/api/issues/${issueId}/documents/INVALID KEY/revisions/revision-1/restore`)
      .send({});

    expect(res.status).toBe(400);
    expect(mockDocumentsService.restoreIssueDocumentRevision).not.toHaveBeenCalled();
  });
});
