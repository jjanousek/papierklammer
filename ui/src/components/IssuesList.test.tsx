// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Issue } from "@papierklammer/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IssuesList, type IssueViewState } from "./IssuesList";

const mocks = vi.hoisted(() => ({
  openNewIssue: vi.fn(),
  getSession: vi.fn(() => ({ user: { id: "user-1" } })),
  listLabels: vi.fn(() => []),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ enabled = true, queryFn, placeholderData }: { enabled?: boolean; queryFn: () => unknown; placeholderData?: (previousData: unknown) => unknown }) => ({
    data: enabled ? queryFn() : placeholderData?.(undefined),
    isLoading: false,
    error: null,
  }),
}));

vi.mock("../context/CompanyContext", () => ({
  useCompany: () => ({
    selectedCompanyId: "company-1",
  }),
}));

vi.mock("../context/DialogContext", () => ({
  useDialog: () => ({
    openNewIssue: mocks.openNewIssue,
  }),
}));

vi.mock("../api/auth", () => ({
  authApi: {
    getSession: mocks.getSession,
  },
}));

vi.mock("../api/issues", () => ({
  issuesApi: {
    list: vi.fn(() => []),
    listLabels: mocks.listLabels,
  },
}));

vi.mock("./StatusIcon", () => ({
  StatusIcon: ({ status }: { status: string }) => <span data-status-icon={status}>{status}</span>,
}));

vi.mock("./PriorityIcon", () => ({
  PriorityIcon: ({ priority }: { priority: string }) => <span data-priority-icon={priority}>{priority}</span>,
}));

vi.mock("./IssueRow", () => ({
  IssueRow: ({ issue }: { issue: Issue }) => (
    <div data-issue-row={issue.title} data-status={issue.status}>
      {issue.title}:{issue.status}
    </div>
  ),
}));

vi.mock("./PageSkeleton", () => ({
  PageSkeleton: () => <div>loading</div>,
}));

vi.mock("./EmptyState", () => ({
  EmptyState: ({ message }: { message: string }) => <div>{message}</div>,
}));

vi.mock("./KanbanBoard", () => ({
  KanbanBoard: () => <div data-testid="kanban-board">kanban</div>,
}));

vi.mock("./Identity", () => ({
  Identity: ({ name }: { name: string }) => <span>{name}</span>,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, type = "button", ...props }: React.ComponentProps<"button">) => (
    <button type={type} {...props}>{children}</button>
  ),
}));

vi.mock("@/components/ui/input", () => ({
  Input: (props: React.ComponentProps<"input">) => <input {...props} />,
}));

vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PopoverContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/checkbox", () => ({
  Checkbox: ({ checked, onCheckedChange }: { checked?: boolean; onCheckedChange?: () => void }) => (
    <input
      type="checkbox"
      checked={checked}
      onChange={() => onCheckedChange?.()}
      readOnly
    />
  ),
}));

vi.mock("@/components/ui/collapsible", () => ({
  Collapsible: ({ children }: { children: React.ReactNode }) => <section data-collapsible>{children}</section>,
  CollapsibleTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CollapsibleContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const storage = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storage.set(key, value);
    },
    removeItem: (key: string) => {
      storage.delete(key);
    },
    clear: () => {
      storage.clear();
    },
  },
  configurable: true,
});

function createIssue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: "issue-1",
    identifier: "PAP-1",
    companyId: "company-1",
    projectId: null,
    projectWorkspaceId: null,
    goalId: null,
    parentId: null,
    title: "Issue",
    description: null,
    status: "todo",
    priority: "medium",
    assigneeAgentId: null,
    assigneeUserId: null,
    createdByAgentId: null,
    createdByUserId: null,
    issueNumber: 1,
    requestDepth: 0,
    billingCode: null,
    assigneeAdapterOverrides: null,
    executionWorkspaceId: null,
    executionWorkspacePreference: null,
    executionWorkspaceSettings: null,
    checkoutRunId: null,
    executionRunId: null,
    executionAgentNameKey: null,
    executionLockedAt: null,
    startedAt: null,
    completedAt: null,
    cancelledAt: null,
    hiddenAt: null,
    createdAt: new Date("2026-04-05T00:00:00.000Z"),
    updatedAt: new Date("2026-04-05T00:00:00.000Z"),
    labels: [],
    labelIds: [],
    myLastTouchAt: null,
    lastExternalCommentAt: null,
    isUnreadForMe: false,
    ...overrides,
  };
}

