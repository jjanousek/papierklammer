// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Outlet, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type MockHealthState = {
  data: {
    status: "ok";
    deploymentMode: "authenticated";
    deploymentExposure: "private";
    authReady: boolean;
    bootstrapStatus: "ready" | "bootstrap_pending";
    bootstrapInviteActive: boolean;
  };
  isLoading: boolean;
  error: Error | null;
};

const mocks = vi.hoisted(() => ({
  health: {
    data: {
      status: "ok" as const,
      deploymentMode: "authenticated" as const,
      deploymentExposure: "private" as const,
      authReady: true,
      bootstrapStatus: "ready" as const,
      bootstrapInviteActive: false,
    },
    isLoading: false,
    error: null as Error | null,
  } as MockHealthState,
  session: {
    data: null as
      | {
          session: { id: string; userId: string };
          user: { id: string; email: string | null; name: string | null };
        }
      | null,
    isLoading: false,
    error: null as Error | null,
  },
  companies: [
    {
      id: "company-1",
      name: "Pap Co",
      issuePrefix: "PAP",
      status: "active",
    },
  ],
  dismissedRouteOnboardingPath: null as string | null,
  openOnboarding: vi.fn(),
  closeOnboarding: vi.fn(),
  clearDismissedRouteOnboarding: vi.fn(),
}));

function renderStub(label: string) {
  return () => <div>{label}</div>;
}

function buildQueryResult(state: {
  data: unknown;
  isLoading: boolean;
  error: Error | null;
}) {
  return {
    data: state.data,
    error: state.error,
    isLoading: state.isLoading,
    isFetching: false,
  };
}

vi.mock("@tanstack/react-query", () => ({
  useQuery: ({
    queryKey,
    enabled = true,
  }: {
    queryKey: readonly unknown[];
    enabled?: boolean;
  }) => {
    if (!enabled) {
      return {
        data: undefined,
        error: null,
        isLoading: false,
        isFetching: false,
      };
    }
    if (queryKey[0] === "health") {
      return buildQueryResult(mocks.health);
    }
    if (queryKey[0] === "auth" && queryKey[1] === "session") {
      return buildQueryResult(mocks.session);
    }
    if (queryKey[0] === "issues" && queryKey[1] === "__unprefixed_redirect__") {
      return {
        data: undefined,
        error: null,
        isLoading: false,
        isFetching: false,
      };
    }
    return {
      data: undefined,
      error: null,
      isLoading: false,
      isFetching: false,
    };
  },
  useMutation: () => ({
    isPending: false,
    mutate: vi.fn(),
  }),
  useQueryClient: () => ({
    invalidateQueries: vi.fn(),
  }),
}));

vi.mock("./context/CompanyContext", () => ({
  useCompany: () => ({
    companies: mocks.companies,
    selectedCompanyId: mocks.companies[0]?.id ?? null,
    selectedCompany: mocks.companies[0] ?? null,
    selectionSource: "bootstrap" as const,
    loading: false,
    error: null,
    setSelectedCompanyId: vi.fn(),
    reloadCompanies: vi.fn(),
    createCompany: vi.fn(),
  }),
}));

vi.mock("./context/DialogContext", () => ({
  useDialog: () => ({
    onboardingOpen: false,
    onboardingOptions: {},
    dismissedRouteOnboardingPath: mocks.dismissedRouteOnboardingPath,
    openOnboarding: mocks.openOnboarding,
    closeOnboarding: mocks.closeOnboarding,
    dismissRouteOnboarding: vi.fn(),
    clearDismissedRouteOnboarding: mocks.clearDismissedRouteOnboarding,
  }),
}));

vi.mock("./components/ui/button", () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
}));

vi.mock("./components/AsciiArtAnimation", () => ({
  AsciiArtAnimation: () => <div data-testid="ascii-art" />,
}));

vi.mock("./components/OnboardingWizard", async () => {
  const { useLocation } = await import("react-router-dom");
  return {
    OnboardingWizard: () => {
      const location = useLocation();
      return location.pathname.toLowerCase().endsWith("/onboarding") ? (
        <div data-testid="mock-onboarding-wizard">mock-onboarding-wizard</div>
      ) : null;
    },
  };
});

vi.mock("./components/Layout", () => ({
  Layout: () => <Outlet />,
}));

