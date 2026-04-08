// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActivityEvent, Agent, Company, Issue, IssueComment, IssueWorkProduct, Project } from "@papierklammer/shared";
import type { RunForIssue } from "../../api/activity";

const mocks = vi.hoisted(() => {
  const companies: Company[] = [
    {
      id: "company-a",
      name: "Alpha Co",
      description: null,
      status: "active",
      pauseReason: null,
      pausedAt: null,
      issuePrefix: "ALP",
      issueCounter: 1,
      budgetMonthlyCents: 0,
      spentMonthlyCents: 0,
      requireBoardApprovalForNewAgents: false,
      brandColor: null,
      logoAssetId: null,
      logoUrl: null,
      createdAt: new Date("2026-04-04T00:00:00.000Z"),
      updatedAt: new Date("2026-04-04T00:00:00.000Z"),
    },
    {
      id: "company-b",
      name: "Beta Co",
      description: null,
      status: "active",
      pauseReason: null,
      pausedAt: null,
      issuePrefix: "BET",
      issueCounter: 7,
      budgetMonthlyCents: 0,
      spentMonthlyCents: 0,
      requireBoardApprovalForNewAgents: false,
      brandColor: null,
      logoAssetId: null,
      logoUrl: null,
      createdAt: new Date("2026-04-04T00:00:00.000Z"),
      updatedAt: new Date("2026-04-04T00:00:00.000Z"),
    },
  ];

  const issue: Issue = {
    id: "issue-1",
    companyId: "company-b",
    projectId: "project-b",
    projectWorkspaceId: null,
    goalId: null,
    parentId: null,
    ancestors: [],
    title: "Deep-link target",
    description: "Investigate route-scoped issue detail lookups",
    status: "todo",
    priority: "medium",
    assigneeAgentId: null,
    assigneeUserId: null,
    checkoutRunId: null,
    executionRunId: null,
    executionAgentNameKey: null,
    executionLockedAt: null,
    createdByAgentId: null,
    createdByUserId: null,
    issueNumber: 7,
    identifier: "BET-7",
    requestDepth: 0,
    billingCode: null,
    assigneeAdapterOverrides: null,
    executionWorkspaceId: null,
    executionWorkspacePreference: null,
    executionWorkspaceSettings: null,
    startedAt: null,
    completedAt: null,
    cancelledAt: null,
    hiddenAt: null,
    labels: [],
    labelIds: [],
    documentSummaries: [],
    workProducts: [],
    createdAt: new Date("2026-04-04T00:00:00.000Z"),
    updatedAt: new Date("2026-04-04T00:00:00.000Z"),
  };

  const agents: Agent[] = [
    {
      id: "agent-b",
      companyId: "company-b",
      name: "Beta Agent",
      urlKey: "beta-agent",
      role: "engineer",
      title: null,
      icon: null,
      status: "active",
      reportsTo: null,
      capabilities: null,
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      budgetMonthlyCents: 0,
      spentMonthlyCents: 0,
      pauseReason: null,
      pausedAt: null,
      permissions: { canCreateAgents: false },
      lastHeartbeatAt: null,
      metadata: null,
      createdAt: new Date("2026-04-04T00:00:00.000Z"),
      updatedAt: new Date("2026-04-04T00:00:00.000Z"),
    },
  ];

  const projects: Project[] = [
    {
      id: "project-b",
      companyId: "company-b",
      urlKey: "beta-project",
      goalId: null,
      goalIds: [],
      goals: [],
      name: "Beta Project",
      description: null,
      status: "planned",
      leadAgentId: null,
      targetDate: null,
      color: null,
      pauseReason: null,
      pausedAt: null,
      executionWorkspacePolicy: null,
      codebase: {
        workspaceId: null,
        repoUrl: null,
        repoRef: null,
        defaultRef: null,
        repoName: null,
        localFolder: "/tmp/project-b",
        managedFolder: "/tmp/project-b",
        effectiveLocalFolder: "/tmp/project-b",
        origin: "local_folder",
      },
      workspaces: [],
      primaryWorkspace: null,
      archivedAt: null,
      createdAt: new Date("2026-04-04T00:00:00.000Z"),
      updatedAt: new Date("2026-04-04T00:00:00.000Z"),
    },
  ];

  return {
    companies,
    routeCompanyPrefix: "BET" as string | undefined,
    routeIssueId: "BET-7",
    locationPathname: "/BET/issues/BET-7",
    issue,
    agents,
    projects,
    selectedCompanyId: "company-a",
    selectionSource: "route_sync" as "manual" | "route_sync" | "bootstrap",
    setSelectedCompanyId: vi.fn(),
    navigate: vi.fn(),
    rawNavigate: vi.fn(),
    setBreadcrumbs: vi.fn(),
    openPanel: vi.fn(),
    closePanel: vi.fn(),
    setPanelVisible: vi.fn(),
    pushToast: vi.fn(),
    invalidateQueries: vi.fn(),
    cancelQueries: vi.fn(),
    getQueryData: vi.fn(),
    setQueryData: vi.fn(),
    issuesGet: vi.fn(() => issue),
    issuesList: vi.fn(() => []),
    issuesListComments: vi.fn<() => IssueComment[]>(() => []),
    issuesListApprovals: vi.fn(() => []),
    issuesListAttachments: vi.fn(() => []),
    issuesListWorkProducts: vi.fn((): IssueWorkProduct[] => []),
    issuesMarkRead: vi.fn(() => ({ id: "issue-1", lastReadAt: new Date("2026-04-04T00:00:00.000Z") })),
    issuesUploadAttachment: vi.fn((companyId: string, issueId: string, file: File) => ({
      id: "attachment-1",
      companyId,
      issueId,
      issueCommentId: null,
      assetId: "asset-1",
      provider: "local_disk",
      objectKey: file.name,
      contentType: file.type || "text/plain",
      byteSize: file.size,
      sha256: "abc123",
      originalFilename: file.name,
      createdByAgentId: null,
      createdByUserId: null,
      createdAt: new Date("2026-04-04T00:00:00.000Z"),
      updatedAt: new Date("2026-04-04T00:00:00.000Z"),
      contentPath: `/files/${file.name}`,
    })),
    activityForIssue: vi.fn<() => ActivityEvent[]>(() => []),
    activityRunsForIssue: vi.fn((): RunForIssue[] => []),
    liveRunsForIssue: vi.fn(() => []),
    activeRunForIssue: vi.fn(() => null),
    agentsList: vi.fn(() => agents),
    projectsList: vi.fn(() => projects),
    getSession: vi.fn(() => ({ user: { id: "user-1" }, session: { userId: "user-1" } })),
  };
});

vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ enabled = true, queryFn }: { enabled?: boolean; queryFn: () => unknown }) => ({
    data: enabled ? queryFn() : undefined,
    isLoading: false,
    error: null,
  }),
  useMutation: ({
    mutationFn,
    onMutate,
    onSuccess,
    onError,
    onSettled,
  }: {
    mutationFn: (input: unknown) => unknown;
    onMutate?: (input: unknown) => unknown;
    onSuccess?: (result: unknown, input: unknown, context: unknown) => unknown;
    onError?: (error: unknown, input: unknown, context: unknown) => unknown;
    onSettled?: (result?: unknown, error?: unknown, input?: unknown, context?: unknown) => unknown;
  }) => ({
    mutate: async (input: unknown) => {
      const context = await onMutate?.(input);
      try {
        const result = await mutationFn(input);
        await onSuccess?.(result, input, context);
        await onSettled?.(result, undefined, input, context);
      } catch (error) {
        await onError?.(error, input, context);
        await onSettled?.(undefined, error, input, context);
      }
    },
    mutateAsync: async (input: unknown) => {
      const context = await onMutate?.(input);
      try {
        const result = await mutationFn(input);
        await onSuccess?.(result, input, context);
        await onSettled?.(result, undefined, input, context);
        return result;
      } catch (error) {
        await onError?.(error, input, context);
        await onSettled?.(undefined, error, input, context);
        throw error;
      }
    },
    isPending: false,
  }),
  useQueryClient: () => ({
    invalidateQueries: mocks.invalidateQueries,
    cancelQueries: mocks.cancelQueries,
    getQueryData: mocks.getQueryData,
    setQueryData: mocks.setQueryData,
  }),
}));

