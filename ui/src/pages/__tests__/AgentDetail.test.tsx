// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import type { ComponentProps, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentDetail as AgentDetailRecord, HeartbeatRun } from "@papierklammer/shared";

const navigateMock = vi.fn();
const queryClientMock = {
  invalidateQueries: vi.fn(),
  cancelQueries: vi.fn(),
  getQueryData: vi.fn(),
  setQueryData: vi.fn(),
};

vi.mock("@/lib/router", () => ({
  Link: ({ children, className, to, ...props }: ComponentProps<"a"> & { to?: string }) => (
    <a className={className} href={typeof to === "string" ? to : undefined} {...props}>
      {children}
    </a>
  ),
  Navigate: () => null,
  useBeforeUnload: () => {},
  useNavigate: () => navigateMock,
  useParams: () => ({ companyPrefix: "TST", agentId: "eng-alpha", tab: "dashboard" }),
}));

vi.mock("@/context/CompanyContext", () => {
  const company = { id: "company-1", name: "Test Corp", issuePrefix: "TST", status: "active" };
  return {
    useCompany: () => ({
      companies: [company],
      selectedCompanyId: "company-1",
      selectedCompany: company,
      selectionSource: "manual",
      setSelectedCompanyId: vi.fn(),
    }),
  };
});

vi.mock("@/context/PanelContext", () => ({
  usePanel: () => ({ closePanel: vi.fn() }),
}));

vi.mock("@/context/SidebarContext", () => ({
  useSidebar: () => ({ isMobile: false }),
}));

vi.mock("@/context/DialogContext", () => ({
  useDialog: () => ({ openNewIssue: vi.fn() }),
}));

vi.mock("@/context/BreadcrumbContext", () => ({
  useBreadcrumbs: () => ({ setBreadcrumbs: vi.fn() }),
}));

vi.mock("@/context/ToastContext", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/components/AgentConfigForm", () => ({
  AgentConfigForm: () => <div data-testid="agent-config-form" />,
}));

vi.mock("@/components/MarkdownEditor", () => ({
  MarkdownEditor: () => <div data-testid="markdown-editor" />,
}));

vi.mock("@/components/PackageFileTree", () => ({
  PackageFileTree: () => <div data-testid="package-file-tree" />,
  buildFileTree: () => [],
}));

vi.mock("@/components/AgentIconPicker", () => ({
  AgentIcon: () => <span data-testid="agent-icon" />,
  AgentIconPicker: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("@/components/transcript/RunTranscriptView", () => ({
  RunTranscriptView: () => <div data-testid="run-transcript-view" />,
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey, enabled }: { queryKey: readonly unknown[]; enabled?: boolean }) => {
    if (enabled === false) return { data: undefined, isLoading: false, error: null };
    const [key0, key1, key2] = queryKey;
    if (key0 === "agents" && key1 === "detail") {
      return { data: mockAgent, isLoading: false, error: null };
    }
    if (key0 === "agents" && key1 === "runtime-state") {
      return { data: undefined, isLoading: false, error: null };
    }
    if (key0 === "agents" && key1 === "company-1") {
      return { data: [mockAgent], isLoading: false, error: null };
    }
    if (key0 === "heartbeats") {
      return { data: [mockRun], isLoading: false, error: null };
    }
    if (key0 === "issues" && key2 === "participant-agent") {
      return { data: [], isLoading: false, error: null };
    }
    if (key0 === "budgets" && key1 === "overview") {
      return { data: { policies: [] }, isLoading: false, error: null };
    }
    return { data: undefined, isLoading: false, error: null };
  },
  useMutation: () => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
  }),
  useQueryClient: () => queryClientMock,
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

import { AgentDetail } from "../AgentDetail";

const mockAgent: AgentDetailRecord = {
  id: "agent-1",
  companyId: "company-1",
  name: "eng-alpha",
  urlKey: "eng-alpha",
  role: "engineer",
  title: null,
  icon: null,
  status: "running",
  reportsTo: null,
  capabilities: null,
  adapterType: "claude_local",
  adapterConfig: {},
  runtimeConfig: {},
  budgetMonthlyCents: 0,
  spentMonthlyCents: 0,
  pauseReason: null,
  pausedAt: null,
  permissions: { canCreateAgents: false },
  lastHeartbeatAt: null,
  metadata: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  chainOfCommand: [],
  access: {
    canAssignTasks: false,
    taskAssignSource: "none",
    membership: null,
    grants: [],
  },
};

const mockRun: HeartbeatRun = {
  id: "run-identity-123",
  companyId: "company-1",
  agentId: "agent-1",
  invocationSource: "assignment",
  triggerDetail: null,
  status: "running",
  startedAt: new Date(),
  finishedAt: null,
  error: null,
  wakeupRequestId: null,
  exitCode: null,
  signal: null,
  usageJson: null,
  resultJson: { summary: "Finished the requested demo work." },
  sessionIdBefore: null,
  sessionIdAfter: null,
  logStore: null,
  logRef: null,
  logBytes: null,
  logSha256: null,
  logCompressed: false,
  stdoutExcerpt: null,
  stderrExcerpt: null,
  errorCode: null,
  externalRunId: null,
  processPid: null,
  processStartedAt: null,
  retryOfRunId: null,
  processLossRetryCount: 0,
  contextSnapshot: { issueId: "issue-identity-42" },
  createdAt: new Date(),
  updatedAt: new Date(),
};

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  navigateMock.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("AgentDetail latest run identity", () => {
  it("renders stable run identity values on the dashboard summary card", () => {
    act(() => {
      root.render(<AgentDetail />);
    });

    expect(container.textContent).toContain("TST · company-1");
    expect(container.textContent).toContain("issue-identity-42");
    expect(container.textContent).toContain("agent-1");
    expect(container.textContent).toContain("run-identity-123");
  });
});
