// @vitest-environment jsdom

import { act } from "react";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdapterEnvironmentTestResult } from "@papierklammer/shared";

const mocks = vi.hoisted(() => ({
  location: { pathname: "/", search: "", hash: "" },
  params: {} as { companyPrefix?: string },
  onboardingOpen: true,
  onboardingOptions: {
    initialStep: 1 as 1 | 2 | 3 | 4 | undefined,
    companyId: "company-1" as string | undefined,
  } as { initialStep?: 1 | 2 | 3 | 4; companyId?: string },
  companies: [{ id: "company-1", name: "Acme Audit", issuePrefix: "ACME" }],
  companiesLoading: false,
  dismissedRouteOnboardingPath: null as string | null,
  closeOnboarding: vi.fn(),
  dismissRouteOnboarding: vi.fn(),
  clearDismissedRouteOnboarding: vi.fn(),
  navigate: vi.fn(),
  invalidateQueries: vi.fn(),
  setQueryData: vi.fn(),
  setSelectedCompanyId: vi.fn(),
  pushToast: vi.fn(),
  companiesCreate: vi.fn(),
  companiesOnboardingDraft: vi.fn(),
  goalsCreate: vi.fn(),
  goalsList: vi.fn(),
  agentsCreate: vi.fn(),
  agentsTestEnvironment: vi.fn(),
  agentsWakeup: vi.fn(),
  issuesCreate: vi.fn(),
  projectsCreate: vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ enabled }: { enabled?: boolean }) => ({
    data: enabled ? [] : undefined,
    error: null,
    isLoading: false,
    isFetching: false,
  }),
  useQueryClient: () => ({
    invalidateQueries: mocks.invalidateQueries,
    setQueryData: mocks.setQueryData,
  }),
}));

vi.mock("@/lib/router", () => ({
  useLocation: () => mocks.location,
  useNavigate: () => mocks.navigate,
  useParams: () => mocks.params,
}));

vi.mock("../context/DialogContext", () => ({
  useDialog: () => ({
    onboardingOpen: mocks.onboardingOpen,
    onboardingOptions: mocks.onboardingOptions,
    dismissedRouteOnboardingPath: mocks.dismissedRouteOnboardingPath,
    closeOnboarding: mocks.closeOnboarding,
    dismissRouteOnboarding: mocks.dismissRouteOnboarding,
    clearDismissedRouteOnboarding: mocks.clearDismissedRouteOnboarding,
  }),
}));

vi.mock("../context/CompanyContext", () => ({
  useCompany: () => ({
    companies: mocks.companies,
    loading: mocks.companiesLoading,
    setSelectedCompanyId: mocks.setSelectedCompanyId,
  }),
}));

vi.mock("../api/companies", () => ({
  companiesApi: {
    create: mocks.companiesCreate,
    onboardingDraft: mocks.companiesOnboardingDraft,
  },
}));

vi.mock("../context/ToastContext", () => ({
  useToast: () => ({
    pushToast: mocks.pushToast,
  }),
}));

vi.mock("../api/goals", () => ({
  goalsApi: {
    create: mocks.goalsCreate,
    list: mocks.goalsList,
  },
}));

vi.mock("../api/agents", () => ({
  agentsApi: {
    create: mocks.agentsCreate,
    adapterModels: vi.fn(),
    testEnvironment: mocks.agentsTestEnvironment,
    wakeup: mocks.agentsWakeup,
  },
}));

vi.mock("../api/issues", () => ({
  issuesApi: {
    create: mocks.issuesCreate,
  },
}));

vi.mock("../api/projects", () => ({
  projectsApi: {
    create: mocks.projectsCreate,
  },
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({
    open,
    children,
  }: {
    open: boolean;
    children: ReactNode;
  }) => (open ? <div>{children}</div> : null),
  DialogPortal: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PopoverContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    onClick,
    disabled,
    ...props
  }: {
    children: ReactNode;
    onClick?: () => void;
    disabled?: boolean;
  }) => (
    <button type="button" onClick={onClick} disabled={disabled} {...props}>
      {children}
    </button>
  ),
}));

