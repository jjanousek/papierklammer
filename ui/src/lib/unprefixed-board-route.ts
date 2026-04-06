export type UnprefixedRouteCompany = {
  id: string;
  issuePrefix: string;
};

export function findCompanyForIssuePathId<T extends UnprefixedRouteCompany>(params: {
  companies: T[];
  issueId: string | null | undefined;
}): T | null {
  const issueId = params.issueId?.trim();
  if (!issueId) return null;

  const identifierMatch = /^([A-Za-z][A-Za-z0-9]*)-\d+$/.exec(issueId);
  if (!identifierMatch) return null;

  const requestedPrefix = identifierMatch[1]!.toUpperCase();
  return params.companies.find((company) => company.issuePrefix.toUpperCase() === requestedPrefix) ?? null;
}

export function resolveUnprefixedBoardTargetCompany<T extends UnprefixedRouteCompany>(params: {
  companies: T[];
  selectedCompanyId: string | null;
  routeIssueId?: string | null;
  issueCompanyId?: string | null;
}): T | null {
  const companyFromIssuePath = findCompanyForIssuePathId({
    companies: params.companies,
    issueId: params.routeIssueId,
  });
  if (companyFromIssuePath) return companyFromIssuePath;

  if (params.issueCompanyId) {
    const companyFromIssue = params.companies.find((company) => company.id === params.issueCompanyId) ?? null;
    if (companyFromIssue) return companyFromIssue;
  }

  if (params.selectedCompanyId) {
    const selectedCompany = params.companies.find((company) => company.id === params.selectedCompanyId) ?? null;
    if (selectedCompany) return selectedCompany;
  }

  return params.companies[0] ?? null;
}