vi.mock("@/lib/router", () => ({
  Link: ({ children, to, ...props }: { children: React.ReactNode; to?: string }) => (
    <a href={typeof to === "string" ? to : undefined} {...props}>{children}</a>
  ),
  useLocation: () => ({
    pathname: mocks.locationPathname,
    search: "",
    hash: "",
    state: null,
  }),
  useNavigate: () => mocks.navigate,
  useParams: () => ({ companyPrefix: mocks.routeCompanyPrefix, issueId: mocks.routeIssueId }),
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => mocks.rawNavigate,
}));

vi.mock("../../context/CompanyContext", () => ({
  useCompany: () => ({
    companies: mocks.companies,
    selectedCompanyId: mocks.selectedCompanyId,
    selectionSource: mocks.selectionSource,
    setSelectedCompanyId: mocks.setSelectedCompanyId,
  }),
}));

vi.mock("../../context/PanelContext", () => ({
  usePanel: () => ({
    openPanel: mocks.openPanel,
    closePanel: mocks.closePanel,
    panelVisible: false,
    setPanelVisible: mocks.setPanelVisible,
  }),
}));

vi.mock("../../context/ToastContext", () => ({
  useToast: () => ({ pushToast: mocks.pushToast }),
}));

vi.mock("../../context/BreadcrumbContext", () => ({
  useBreadcrumbs: () => ({ setBreadcrumbs: mocks.setBreadcrumbs }),
}));

vi.mock("../../api/issues", () => ({
  issuesApi: {
    get: mocks.issuesGet,
    list: mocks.issuesList,
    listComments: mocks.issuesListComments,
    listApprovals: mocks.issuesListApprovals,
    listAttachments: mocks.issuesListAttachments,
    listWorkProducts: mocks.issuesListWorkProducts,
    markRead: mocks.issuesMarkRead,
    uploadAttachment: mocks.issuesUploadAttachment,
    update: vi.fn(() => mocks.issue),
    addComment: vi.fn(),
    upsertDocument: vi.fn(),
    deleteAttachment: vi.fn(),
  },
}));

vi.mock("../../api/activity", () => ({
  activityApi: {
    forIssue: mocks.activityForIssue,
    runsForIssue: mocks.activityRunsForIssue,
  },
}));

vi.mock("../../api/heartbeats", () => ({
  heartbeatsApi: {
    liveRunsForIssue: mocks.liveRunsForIssue,
    activeRunForIssue: mocks.activeRunForIssue,
    cancel: vi.fn(),
  },
}));

vi.mock("../../api/agents", () => ({
  agentsApi: {
    list: mocks.agentsList,
  },
}));

vi.mock("../../api/auth", () => ({
  authApi: {
    getSession: mocks.getSession,
  },
}));

vi.mock("../../api/projects", () => ({
  projectsApi: {
    list: mocks.projectsList,
  },
}));

vi.mock("../../components/InlineEditor", () => ({
  InlineEditor: ({ value }: { value: string }) => <div>{value}</div>,
}));

vi.mock("../../components/CommentThread", () => ({
  CommentThread: () => <div data-testid="comment-thread" />,
}));

vi.mock("../../components/IssueDocumentsSection", () => ({
  IssueDocumentsSection: ({ extraActions }: { extraActions?: React.ReactNode }) => <div>{extraActions}</div>,
}));

vi.mock("../../components/IssueProperties", () => ({
  IssueProperties: () => <div data-testid="issue-properties" />,
}));

vi.mock("../../components/IssueWorkspaceCard", () => ({
  IssueWorkspaceCard: () => <div data-testid="issue-workspace-card" />,
}));

