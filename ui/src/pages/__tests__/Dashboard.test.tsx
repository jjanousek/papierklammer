// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Agent } from "@papierklammer/shared";

// ── Mocks ──

vi.mock("@/lib/router", () => ({
  Link: ({ children, className, ...props }: ComponentProps<"a">) => (
    <a className={className} {...props}>{children}</a>
  ),
  useLocation: () => ({ pathname: "/", search: "", hash: "" }),
  useNavigate: () => () => {},
}));

vi.mock("@/context/CompanyContext", () => ({
  useCompany: () => ({
    selectedCompanyId: "company-1",
    companies: [{ id: "company-1", name: "Test Corp" }],
  }),
}));

vi.mock("@/context/DialogContext", () => ({
  useDialog: () => ({ openOnboarding: vi.fn() }),
}));

vi.mock("@/context/BreadcrumbContext", () => ({
  useBreadcrumbs: () => ({ setBreadcrumbs: vi.fn() }),
}));

const mockAgents: Agent[] = [
  makeAgent("a-ceo", "ceo-agent", "ceo", "active"),
  makeAgent("a-pm", "pm-agent", "pm", "active"),
  makeAgent("a-eng1", "eng-alpha", "engineer", "running"),
  makeAgent("a-eng2", "eng-beta", "engineer", "idle"),
  makeAgent("a-eng3", "eng-gamma", "engineer", "active"),
  makeAgent("a-qa", "qa-agent", "qa", "idle"),
];

const mockOrgNodes = [
  {
    id: "a-ceo", name: "ceo-agent", role: "ceo", status: "active",
    reports: [
      {
        id: "a-pm", name: "pm-agent", role: "pm", status: "active",
        reports: [
          { id: "a-eng1", name: "eng-alpha", role: "engineer", status: "running", reports: [] },
          { id: "a-eng2", name: "eng-beta", role: "engineer", status: "idle", reports: [] },
          { id: "a-eng3", name: "eng-gamma", role: "engineer", status: "active", reports: [] },
        ],
      },
      {
        id: "a-qa", name: "qa-agent", role: "qa", status: "idle",
        reports: [],
      },
    ],
  },
];

const mockLiveRuns = [
  { id: "run-1", status: "running", agentId: "a-eng1", agentName: "eng-alpha", adapterType: "claude_local", createdAt: new Date(Date.now() - 30000).toISOString(), startedAt: new Date(Date.now() - 25000).toISOString(), finishedAt: null, invocationSource: "assignment", triggerDetail: null },
  { id: "run-2", status: "queued", agentId: "a-eng3", agentName: "eng-gamma", adapterType: "claude_local", createdAt: new Date(Date.now() - 10000).toISOString(), startedAt: new Date(Date.now() - 5000).toISOString(), finishedAt: null, invocationSource: "assignment", triggerDetail: null },
];

const mockSummary = {
  companyId: "company-1",
  agents: { active: 3, running: 1, paused: 0, error: 0 },
  tasks: { open: 5, inProgress: 2, blocked: 0, done: 10 },
  costs: { monthSpendCents: 1800, monthBudgetCents: 10000, monthUtilizationPercent: 18 },
  pendingApprovals: 0,
  budgets: { activeIncidents: 0, pendingApprovals: 0, pausedAgents: 0, pausedProjects: 0 },
};

vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey, enabled }: { queryKey: readonly unknown[]; queryFn: () => unknown; enabled?: boolean }) => {
    if (enabled === false) return { data: undefined, isLoading: false, error: null };
    const key0 = queryKey[0];
    const key2 = queryKey.length > 2 ? queryKey[2] : undefined;
    // agents org query: ["agents", "company-1", "org"]
    if (key0 === "agents" && key2 === "org") return { data: mockOrgNodes, isLoading: false, error: null };
    // agents list query: ["agents", "company-1"]
    if (key0 === "agents") return { data: mockAgents, isLoading: false, error: null };
    // dashboard summary: ["dashboard", "company-1"]
    if (key0 === "dashboard") return { data: mockSummary, isLoading: false, error: null };
    // live runs: ["live-runs", "company-1", "dashboard"]
    if (key0 === "live-runs") return { data: mockLiveRuns, isLoading: false, error: null };
    return { data: undefined, isLoading: false, error: null };
  },
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

