import { useEffect, useMemo, useCallback } from "react";
import { useLocation, useParams, useSearchParams } from "@/lib/router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { issuesApi } from "../api/issues";
import { agentsApi } from "../api/agents";
import { projectsApi } from "../api/projects";
import { heartbeatsApi } from "../api/heartbeats";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { createIssueDetailLocationState } from "../lib/issueDetailBreadcrumb";
import { EmptyState } from "../components/EmptyState";
import { IssuesList } from "../components/IssuesList";
import { CircleDot } from "lucide-react";

export function Issues() {
  const { companyPrefix } = useParams<{ companyPrefix?: string }>();
  const { companies, selectedCompanyId, setSelectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const routeCompanyId = useMemo(() => {
    if (!companyPrefix) return null;
    const requestedPrefix = companyPrefix.toUpperCase();
    return companies.find((company) => company.issuePrefix.toUpperCase() === requestedPrefix)?.id ?? null;
  }, [companies, companyPrefix]);
  const resolvedCompanyId = routeCompanyId ?? (!companyPrefix ? selectedCompanyId : null);

  const initialSearch = searchParams.get("q") ?? "";
  const participantAgentId = searchParams.get("participantAgentId") ?? undefined;
  const handleSearchChange = useCallback((search: string) => {
    const trimmedSearch = search.trim();
    const currentSearch = new URLSearchParams(window.location.search).get("q") ?? "";
    if (currentSearch === trimmedSearch) return;

    const url = new URL(window.location.href);
    if (trimmedSearch) {
      url.searchParams.set("q", trimmedSearch);
    } else {
      url.searchParams.delete("q");
    }

    const nextUrl = `${url.pathname}${url.search}${url.hash}`;
    window.history.replaceState(window.history.state, "", nextUrl);
  }, []);

  const { data: agents } = useQuery({
    queryKey: resolvedCompanyId ? queryKeys.agents.list(resolvedCompanyId) : ["agents", "__route-pending__"],
    queryFn: () => agentsApi.list(resolvedCompanyId!),
    enabled: !!resolvedCompanyId,
  });

  const { data: projects } = useQuery({
    queryKey: resolvedCompanyId ? queryKeys.projects.list(resolvedCompanyId) : ["projects", "__route-pending__"],
    queryFn: () => projectsApi.list(resolvedCompanyId!),
    enabled: !!resolvedCompanyId,
  });

  const { data: liveRuns } = useQuery({
    queryKey: resolvedCompanyId ? queryKeys.liveRuns(resolvedCompanyId) : ["live-runs", "__route-pending__"],
    queryFn: () => heartbeatsApi.liveRunsForCompany(resolvedCompanyId!),
    enabled: !!resolvedCompanyId,
    refetchInterval: 5000,
  });

  const liveIssueIds = useMemo(() => {
    const ids = new Set<string>();
    for (const run of liveRuns ?? []) {
      if (run.issueId) ids.add(run.issueId);
    }
    return ids;
  }, [liveRuns]);

  const issueLinkState = useMemo(
    () =>
      createIssueDetailLocationState(
        "Issues",
        `${location.pathname}${location.search}${location.hash}`,
        "issues",
      ),
    [location.pathname, location.search, location.hash],
  );

  useEffect(() => {
    setBreadcrumbs([{ label: "Issues" }]);
  }, [setBreadcrumbs]);

  useEffect(() => {
    if (!routeCompanyId || routeCompanyId === selectedCompanyId) return;
    setSelectedCompanyId(routeCompanyId, { source: "route_sync" });
  }, [routeCompanyId, selectedCompanyId, setSelectedCompanyId]);

  const { data: issues, isLoading, error } = useQuery({
    queryKey: resolvedCompanyId
      ? [...queryKeys.issues.list(resolvedCompanyId), "participant-agent", participantAgentId ?? "__all__"]
      : ["issues", "__route-pending__", "participant-agent", participantAgentId ?? "__all__"],
    queryFn: () => issuesApi.list(resolvedCompanyId!, { participantAgentId }),
    enabled: !!resolvedCompanyId,
  });

  const updateIssue = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      issuesApi.update(id, data),
    onSuccess: () => {
      if (resolvedCompanyId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.issues.list(resolvedCompanyId) });
      }
    },
  });

  if (!resolvedCompanyId) {
    return <EmptyState icon={CircleDot} message="Select a company to view issues." />;
  }

  return (
    <IssuesList
      issues={issues ?? []}
      isLoading={isLoading}
      error={error as Error | null}
      agents={agents}
      projects={projects}
      liveIssueIds={liveIssueIds}
      viewStateKey="paperclip:issues-view"
      issueLinkState={issueLinkState}
      initialAssignees={searchParams.get("assignee") ? [searchParams.get("assignee")!] : undefined}
      initialSearch={initialSearch}
      onSearchChange={handleSearchChange}
      onUpdateIssue={(id, data) => updateIssue.mutate({ id, data })}
      searchFilters={participantAgentId ? { participantAgentId } : undefined}
    />
  );
}
