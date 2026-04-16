type OnboardingRouteCompany = {
  id: string;
  issuePrefix: string;
};

export type RouteOnboardingEntry =
  | { kind: "global"; initialStep: 1 }
  | { kind: "company"; initialStep: 1; companyId: string }
  | { kind: "invalid_company_prefix"; initialStep: 1; companyPrefix: string };

export function isOnboardingPath(pathname: string): boolean {
  const segments = pathname.split("/").filter(Boolean);

  if (segments.length === 1) {
    return segments[0]?.toLowerCase() === "onboarding";
  }

  if (segments.length === 2) {
    return segments[1]?.toLowerCase() === "onboarding";
  }

  return false;
}

export function resolveRouteOnboardingOptions(params: {
  pathname: string;
  companyPrefix?: string;
  companies: OnboardingRouteCompany[];
}): { initialStep: 1; companyId?: string } | null {
  const entry = resolveRouteOnboardingEntry(params);
  if (!entry || entry.kind === "invalid_company_prefix") return null;
  if (entry.kind === "company") {
    return { initialStep: 1, companyId: entry.companyId };
  }
  return { initialStep: 1 };
}

export function resolveRouteOnboardingEntry(params: {
  pathname: string;
  companyPrefix?: string;
  companies: OnboardingRouteCompany[];
}): RouteOnboardingEntry | null {
  const { pathname, companyPrefix, companies } = params;

  if (!isOnboardingPath(pathname)) return null;

  if (!companyPrefix) {
    return { kind: "global", initialStep: 1 };
  }

  const matchedCompany =
    companies.find(
      (company) =>
        company.issuePrefix.toUpperCase() === companyPrefix.toUpperCase(),
    ) ?? null;

  if (matchedCompany) {
    return { kind: "company", initialStep: 1, companyId: matchedCompany.id };
  }

  if (companies.length === 0) {
    return { kind: "global", initialStep: 1 };
  }

  return {
    kind: "invalid_company_prefix",
    initialStep: 1,
    companyPrefix,
  };
}

export function shouldRedirectCompanylessRouteToOnboarding(params: {
  pathname: string;
  hasCompanies: boolean;
}): boolean {
  return !params.hasCompanies && !isOnboardingPath(params.pathname);
}