function defaultViewState(overrides: Partial<IssueViewState> = {}): IssueViewState {
  return {
    statuses: [],
    priorities: [],
    assignees: [],
    labels: [],
    projects: [],
    sortField: "updated",
    sortDir: "desc",
    groupBy: "none",
    viewMode: "list",
    collapsedGroups: [],
    ...overrides,
  };
}

function renderIssuesList(container: HTMLDivElement, issues: Issue[]) {
  const root = createRoot(container);
  act(() => {
    root.render(
      <IssuesList
        issues={issues}
        agents={[]}
        projects={[]}
        viewStateKey="paperclip:issues-view"
        onUpdateIssue={vi.fn()}
      />,
    );
  });
  return root;
}

describe("IssuesList", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    localStorage.clear();
    mocks.openNewIssue.mockReset();
    mocks.getSession.mockClear();
    mocks.listLabels.mockClear();
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    container?.remove();
  });

  it("groups recovered issues by projected status instead of raw status", () => {
    localStorage.setItem(
      "paperclip:issues-view:company-1",
      JSON.stringify(defaultViewState({ groupBy: "status" })),
    );

    const root = renderIssuesList(container, [
      createIssue({
        id: "issue-recovered",
        title: "Recovered issue",
        status: "in_progress",
        projectedStatus: "todo",
      }),
      createIssue({
        id: "issue-active",
        title: "Active issue",
        status: "in_progress",
      }),
    ]);

    const sections = Array.from(container.querySelectorAll("[data-collapsible]")).map((section) => section.textContent ?? "");
    expect(sections.some((text) => text.includes("Todo"))).toBe(true);
    expect(sections.some((text) => text.includes("In Progress"))).toBe(true);
    expect(sections.some((text) => text.includes("Todo") && text.includes("Recovered issue:todo"))).toBe(true);
    expect(sections.some((text) => text.includes("In Progress") && text.includes("Recovered issue:todo"))).toBe(false);

    act(() => {
      root.unmount();
    });
  });

  it("filters by projected status so recovered issues match their displayed bucket", () => {
    localStorage.setItem(
      "paperclip:issues-view:company-1",
      JSON.stringify(defaultViewState({ statuses: ["todo"] })),
    );

    const root = renderIssuesList(container, [
      createIssue({
        id: "issue-recovered",
        title: "Recovered issue",
        status: "in_progress",
        projectedStatus: "todo",
      }),
      createIssue({
        id: "issue-active",
        title: "Active issue",
        status: "in_progress",
      }),
    ]);

    const rows = Array.from(container.querySelectorAll("[data-issue-row]")).map((row) => row.textContent);
    expect(rows).toContain("Recovered issue:todo");
    expect(rows).not.toContain("Active issue:in_progress");

    act(() => {
      root.unmount();
    });
  });

  it("sorts by projected status so recovered issues no longer sort like active work", () => {
    localStorage.setItem(
      "paperclip:issues-view:company-1",
      JSON.stringify(defaultViewState({ sortField: "status", sortDir: "asc" })),
    );

    const root = renderIssuesList(container, [
      createIssue({
        id: "issue-recovered",
        title: "Recovered backlog",
        status: "in_progress",
        projectedStatus: "backlog",
      }),
      createIssue({
        id: "issue-todo",
        title: "Todo issue",
        status: "todo",
      }),
    ]);

    const rows = Array.from(container.querySelectorAll("[data-issue-row]")).map((row) => row.getAttribute("data-issue-row"));
    expect(rows).toEqual(["Todo issue", "Recovered backlog"]);

    act(() => {
      root.unmount();
    });
  });
});