vi.mock("../../components/LiveRunWidget", () => ({
  LiveRunWidget: () => <div data-testid="live-run-widget" />,
}));

vi.mock("../../components/transcript/useLiveRunTranscripts", () => ({
  useLiveRunTranscripts: () => ({
    transcriptByRun: new Map(),
    hasOutputForRun: () => false,
  }),
}));

vi.mock("../../components/ScrollToBottom", () => ({
  ScrollToBottom: () => null,
}));

vi.mock("../../components/StatusIcon", () => ({
  StatusIcon: () => <span data-testid="status-icon" />,
}));

vi.mock("../../components/PriorityIcon", () => ({
  PriorityIcon: () => <span data-testid="priority-icon" />,
}));

vi.mock("../../components/StatusBadge", () => ({
  StatusBadge: ({ status }: { status: string }) => <span>{status}</span>,
}));

vi.mock("../../components/Identity", () => ({
  Identity: ({ name }: { name: string }) => <span>{name}</span>,
}));

vi.mock("../../plugins/slots", () => ({
  PluginSlotMount: () => null,
  PluginSlotOutlet: () => null,
  usePluginSlots: () => ({ slots: [] }),
}));

vi.mock("../../plugins/launchers", () => ({
  PluginLauncherOutlet: () => null,
}));

vi.mock("@/components/ui/separator", () => ({
  Separator: () => <div data-testid="separator" />,
}));

vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PopoverContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    onClick,
    disabled,
    type = "button",
    ...props
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    type?: "button" | "submit" | "reset";
  }) => (
    <button type={type} onClick={onClick} disabled={disabled} {...props}>
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/collapsible", () => ({
  Collapsible: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CollapsibleContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CollapsibleTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/sheet", () => ({
  Sheet: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SheetContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SheetHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SheetTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/tabs", () => ({
  Tabs: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TabsContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TabsList: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TabsTrigger: ({ children }: { children: React.ReactNode }) => <button type="button">{children}</button>,
}));

