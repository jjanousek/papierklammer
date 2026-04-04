// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Company } from "@papierklammer/shared";

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
      issueCounter: 12,
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

  return {
    companies,
    selectedCompanyId: "company-a",
    setSelectedCompanyId: vi.fn(),
    setBreadcrumbs: vi.fn(),
    invalidateQueries: vi.fn(),
    issuesList: vi.fn(() => []),
    issuesUpdate: vi.fn(() => ({})),
    agentsList: vi.fn(() => []),
    projectsList: vi.fn(() => []),
    liveRunsForCompany: vi.fn(() => []),
  };
});

vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ enabled = true, queryFn }: { enabled?: boolean; queryFn: () => unknown }) => ({
    data: enabled ? queryFn() : undefined,
    isLoading: false,
    error: null,
  }),
  useMutation: ({ mutationFn, onSuccess }: { mutationFn: (input: unknown) => unknown; onSuccess?: () => void }) => ({
    mutate: (input: unknown) => {
      mutationFn(input);
      onSuccess?.();
    },
    isPending: false,
  }),
  useQueryClient: () => ({
    invalidateQueries: mocks.invalidateQueries,
  }),
}));

vi.mock("@/lib/router", () => ({
  useLocation: () => ({ pathname: "/BET/issues", search: "", hash: "" }),
  useParams: () => ({ companyPrefix: "BET" }),
  useSearchParams: () => [new URLSearchParams(""), vi.fn()],
}));

vi.mock("../../context/CompanyContext", () => ({
  useCompany: () => ({
    companies: mocks.companies,
    selectedCompanyId: mocks.selectedCompanyId,
    setSelectedCompanyId: mocks.setSelectedCompanyId,
  }),
}));

vi.mock("../../context/BreadcrumbContext", () => ({
  useBreadcrumbs: () => ({ setBreadcrumbs: mocks.setBreadcrumbs }),
}));

vi.mock("../../api/issues", () => ({
  issuesApi: {
    list: mocks.issuesList,
    update: mocks.issuesUpdate,
  },
}));

vi.mock("../../api/agents", () => ({
  agentsApi: {
    list: mocks.agentsList,
  },
}));

vi.mock("../../api/projects", () => ({
  projectsApi: {
    list: mocks.projectsList,
  },
}));

vi.mock("../../api/heartbeats", () => ({
  heartbeatsApi: {
    liveRunsForCompany: mocks.liveRunsForCompany,
  },
}));

vi.mock("../../components/IssuesList", () => ({
  IssuesList: () => <div data-testid="issues-list">issues list</div>,
}));

vi.mock("../../components/EmptyState", () => ({
  EmptyState: ({ message }: { message: string }) => <div>{message}</div>,
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

import { Issues } from "../Issues";

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  mocks.selectedCompanyId = "company-a";
  mocks.setSelectedCompanyId.mockReset();
  mocks.setBreadcrumbs.mockReset();
  mocks.invalidateQueries.mockReset();
  mocks.issuesList.mockClear();
  mocks.issuesUpdate.mockClear();
  mocks.agentsList.mockClear();
  mocks.projectsList.mockClear();
  mocks.liveRunsForCompany.mockClear();

  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("Issues", () => {
  it("uses the route company for company-scoped queries and synchronizes selection", () => {
    act(() => {
      root.render(<Issues />);
    });

    expect(mocks.issuesList).toHaveBeenCalledWith("company-b", { participantAgentId: undefined });
    expect(mocks.agentsList).toHaveBeenCalledWith("company-b");
    expect(mocks.projectsList).toHaveBeenCalledWith("company-b");
    expect(mocks.liveRunsForCompany).toHaveBeenCalledWith("company-b");
    expect(mocks.setSelectedCompanyId).toHaveBeenCalledWith("company-b", { source: "route_sync" });
    expect(mocks.issuesList).not.toHaveBeenCalledWith("company-a", expect.anything());
  });
});
