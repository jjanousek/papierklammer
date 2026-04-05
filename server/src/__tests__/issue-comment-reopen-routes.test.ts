import { beforeEach, describe, expect, it, vi } from "vitest";

const mockIssueService = vi.hoisted(() => ({
  getById: vi.fn(),
  update: vi.fn(),
  addComment: vi.fn(),
  findMentionedAgents: vi.fn(),
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

const mockEventLogEmit = vi.hoisted(() => vi.fn(async () => undefined));

const mockAgentService = vi.hoisted(() => ({
  getById: vi.fn(),
}));

const mockLogActivity = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("../services/index.js", () => ({
  accessService: () => mockAccessService,
  agentService: () => mockAgentService,
  documentService: () => ({}),
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

type RouteMethod = "patch" | "post";

async function createRouteHandler(method: RouteMethod, path: string) {
  const [{ issueRoutes }] = await Promise.all([
    import("../routes/issues.js"),
    import("../middleware/index.js"),
  ]);
  const router = issueRoutes({} as any, {} as any) as unknown as {
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
  method,
  path,
  params = {},
  body = {},
}: {
  method: RouteMethod;
  path: string;
  params?: Record<string, unknown>;
  body?: Record<string, unknown>;
}) {
  const [{ errorHandler }] = await Promise.all([
    import("../routes/issues.js"),
    import("../middleware/index.js"),
  ]);
  const handler = await createRouteHandler(method, path);
  const req = {
    actor: {
      type: "board",
      userId: "local-board",
      companyIds: ["company-1"],
      source: "local_implicit",
      isInstanceAdmin: false,
    },
    method: method.toUpperCase(),
    originalUrl: path,
    params,
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

function makeIssue(status: "todo" | "done") {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    companyId: "company-1",
    status,
    assigneeAgentId: "22222222-2222-4222-8222-222222222222",
    assigneeUserId: null,
    createdByUserId: "local-board",
    identifier: "PAP-580",
    title: "Comment reopen default",
  };
}

describe("issue comment reopen routes", () => {
  beforeEach(() => {
    mockIssueService.getById.mockReset();
    mockIssueService.update.mockReset();
    mockIssueService.addComment.mockReset();
    mockIssueService.findMentionedAgents.mockReset();
    mockAccessService.canUser.mockReset();
    mockAccessService.hasPermission.mockReset();
    mockHeartbeatService.wakeup.mockReset().mockResolvedValue(undefined);
    mockHeartbeatService.reportRunActivity.mockReset().mockResolvedValue(undefined);
    mockHeartbeatService.getRun.mockReset().mockResolvedValue(null);
    mockHeartbeatService.getActiveRunForAgent.mockReset().mockResolvedValue(null);
    mockHeartbeatService.cancelRun.mockReset().mockResolvedValue(null);
    mockEventLogEmit.mockReset().mockResolvedValue(undefined);
    mockAgentService.getById.mockReset();
    mockLogActivity.mockReset().mockResolvedValue(undefined);
    mockIssueService.addComment.mockResolvedValue({
      id: "comment-1",
      issueId: "11111111-1111-4111-8111-111111111111",
      companyId: "company-1",
      body: "hello",
      createdAt: new Date(),
      updatedAt: new Date(),
      authorAgentId: null,
      authorUserId: "local-board",
    });
    mockIssueService.findMentionedAgents.mockResolvedValue([]);
  });

  it("treats reopen=true as a no-op when the issue is already open", async () => {
    mockIssueService.getById.mockResolvedValue(makeIssue("todo"));
    mockIssueService.update.mockImplementation(async (_id: string, patch: Record<string, unknown>) => ({
      ...makeIssue("todo"),
      ...patch,
    }));

    const res = await invokeRoute({
      method: "patch",
      path: "/issues/:id",
      params: { id: "11111111-1111-4111-8111-111111111111" },
      body: { comment: "hello", reopen: true, assigneeAgentId: "33333333-3333-4333-8333-333333333333" },
    });

    expect(res.statusCode).toBe(200);
    expect(mockIssueService.update).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111", {
      assigneeAgentId: "33333333-3333-4333-8333-333333333333",
    });
    expect(mockLogActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "issue.updated",
        details: expect.not.objectContaining({ reopened: true }),
      }),
    );
  });

  it("reopens closed issues via the PATCH comment path", async () => {
    mockIssueService.getById.mockResolvedValue(makeIssue("done"));
    mockIssueService.update.mockImplementation(async (_id: string, patch: Record<string, unknown>) => ({
      ...makeIssue("done"),
      ...patch,
    }));

    const res = await invokeRoute({
      method: "patch",
      path: "/issues/:id",
      params: { id: "11111111-1111-4111-8111-111111111111" },
      body: { comment: "hello", reopen: true, assigneeAgentId: "33333333-3333-4333-8333-333333333333" },
    });

    expect(res.statusCode).toBe(200);
    expect(mockIssueService.update).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111", {
      assigneeAgentId: "33333333-3333-4333-8333-333333333333",
      status: "todo",
    });
    expect(mockLogActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "issue.updated",
        details: expect.objectContaining({
          reopened: true,
          reopenedFrom: "done",
          status: "todo",
        }),
      }),
    );
  });

  it("interrupts an active run before a combined comment update", async () => {
    const issue = {
      ...makeIssue("todo"),
      executionRunId: "run-1",
    };
    mockIssueService.getById.mockResolvedValue(issue);
    mockIssueService.update.mockImplementation(async (_id: string, patch: Record<string, unknown>) => ({
      ...issue,
      ...patch,
    }));
    mockHeartbeatService.getRun.mockResolvedValue({
      id: "run-1",
      companyId: "company-1",
      agentId: "22222222-2222-4222-8222-222222222222",
      status: "running",
    });
    mockHeartbeatService.cancelRun.mockResolvedValue({
      id: "run-1",
      companyId: "company-1",
      agentId: "22222222-2222-4222-8222-222222222222",
      status: "cancelled",
    });

    const res = await invokeRoute({
      method: "patch",
      path: "/issues/:id",
      params: { id: "11111111-1111-4111-8111-111111111111" },
      body: { comment: "hello", interrupt: true, assigneeAgentId: "33333333-3333-4333-8333-333333333333" },
    });

    expect(res.statusCode).toBe(200);
    expect(mockHeartbeatService.getRun).toHaveBeenCalledWith("run-1");
    expect(mockHeartbeatService.cancelRun).toHaveBeenCalledWith("run-1");
    expect(mockLogActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "heartbeat.cancelled",
        details: expect.objectContaining({
          source: "issue_comment_interrupt",
          issueId: "11111111-1111-4111-8111-111111111111",
        }),
      }),
    );
  });

  it("emits issue_status_changed event in the PATCH reopen flow", async () => {
    mockIssueService.getById.mockResolvedValue(makeIssue("done"));
    mockIssueService.update.mockImplementation(async (_id: string, patch: Record<string, unknown>) => ({
      ...makeIssue("done"),
      ...patch,
    }));

    const res = await invokeRoute({
      method: "patch",
      path: "/issues/:id",
      params: { id: "11111111-1111-4111-8111-111111111111" },
      body: { comment: "reopen please", reopen: true },
    });

    expect(res.statusCode).toBe(200);
    expect(mockEventLogEmit).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: "issue",
        eventType: "issue_status_changed",
        payload: expect.objectContaining({
          from: "done",
          to: "todo",
        }),
      }),
    );
  });

  it("emits issue_status_changed event in the POST comment reopen flow", async () => {
    mockIssueService.getById.mockResolvedValue(makeIssue("done"));
    mockIssueService.update.mockImplementation(async (_id: string, patch: Record<string, unknown>) => ({
      ...makeIssue("done"),
      ...patch,
    }));

    const res = await invokeRoute({
      method: "post",
      path: "/issues/:id/comments",
      params: { id: "11111111-1111-4111-8111-111111111111" },
      body: { body: "reopening this", reopen: true },
    });

    expect(res.statusCode).toBe(201);
    expect(mockEventLogEmit).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: "issue",
        eventType: "issue_status_changed",
        payload: expect.objectContaining({
          from: "done",
          to: "todo",
        }),
      }),
    );
  });
});
