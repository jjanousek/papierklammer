// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";

const invalidateQueries = vi.fn();

vi.mock("@tanstack/react-query", () => ({
  useMutation: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
  useQueryClient: () => ({
    invalidateQueries,
  }),
}));

vi.mock("@/context/CompanyContext", () => ({
  useCompany: () => ({
    companies: [
      {
        id: "company-1",
        issuePrefix: "PAP",
        name: "Paperclip",
        description: "Test company",
        brandColor: null,
        logoUrl: null,
        status: "active",
        requireBoardApprovalForNewAgents: false,
      },
    ],
    selectedCompany: {
      id: "company-1",
      issuePrefix: "PAP",
      name: "Paperclip",
      description: "Test company",
      brandColor: null,
      logoUrl: null,
      status: "active",
      requireBoardApprovalForNewAgents: false,
    },
    selectedCompanyId: "company-1",
    setSelectedCompanyId: vi.fn(),
  }),
}));

vi.mock("@/context/BreadcrumbContext", () => ({
  useBreadcrumbs: () => ({ setBreadcrumbs: vi.fn() }),
}));

vi.mock("@/context/ToastContext", () => ({
  useToast: () => ({ pushToast: vi.fn() }),
}));

vi.mock("@/api/companies", () => ({
  companiesApi: {
    update: vi.fn(),
    archive: vi.fn(),
  },
}));

vi.mock("@/api/access", () => ({
  accessApi: {
    createOpenClawInvitePrompt: vi.fn(),
    getInviteOnboarding: vi.fn(),
  },
}));

vi.mock("@/api/assets", () => ({
  assetsApi: {
    uploadCompanyLogo: vi.fn(),
  },
}));

vi.mock("@/components/CompanyPatternIcon", () => ({
  CompanyPatternIcon: () => <div data-testid="company-pattern-icon" />,
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

import { CompanySettings } from "../CompanySettings";

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  invalidateQueries.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function renderCompanySettings(pathname = "/PAP/company/settings") {
  act(() => {
    root.render(
      <TooltipProvider>
        <MemoryRouter initialEntries={[pathname]}>
          <CompanySettings />
        </MemoryRouter>
      </TooltipProvider>,
    );
  });
}

describe("CompanySettings", () => {
  it("renders company package links with the active company prefix", () => {
    renderCompanySettings();

    const exportLink = container.querySelector('a[href="/PAP/company/export"]');
    const importLink = container.querySelector('a[href="/PAP/company/import"]');

    expect(exportLink?.textContent).toContain("Export");
    expect(importLink?.textContent).toContain("Import");
  });
});