import { Dashboard } from "../Dashboard";

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function renderDashboard() {
  act(() => {
    root.render(<Dashboard />);
  });
}

describe("Dashboard tier-column layout", () => {
  it("renders three tier columns (Executive, Leads, Workers)", () => {
    renderDashboard();
    const executive = container.querySelector('[data-testid="tier-column-executive"]');
    const leads = container.querySelector('[data-testid="tier-column-leads"]');
    const workers = container.querySelector('[data-testid="tier-column-workers"]');
    expect(executive).toBeTruthy();
    expect(leads).toBeTruthy();
    expect(workers).toBeTruthy();
  });

  it("groups agents into correct tier columns by org hierarchy", () => {
    renderDashboard();
    const executive = container.querySelector('[data-testid="tier-column-executive"]');
    const leads = container.querySelector('[data-testid="tier-column-leads"]');
    const workers = container.querySelector('[data-testid="tier-column-workers"]');

    // Executive should contain CEO agent
    expect(executive?.textContent).toContain("ceo-agent");

    // Leads should contain PM and QA agents
    expect(leads?.textContent).toContain("pm-agent");
    expect(leads?.textContent).toContain("qa-agent");

    // Workers should contain engineers
    expect(workers?.textContent).toContain("eng-alpha");
    expect(workers?.textContent).toContain("eng-beta");
    expect(workers?.textContent).toContain("eng-gamma");
  });

  it("sorts agents by activity: active/running first, then idle", () => {
    renderDashboard();
    const workers = container.querySelector('[data-testid="tier-column-workers"]');
    const agentBlocks = workers?.querySelectorAll('[data-testid^="agent-block-"]');
    const blockTexts = Array.from(agentBlocks ?? []).map((el) => el.textContent ?? "");

    // eng-alpha (running) and eng-gamma (queued) should be before eng-beta (idle)
    const alphaIdx = blockTexts.findIndex((t) => t.includes("eng-alpha"));
    const gammaIdx = blockTexts.findIndex((t) => t.includes("eng-gamma"));
    const betaIdx = blockTexts.findIndex((t) => t.includes("eng-beta"));
    expect(alphaIdx).toBeLessThan(betaIdx);
    expect(gammaIdx).toBeLessThan(betaIdx);
  });

  it("renders TopBar with PAPIERKLAMMER logo", () => {
    renderDashboard();
    expect(container.textContent).toContain("PAPIERKLAMMER");
  });

  it("renders TopBar with pipeline, history, config tabs", () => {
    renderDashboard();
    expect(container.textContent).toContain("pipeline");
    expect(container.textContent).toContain("history");
    expect(container.textContent).toContain("config");
  });

  it("renders MetricsStrip with metric labels", () => {
    renderDashboard();
    expect(container.textContent).toContain("TOTAL TOKENS");
    expect(container.textContent).toContain("AGENTS");
    expect(container.textContent).toContain("DEPTH");
    expect(container.textContent).toContain("ELAPSED");
    expect(container.textContent).toContain("COST");
  });

  it("renders CommandBar at the bottom", () => {
    renderDashboard();
    const commandBar = container.querySelector('[data-testid="command-bar"]');
    expect(commandBar).toBeTruthy();
    expect(commandBar?.textContent).toContain("EXEC");
    expect(commandBar?.textContent).toContain("RUN");
  });

  it("renders active count and idle count in top bar", () => {
    renderDashboard();
    // With our mock: 2 runs active (eng-alpha running, eng-gamma queued) = 2 active
    // 6 total non-terminated - 2 active = 4 idle
    expect(container.textContent).toContain("2 active");
    expect(container.textContent).toContain("4 idle");
  });

  it("renders cost from dashboard summary", () => {
    renderDashboard();
    expect(container.textContent).toContain("$18.00");
  });
});

function makeAgent(id: string, name: string, role: string, status: string): Agent {
  return {
    id,
    companyId: "company-1",
    name,
    urlKey: name,
    role: role as Agent["role"],
    title: null,
    icon: null,
    status: status as Agent["status"],
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
  };
}