vi.mock("lucide-react", () => {
  const icon = (name: string) => () => <span data-icon={name} />;
  return {
    Activity: icon("Activity"),
    Check: icon("Check"),
    ChevronDown: icon("ChevronDown"),
    ChevronRight: icon("ChevronRight"),
    Copy: icon("Copy"),
    EyeOff: icon("EyeOff"),
    Hexagon: icon("Hexagon"),
    ListTree: icon("ListTree"),
    MessageSquare: icon("MessageSquare"),
    MoreHorizontal: icon("MoreHorizontal"),
    Paperclip: icon("Paperclip"),
    Repeat: icon("Repeat"),
    SlidersHorizontal: icon("SlidersHorizontal"),
    Trash2: icon("Trash2"),
  };
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

import { IssueDetail } from "../IssueDetail";

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  mocks.routeCompanyPrefix = "BET";
  mocks.routeIssueId = "BET-7";
  mocks.locationPathname = "/BET/issues/BET-7";
  mocks.selectedCompanyId = "company-a";
  mocks.selectionSource = "route_sync";
  mocks.setSelectedCompanyId.mockReset();
  mocks.navigate.mockReset();
  mocks.rawNavigate.mockReset();
  mocks.setBreadcrumbs.mockReset();
  mocks.openPanel.mockReset();
  mocks.closePanel.mockReset();
  mocks.setPanelVisible.mockReset();
  mocks.pushToast.mockReset();
  mocks.invalidateQueries.mockReset();
  mocks.cancelQueries.mockReset();
  mocks.getQueryData.mockReset();
  mocks.setQueryData.mockReset();
  mocks.issuesGet.mockClear();
  mocks.issuesList.mockClear();
  mocks.issuesListComments.mockClear();
  mocks.issuesListApprovals.mockClear();
  mocks.issuesListAttachments.mockClear();
  mocks.issuesListWorkProducts.mockClear();
  mocks.issuesMarkRead.mockClear();
  mocks.issuesUploadAttachment.mockClear();
  mocks.activityForIssue.mockClear();
  mocks.activityRunsForIssue.mockClear();
  mocks.liveRunsForIssue.mockClear();
  mocks.activeRunForIssue.mockClear();
  mocks.agentsList.mockClear();
  mocks.projectsList.mockClear();
  mocks.getSession.mockClear();

  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("IssueDetail", () => {
  it("keeps canonical redirects unprefixed when the deep link was opened unprefixed", async () => {
    mocks.routeCompanyPrefix = undefined;
    mocks.routeIssueId = "issue-1";
    mocks.locationPathname = "/issues/issue-1";

    await act(async () => {
      root.render(<IssueDetail />);
    });
    await flush();

    expect(mocks.rawNavigate).toHaveBeenCalledWith("/issues/BET-7", {
      replace: true,
      state: null,
    });
  });

  it("preserves the explicit company prefix when redirecting a company-scoped issue route", async () => {
    mocks.routeCompanyPrefix = "BET";
    mocks.routeIssueId = "issue-1";
    mocks.locationPathname = "/BET/issues/issue-1";

    await act(async () => {
      root.render(<IssueDetail />);
    });
    await flush();

    expect(mocks.rawNavigate).toHaveBeenCalledWith("/BET/issues/BET-7", {
      replace: true,
      state: null,
    });
  });

  it("uses the deep-linked company for secondary queries and attachments", async () => {
    await act(async () => {
      root.render(<IssueDetail />);
    });
    await flush();

    expect(mocks.issuesGet).toHaveBeenCalledWith("BET-7");
    expect(mocks.issuesList).toHaveBeenCalledWith("company-b");
    expect(mocks.agentsList).toHaveBeenCalledWith("company-b");
    expect(mocks.projectsList).toHaveBeenCalledWith("company-b");
    expect(mocks.setSelectedCompanyId).toHaveBeenCalledWith("company-b", { source: "route_sync" });

    const input = container.querySelector('input[type="file"]') as HTMLInputElement | null;
    expect(input).not.toBeNull();

    const file = new File(["hello"], "notes.txt", { type: "text/plain" });

    Object.defineProperty(input!, "files", {
      configurable: true,
      value: [file],
    });

    await act(async () => {
      input!.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await flush();

    expect(mocks.issuesUploadAttachment).toHaveBeenCalledWith("company-b", "BET-7", file);
    expect(mocks.issuesUploadAttachment).not.toHaveBeenCalledWith("company-a", "BET-7", file);
  });

  it("does not snap a manual company switch back to the deep-linked company", async () => {
    mocks.selectedCompanyId = "company-a";
    mocks.selectionSource = "manual";

    await act(async () => {
      root.render(<IssueDetail />);
    });
    await flush();

    expect(mocks.issuesGet).toHaveBeenCalledWith("BET-7");
    expect(mocks.issuesList).toHaveBeenCalledWith("company-b");
    expect(mocks.agentsList).toHaveBeenCalledWith("company-b");
    expect(mocks.projectsList).toHaveBeenCalledWith("company-b");
    expect(mocks.setSelectedCompanyId).not.toHaveBeenCalled();
  });

  it("surfaces work products and completed run results in the issue flow", async () => {
    const completedRun: RunForIssue = {
      runId: "run-12345678",
      status: "succeeded",
      agentId: "agent-b",
      startedAt: "2026-04-04T00:02:00.000Z",
      finishedAt: "2026-04-04T00:06:00.000Z",
      createdAt: "2026-04-04T00:01:00.000Z",
      invocationSource: "manual",
      usageJson: null,
      resultJson: {
        summary: "Prepared a deterministic CLI release report for board review.",
      },
    };

    const workProduct: IssueWorkProduct = {
      id: "wp-1",
      companyId: "company-b",
      projectId: "project-b",
      issueId: "issue-1",
      executionWorkspaceId: null,
      runtimeServiceId: null,
      type: "document",
      provider: "paperclip",
      externalId: null,
      title: "Release report",
      url: "https://example.test/release-report",
      status: "ready_for_review",
      reviewState: "needs_board_review",
      isPrimary: true,
      healthStatus: "healthy",
      summary: "A review-ready markdown report generated from the demo-repo run.",
      metadata: {
        branchName: "review/release-report",
        commitSha: "abc1234",
      },
      createdByRunId: "run-12345678",
      createdAt: new Date("2026-04-04T00:05:00.000Z"),
      updatedAt: new Date("2026-04-04T00:06:00.000Z"),
    };

    mocks.issuesGet.mockReturnValue({
      ...mocks.issue,
      workProducts: [workProduct],
    });
    mocks.issuesListWorkProducts.mockReturnValue([workProduct]);
    mocks.activityRunsForIssue.mockReturnValue([completedRun]);

    await act(async () => {
      root.render(<IssueDetail />);
    });
    await flush();

    expect(mocks.issuesListWorkProducts).toHaveBeenCalledWith("BET-7");
    expect(container.textContent).toContain("Review surfaces");
    expect(container.textContent).toContain("Release report");
    expect(container.textContent).toContain("A review-ready markdown report generated from the demo-repo run.");
    expect(container.textContent).toContain("review/release-report");
    expect(container.textContent).toContain("Prepared a deterministic CLI release report for board review.");
    expect(container.textContent).toContain("Inspect run");
  });

  it("shows a recovered badge after stale ownership is cleared", async () => {
    mocks.issuesGet.mockReturnValue({
      ...mocks.issue,
      projectedStatus: "todo",
      lastReconciledAt: new Date(Date.now() - 60 * 60 * 1000),
      executionRunId: null,
      checkoutRunId: null,
    });

    await act(async () => {
      root.render(<IssueDetail />);
    });
    await flush();

    expect(container.textContent).toContain("Recovered");
    expect(container.textContent).not.toContain("Live");
  });

  it("falls back to run-linked comments when completed runs lack persisted summaries", async () => {
    const completedRun: RunForIssue = {
      runId: "run-23456789",
      status: "succeeded",
      agentId: "agent-b",
      startedAt: "2026-04-04T00:02:00.000Z",
      finishedAt: "2026-04-04T00:06:00.000Z",
      createdAt: "2026-04-04T00:01:00.000Z",
      invocationSource: "manual",
      usageJson: null,
      resultJson: null,
    };

    mocks.activityForIssue.mockReturnValue([
      {
        id: "activity-1",
        companyId: "company-b",
        actorType: "agent",
        actorId: "agent-b",
        agentId: "agent-b",
        runId: "run-23456789",
        action: "issue.comment_added",
        entityType: "issue",
        entityId: "issue-1",
        details: { commentId: "comment-1" },
        createdAt: new Date("2026-04-04T00:06:10.000Z"),
      },
    ] as ActivityEvent[]);
    mocks.issuesListComments.mockReturnValue([
      {
        id: "comment-1",
        companyId: "company-b",
        issueId: "issue-1",
        authorAgentId: "agent-b",
        authorUserId: null,
        body: [
          "Heartbeat completed with a concrete next step.",
          "",
          "- Created follow-up issue [BET-8](/BET/issues/BET-8) for the CTO.",
          "- Requested approval [app-1](/BET/approvals/app-1).",
        ].join("\n"),
        createdAt: new Date("2026-04-04T00:06:10.000Z"),
        updatedAt: new Date("2026-04-04T00:06:10.000Z"),
      },
    ] as IssueComment[]);
    mocks.activityRunsForIssue.mockReturnValue([completedRun]);

    await act(async () => {
      root.render(<IssueDetail />);
    });
    await flush();

    expect(container.textContent).toContain("Heartbeat completed with a concrete next step.");
    expect(container.querySelector('a[href="/BET/issues/BET-8"]')?.textContent).toBe("BET-8");
    expect(container.querySelector('a[href="/BET/approvals/app-1"]')?.textContent).toBe("app-1");
  });
});