vi.mock("./pages/Dashboard", () => ({ Dashboard: renderStub("dashboard") }));
vi.mock("./pages/Companies", () => ({ Companies: renderStub("companies") }));
vi.mock("./pages/Agents", () => ({ Agents: renderStub("agents") }));
vi.mock("./pages/AgentDetail", () => ({ AgentDetail: renderStub("agent-detail") }));
vi.mock("./pages/Projects", () => ({ Projects: renderStub("projects") }));
vi.mock("./pages/ProjectDetail", () => ({ ProjectDetail: renderStub("project-detail") }));
vi.mock("./pages/ProjectWorkspaceDetail", () => ({ ProjectWorkspaceDetail: renderStub("project-workspace-detail") }));
vi.mock("./pages/Issues", () => ({ Issues: renderStub("issues") }));
vi.mock("./pages/IssueDetail", () => ({ IssueDetail: renderStub("issue-detail") }));
vi.mock("./pages/Routines", () => ({ Routines: renderStub("routines") }));
vi.mock("./pages/RoutineDetail", () => ({ RoutineDetail: renderStub("routine-detail") }));
vi.mock("./pages/ExecutionWorkspaceDetail", () => ({ ExecutionWorkspaceDetail: renderStub("execution-workspace-detail") }));
vi.mock("./pages/Goals", () => ({ Goals: renderStub("goals") }));
vi.mock("./pages/GoalDetail", () => ({ GoalDetail: renderStub("goal-detail") }));
vi.mock("./pages/Approvals", () => ({ Approvals: renderStub("approvals") }));
vi.mock("./pages/ApprovalDetail", () => ({ ApprovalDetail: renderStub("approval-detail") }));
vi.mock("./pages/Costs", () => ({ Costs: renderStub("costs") }));
vi.mock("./pages/Activity", () => ({ Activity: renderStub("activity") }));
vi.mock("./pages/Inbox", () => ({ Inbox: renderStub("inbox") }));
vi.mock("./pages/CompanySettings", () => ({ CompanySettings: renderStub("company-settings") }));
vi.mock("./pages/CompanySkills", () => ({ CompanySkills: renderStub("company-skills") }));
vi.mock("./pages/CompanyExport", () => ({ CompanyExport: renderStub("company-export") }));
vi.mock("./pages/CompanyImport", () => ({ CompanyImport: renderStub("company-import") }));
vi.mock("./pages/DesignGuide", () => ({ DesignGuide: renderStub("design-guide") }));
vi.mock("./pages/InstanceGeneralSettings", () => ({ InstanceGeneralSettings: renderStub("instance-general-settings") }));
vi.mock("./pages/InstanceSettings", () => ({ InstanceSettings: renderStub("instance-settings") }));
vi.mock("./pages/InstanceExperimentalSettings", () => ({ InstanceExperimentalSettings: renderStub("instance-experimental-settings") }));
vi.mock("./pages/PluginManager", () => ({ PluginManager: renderStub("plugin-manager") }));
vi.mock("./pages/PluginSettings", () => ({ PluginSettings: renderStub("plugin-settings") }));
vi.mock("./pages/PluginPage", () => ({ PluginPage: renderStub("plugin-page") }));
vi.mock("./pages/RunTranscriptUxLab", () => ({ RunTranscriptUxLab: renderStub("run-transcript-ux-lab") }));
vi.mock("./pages/OrgChart", () => ({ OrgChart: renderStub("org-chart") }));
vi.mock("./pages/NewAgent", () => ({ NewAgent: renderStub("new-agent") }));
vi.mock("./pages/BoardClaim", () => ({ BoardClaimPage: renderStub("board-claim") }));
vi.mock("./pages/CliAuth", () => ({ CliAuthPage: renderStub("cli-auth") }));
vi.mock("./pages/InviteLanding", () => ({ InviteLandingPage: renderStub("invite-landing") }));
vi.mock("./pages/NotFound", () => ({ NotFoundPage: renderStub("not-found") }));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

import { App } from "./App";

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
}

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function renderAt(path: string) {
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={[path]}>
        <App />
        <LocationProbe />
      </MemoryRouter>,
    );
  });
  await flush();
}

beforeEach(() => {
  mocks.health = {
    data: {
      status: "ok",
      deploymentMode: "authenticated",
      deploymentExposure: "private",
      authReady: true,
      bootstrapStatus: "ready",
      bootstrapInviteActive: false,
    },
    isLoading: false,
    error: null,
  };
  mocks.session = {
    data: null,
    isLoading: false,
    error: null,
  };
  mocks.companies = [
    {
      id: "company-1",
      name: "Pap Co",
      issuePrefix: "PAP",
      status: "active",
    },
  ];
  mocks.dismissedRouteOnboardingPath = null;
  mocks.openOnboarding.mockReset();
  mocks.closeOnboarding.mockReset();
  mocks.clearDismissedRouteOnboarding.mockReset();

  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
});

describe("App bootstrap/auth gates", () => {
  it("shows bootstrap gating before unresolved auth and hides onboarding chrome", async () => {
    mocks.health = {
      data: {
        status: "ok",
        deploymentMode: "authenticated",
        deploymentExposure: "private",
        authReady: false,
        bootstrapStatus: "bootstrap_pending",
        bootstrapInviteActive: true,
      },
      isLoading: false,
      error: null,
    };
    mocks.session = {
      data: null,
      isLoading: true,
      error: null,
    };

    await renderAt("/PAP/onboarding");

    expect(document.body.textContent).toContain("Instance setup required");
    expect(document.body.textContent).toContain("pnpm papierklammer auth bootstrap-ceo");
    expect(document.body.textContent).not.toContain("mock-onboarding-wizard");
    expect(document.body.textContent).not.toContain("Loading...");
    expect(document.querySelector('[data-testid="location"]')?.textContent).toBe("/PAP/onboarding");
  });

  it("redirects signed-out onboarding entry to auth with a preserved next destination", async () => {
    await renderAt("/PAP/onboarding");

    expect(document.querySelector('[data-testid="location"]')?.textContent).toBe(
      "/auth?next=%2FPAP%2Fonboarding",
    );
    expect(document.body.textContent).toContain("Sign in to Papierklammer");
    expect(document.body.textContent).not.toContain("mock-onboarding-wizard");
  });

  it("returns authenticated operators from /auth to the intended onboarding route", async () => {
    mocks.session = {
      data: {
        session: { id: "session-1", userId: "user-1" },
        user: { id: "user-1", email: "operator@example.com", name: "Operator" },
      },
      isLoading: false,
      error: null,
    };

    await renderAt("/auth?next=%2FPAP%2Fonboarding");

    expect(document.querySelector('[data-testid="location"]')?.textContent).toBe("/PAP/onboarding");
    expect(document.body.textContent).toContain("mock-onboarding-wizard");
    expect(document.body.textContent).not.toContain("Sign in to Papierklammer");
  });
});
