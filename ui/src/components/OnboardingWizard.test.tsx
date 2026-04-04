// @vitest-environment jsdom

import { act } from "react";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdapterEnvironmentTestResult } from "@papierklammer/shared";

const mocks = vi.hoisted(() => ({
  closeOnboarding: vi.fn(),
  navigate: vi.fn(),
  invalidateQueries: vi.fn(),
  setSelectedCompanyId: vi.fn(),
  companiesCreate: vi.fn(),
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
  }),
}));

vi.mock("@/lib/router", () => ({
  useLocation: () => ({ pathname: "/", search: "", hash: "" }),
  useNavigate: () => mocks.navigate,
  useParams: () => ({}),
}));

vi.mock("../context/DialogContext", () => ({
  useDialog: () => ({
    onboardingOpen: true,
    onboardingOptions: { initialStep: 2, companyId: "company-1" },
    closeOnboarding: mocks.closeOnboarding,
  }),
}));

vi.mock("../context/CompanyContext", () => ({
  useCompany: () => ({
    companies: [{ id: "company-1", name: "Acme Audit", issuePrefix: "ACME" }],
    loading: false,
    setSelectedCompanyId: mocks.setSelectedCompanyId,
  }),
}));

vi.mock("../api/companies", () => ({
  companiesApi: {
    create: mocks.companiesCreate,
  },
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

  Object.values(mocks).forEach((mock) => mock.mockReset());

  mocks.goalsList.mockResolvedValue([]);
  mocks.agentsCreate.mockResolvedValue({ id: "agent-1" });
  mocks.projectsCreate.mockResolvedValue({ id: "project-1" });
  mocks.issuesCreate.mockResolvedValue({ id: "issue-1", identifier: "ACME-1" });
  mocks.agentsWakeup.mockResolvedValue({ id: "run-1", status: "queued" });

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
    expect(getButton("Next").disabled).toBe(true);
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
});
