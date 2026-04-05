import type { RequestHandler } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "../middleware/index.js";
import { issueRoutes } from "../routes/issues.js";

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

function getRouteHandlers(
  method: "get" | "post",
  path: "/issues/:id/documents/:key/revisions" | "/issues/:id/documents/:key/revisions/:revisionId/restore",
) {
  const router = issueRoutes({} as any, {} as any, {
    accessService: mockAccessService as any,
    agentService: mockAgentService as any,
    documentService: mockDocumentsService as any,
    executionWorkspaceService: {} as any,
    goalService: {} as any,
    heartbeatService: mockHeartbeatService as any,
    issueApprovalService: {} as any,
    issueService: mockIssueService as any,
    logActivity: mockLogActivity,
    projectService: {} as any,
    routineService: {
      syncRunStatusForIssue: vi.fn(async () => undefined),
    } as any,
    workProductService: {} as any,
    intentQueueService: {
      createIntent: vi.fn(async () => ({})),
      invalidateForClosedIssue: vi.fn(async () => 0),
    } as any,
    leaseManagerService: {
      renewLeaseForIssueActivity: vi.fn(async () => undefined),
    } as any,
    eventLogService: {
      emit: mockEventLogEmit,
    } as any,
    projectionService: {
      invalidateOnDone: vi.fn(async () => ({ rejectedIntents: 0, releasedLeases: 0 })),
      getIssueProjection: vi.fn(async () => null),
      projectIssuesList: vi.fn(async (rows: unknown[]) => rows),
    } as any,
    dependencyService: {
      listForIssue: vi.fn(async () => []),
      create: vi.fn(),
      remove: vi.fn(),
    } as any,
    queueIssueAssignmentIntent: vi.fn(async () => undefined),
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
  method: "get" | "post";
  path: "/issues/:id/documents/:key/revisions" | "/issues/:id/documents/:key/revisions/:revisionId/restore";
  params: Record<string, string>;
  body?: unknown;
  actor?: Record<string, unknown>;
}) {
  const req = {
    actor: {
      type: "board",
      userId: "board-user",
      companyIds: [companyId],
      source: "local_implicit",
      isInstanceAdmin: false,
      ...(options.actor ?? {}),
    },
    body: options.body ?? {},
    query: {},
    params: options.params,
    method: options.method.toUpperCase(),
    originalUrl: `/api${options.path}`,
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
    await runHandlers(getRouteHandlers(options.method, options.path), req, res);
  } catch (error) {
    errorHandler(error, req, res, (() => undefined) as any);
  }

  return { status: statusCode, body };
}

describe("issue document revision routes", () => {
  beforeEach(() => {
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
    const res = await callRoute({
      method: "get",
      path: "/issues/:id/documents/:key/revisions",
      params: {
        id: issueId,
        key: "plan",
      },
    });

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
    const res = await callRoute({
      method: "post",
      path: "/issues/:id/documents/:key/revisions/:revisionId/restore",
      params: {
        id: issueId,
        key: "plan",
        revisionId: "revision-1",
      },
      body: {},
    });

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
    expect(res.body).toEqual(
      expect.objectContaining({
        key: "plan",
        title: "Plan v1",
        latestRevisionNumber: 3,
      }),
    );
  });

  it("rejects invalid document keys before attempting restore", async () => {
    const res = await callRoute({
      method: "post",
      path: "/issues/:id/documents/:key/revisions/:revisionId/restore",
      params: {
        id: issueId,
        key: "INVALID KEY",
        revisionId: "revision-1",
      },
      body: {},
    });

    expect(res.status).toBe(400);
    expect(mockDocumentsService.restoreIssueDocumentRevision).not.toHaveBeenCalled();
  });
});