vi.mock("./AsciiArtAnimation", () => ({
  AsciiArtAnimation: () => <div data-testid="ascii-art" />,
}));

vi.mock("./OpenCodeLogoIcon", () => ({
  OpenCodeLogoIcon: () => <span>OpenCode</span>,
}));

vi.mock("./HermesIcon", () => ({
  HermesIcon: () => <span>Hermes</span>,
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

import { OnboardingWizard } from "./OnboardingWizard";

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

function makeEnvResult(status: AdapterEnvironmentTestResult["status"]): AdapterEnvironmentTestResult {
  return {
    adapterType: "codex_local",
    status,
    checks: [
      {
        code: status === "fail" ? "codex_missing" : "codex_ready",
        level: status === "fail" ? "error" : "info",
        message: status === "fail" ? "Codex is not ready" : "Codex is ready",
      },
    ],
    testedAt: "2026-04-04T00:00:00.000Z",
  };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function getButton(label: string) {
  const button = Array.from(document.querySelectorAll("button")).find((candidate) =>
    candidate.textContent?.replace(/\s+/g, " ").includes(label),
  );
  if (!button) {
    throw new Error(`Button not found: ${label}`);
  }
  return button as HTMLButtonElement;
}

async function click(label: string) {
  await act(async () => {
    getButton(label).click();
  });
}

beforeEach(async () => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);

  [
    mocks.closeOnboarding,
    mocks.dismissRouteOnboarding,
    mocks.clearDismissedRouteOnboarding,
    mocks.navigate,
    mocks.invalidateQueries,
    mocks.setQueryData,
    mocks.setSelectedCompanyId,
    mocks.pushToast,
    mocks.companiesCreate,
    mocks.companiesOnboardingDraft,
    mocks.goalsCreate,
    mocks.goalsList,
    mocks.agentsCreate,
    mocks.agentsTestEnvironment,
    mocks.agentsWakeup,
    mocks.issuesCreate,
    mocks.projectsCreate,
  ].forEach((mock) => mock.mockReset());
  mocks.location = { pathname: "/", search: "", hash: "" };
  mocks.params = {};
  mocks.onboardingOpen = true;
  mocks.onboardingOptions = { initialStep: 1, companyId: "company-1" };
  mocks.dismissedRouteOnboardingPath = null;
  mocks.companies = [{ id: "company-1", name: "Acme Audit", issuePrefix: "ACME" }];
  mocks.companiesLoading = false;

  mocks.goalsList.mockResolvedValue([]);
  mocks.agentsCreate.mockResolvedValue({ id: "agent-1" });
  mocks.projectsCreate.mockResolvedValue({ id: "project-1" });
  mocks.issuesCreate.mockResolvedValue({ id: "issue-1", identifier: "ACME-1" });
  mocks.agentsWakeup.mockResolvedValue({ id: "run-1", status: "queued" });
  mocks.companiesOnboardingDraft.mockResolvedValue({
    source: "fallback",
    companyName: null,
    companyGoal: null,
    taskTitle: null,
    taskDescription: null,
  });

  await act(async () => {
    root.render(<OnboardingWizard />);
  });
  await flush();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("OnboardingWizard", () => {
  it("blocks codex agent creation when adapter validation fails", async () => {
    mocks.agentsTestEnvironment.mockResolvedValue(makeEnvResult("fail"));

    await click("Codex");
    await flush();
    await click("Next");
    await flush();

    expect(mocks.agentsTestEnvironment).toHaveBeenCalledWith(
      "company-1",
      "codex_local",
      expect.objectContaining({
        adapterConfig: expect.any(Object),
      }),
    );
    expect(mocks.agentsCreate).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain(
      "Adapter environment check failed. Fix the errors and retry.",
    );
    expect(document.body.textContent).toContain("Codex is not ready");
  });

  it("keeps Task and Launch tabs inaccessible after codex validation fails", async () => {
    mocks.agentsTestEnvironment.mockResolvedValue(makeEnvResult("fail"));

    await click("Codex");
    await flush();
    await click("Next");
    await flush();

    const taskTab = getButton("Task");
    const launchTab = getButton("Launch");

    expect(taskTab.disabled).toBe(true);
    expect(launchTab.disabled).toBe(true);

    await act(async () => {
      taskTab.click();
      launchTab.click();
    });
    await flush();

    expect(document.body.textContent).toContain("Choose the agent to add");
    expect(document.body.textContent).not.toContain("Give it something to do");
    expect(document.body.textContent).not.toContain("Ready to launch");
    expect(mocks.agentsCreate).not.toHaveBeenCalled();
  });

  it("wakes the seeded company loop when launching onboarding", async () => {
    mocks.agentsTestEnvironment.mockResolvedValue(makeEnvResult("pass"));

    await click("Codex");
    await flush();
    await click("Next");
    await flush();
    await click("Next");
    await flush();

    expect(document.body.textContent).toContain("Ready to launch");

    await click("Create & Open Issue");
    await flush();

    expect(mocks.issuesCreate).toHaveBeenCalledWith(
      "company-1",
      expect.objectContaining({
        assigneeAgentId: "agent-1",
        status: "todo",
      }),
    );
    expect(mocks.agentsWakeup).toHaveBeenCalledWith(
      "agent-1",
      expect.objectContaining({
        source: "assignment",
        triggerDetail: "manual",
        reason: "onboarding_launch",
        payload: expect.objectContaining({
          issueId: "issue-1",
        }),
        idempotencyKey: "onboarding-launch:issue-1",
      }),
      "company-1",
    );
    expect(mocks.closeOnboarding).toHaveBeenCalled();
    expect(mocks.navigate).toHaveBeenCalledWith("/ACME/issues/ACME-1");
  });

  it("derives the company-prefixed route from the pathname even when route params are unavailable", async () => {
    mocks.location = { pathname: "/ACME/onboarding", search: "", hash: "" };
    mocks.params = {};
    mocks.onboardingOptions = {};

    await act(async () => {
      root.render(<OnboardingWizard />);
    });
    await flush();

    mocks.agentsTestEnvironment.mockResolvedValue(makeEnvResult("pass"));

    await click("Codex");
    await flush();
    await click("Next");
    await flush();

    expect(mocks.agentsCreate).toHaveBeenCalledWith(
      "company-1",
      expect.objectContaining({
        adapterType: "codex_local",
      }),
    );
    expect(document.body.textContent).toContain("Give it something to do");
    expect(document.body.textContent).toContain("Add-agent onboarding");
    expect(document.body.textContent).toContain("Acme Audit (ACME)");
    expect(document.body.textContent).not.toContain("Name your company");
  });

  it("keeps the global onboarding route global when route params are unavailable", async () => {
    mocks.location = { pathname: "/onboarding", search: "", hash: "" };
    mocks.params = {};
    mocks.onboardingOpen = false;
    mocks.onboardingOptions = {};
    mocks.companies = [{ id: "company-1", name: "Acme Audit", issuePrefix: "ACME" }];

    await act(async () => {
      root.render(<OnboardingWizard />);
    });
    await flush();

    expect(document.body.textContent).toContain("New company onboarding");
    expect(document.body.textContent).toContain("Choose the first agent");
    expect(document.body.textContent).toContain("Agent → Company → Task → Launch");
    expect(document.body.textContent).toContain("Company");
    expect(document.body.textContent).not.toContain("Give it something to do");
  });

  it("suppresses onboarding for an invalid company prefix even if stale dialog state is open", async () => {
    mocks.location = { pathname: "/NOPE/onboarding", search: "", hash: "" };
    mocks.params = { companyPrefix: "NOPE" };
    mocks.onboardingOpen = true;
    mocks.onboardingOptions = { initialStep: 1, companyId: "company-1" };

    await act(async () => {
      root.render(<OnboardingWizard />);
    });
    await flush();

    expect(document.body.textContent).not.toContain("Choose the first agent");
    expect(mocks.closeOnboarding).toHaveBeenCalled();
    expect(mocks.agentsCreate).not.toHaveBeenCalled();
  });
});
