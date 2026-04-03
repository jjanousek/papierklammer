import { useState, useEffect, useMemo } from "react";
import { Link, useNavigate, useLocation } from "@/lib/router";
import { useQuery } from "@tanstack/react-query";
import { agentsApi, type OrgNode } from "../api/agents";
import { heartbeatsApi, type LiveRunForIssue } from "../api/heartbeats";
import { useCompany } from "../context/CompanyContext";
import { useDialog } from "../context/DialogContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useSidebar } from "../context/SidebarContext";
import { queryKeys } from "../lib/queryKeys";
import { StatusBadge } from "../components/StatusBadge";
import { agentStatusDot, agentStatusDotDefault } from "../lib/status-colors";
import { EntityRow } from "../components/EntityRow";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import { relativeTime, cn, agentRouteRef, agentUrl } from "../lib/utils";
import { PageTabBar } from "../components/PageTabBar";
import { Tabs } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Bot, Plus, List, GitBranch, SlidersHorizontal } from "lucide-react";
import { AGENT_ROLE_LABELS, type Agent } from "@papierklammer/shared";
import { TierColumn, type TierInfo } from "../components/TierColumn";

const adapterLabels: Record<string, string> = {
  claude_local: "Claude",
  codex_local: "Codex",
  gemini_local: "Gemini",
  opencode_local: "OpenCode",
  cursor: "Cursor",
  hermes_local: "Hermes",
  openclaw_gateway: "OpenClaw Gateway",
  process: "Process",
  http: "HTTP",
};

const roleLabels = AGENT_ROLE_LABELS as Record<string, string>;

type FilterTab = "all" | "active" | "idle";

function matchesFilter(status: string, tab: FilterTab, showTerminated: boolean): boolean {
  if (status === "terminated") return showTerminated;
  if (tab === "all") return true;
  if (tab === "active") return status === "active" || status === "running";
  if (tab === "idle") return status === "idle" || status === "paused" || status === "error";
  return true;
}

function filterAgents(agents: Agent[], tab: FilterTab, showTerminated: boolean): Agent[] {
  return agents
    .filter((a) => matchesFilter(a.status, tab, showTerminated))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Flatten org tree to a depth map */
function flattenOrgTree(
  nodes: OrgNode[],
  depth: number,
  out: Map<string, number>,
): void {
  for (const node of nodes) {
    out.set(node.id, depth);
    if (node.reports && node.reports.length > 0) {
      flattenOrgTree(node.reports, depth + 1, out);
    }
  }
}

function tierLabel(depth: number): string {
  if (depth === 0) return "Executive";
  if (depth === 1) return "Leads";
  return "Workers";
}

function tierFlex(depth: number): number {
  if (depth === 0) return 3;
  if (depth === 1) return 2.5;
  return 4;
}

function sortAgentsByActivity(
  agents: Agent[],
  runs: Map<string, LiveRunForIssue>,
): Agent[] {
  return [...agents].sort((a, b) => {
    const runA = runs.get(a.id);
    const runB = runs.get(b.id);
    const prioA = agentActivityPriority(a, runA);
    const prioB = agentActivityPriority(b, runB);
    if (prioA !== prioB) return prioA - prioB;
    const elapsedA = runA?.startedAt ? Date.now() - new Date(runA.startedAt).getTime() : 0;
    const elapsedB = runB?.startedAt ? Date.now() - new Date(runB.startedAt).getTime() : 0;
    return elapsedB - elapsedA;
  });
}

function agentActivityPriority(agent: Agent, run?: LiveRunForIssue): number {
  if (run?.status === "running" || run?.status === "queued") return 0;
  if (agent.status === "active" || agent.status === "running") return 0;
  if (agent.status === "paused" || agent.status === "pending_approval") return 1;
  return 2;
}

export function Agents() {
  const { selectedCompanyId } = useCompany();
  const { openNewAgent } = useDialog();
  const { setBreadcrumbs } = useBreadcrumbs();
  const navigate = useNavigate();
  const location = useLocation();
  const { isMobile } = useSidebar();
  const pathSegment = location.pathname.split("/").pop() ?? "all";
  const tab: FilterTab = (pathSegment === "all" || pathSegment === "active" || pathSegment === "idle") ? pathSegment : "all";
  const [view, setView] = useState<"list" | "org">("org");
  const forceListView = isMobile;
  const effectiveView: "list" | "org" = forceListView ? "list" : view;
  const [showTerminated, setShowTerminated] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const { data: agents, isLoading, error } = useQuery({
    queryKey: queryKeys.agents.list(selectedCompanyId!),
    queryFn: () => agentsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const { data: orgTree } = useQuery({
    queryKey: queryKeys.org(selectedCompanyId!),
    queryFn: () => agentsApi.org(selectedCompanyId!),
    enabled: !!selectedCompanyId && effectiveView === "org",
  });

  const { data: runs } = useQuery({
    queryKey: queryKeys.heartbeats(selectedCompanyId!),
    queryFn: () => heartbeatsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
    refetchInterval: 15_000,
  });

  // Map agentId -> first live run + live run count
  const liveRunByAgent = useMemo(() => {
    const map = new Map<string, { runId: string; liveCount: number }>();
    for (const r of runs ?? []) {
      if (r.status !== "running" && r.status !== "queued") continue;
      const existing = map.get(r.agentId);
      if (existing) {
        existing.liveCount += 1;
        continue;
      }
      map.set(r.agentId, { runId: r.id, liveCount: 1 });
    }
    return map;
  }, [runs]);

  // Fetch live runs for tier columns
  const { data: liveRuns } = useQuery({
    queryKey: [...queryKeys.liveRuns(selectedCompanyId!), "agents-page"],
    queryFn: () => heartbeatsApi.liveRunsForCompany(selectedCompanyId!),
    enabled: !!selectedCompanyId && effectiveView === "org",
    refetchInterval: 5000,
  });

  const agentMap = useMemo(() => {
    const map = new Map<string, Agent>();
    for (const a of agents ?? []) map.set(a.id, a);
    return map;
  }, [agents]);

  // Build run-by-agent map for tier columns
  const runByAgentId = useMemo(() => {
    const map = new Map<string, LiveRunForIssue>();
    for (const run of liveRuns ?? []) {
      const existing = map.get(run.agentId);
      if (!existing || new Date(run.createdAt) > new Date(existing.createdAt)) {
        map.set(run.agentId, run);
      }
    }
    return map;
  }, [liveRuns]);

  // Build org depth map for tier column grouping
  const agentDepthMap = useMemo(() => {
    const map = new Map<string, number>();
    if (orgTree) {
      flattenOrgTree(orgTree, 0, map);
    }
    return map;
  }, [orgTree]);

  // Group agents into tiers for org view
  const displayTiers = useMemo((): TierInfo[] => {
    if (!agents) return [];
    const filteredAgentsList = filterAgents(agents, tab, showTerminated);

    const tierBuckets = new Map<number, Agent[]>();
    for (const agent of filteredAgentsList) {
      const depth = agentDepthMap.get(agent.id) ?? 2;
      if (!tierBuckets.has(depth)) tierBuckets.set(depth, []);
      tierBuckets.get(depth)!.push(agent);
    }

    // If no org tree, group by role
    if (!orgTree || orgTree.length === 0) {
      const executive: Agent[] = [];
      const leads: Agent[] = [];
      const workers: Agent[] = [];
      for (const agent of filteredAgentsList) {
        if (agent.role === "ceo" || agent.role === "cto" || agent.role === "cfo" || agent.role === "cmo") {
          executive.push(agent);
        } else if (agent.role === "pm" || agent.role === "qa") {
          leads.push(agent);
        } else {
          workers.push(agent);
        }
      }
      return [
        { label: "Executive", rank: 0, agents: sortAgentsByActivity(executive, runByAgentId), runs: runByAgentId },
        { label: "Leads", rank: 1, agents: sortAgentsByActivity(leads, runByAgentId), runs: runByAgentId },
        { label: "Workers", rank: 2, agents: sortAgentsByActivity(workers, runByAgentId), runs: runByAgentId },
      ];
    }

    const depths = [...tierBuckets.keys()].sort((a, b) => a - b);
    const tiers = depths.map((depth) => ({
      label: tierLabel(depth),
      rank: depth,
      agents: sortAgentsByActivity(tierBuckets.get(depth)!, runByAgentId),
      runs: runByAgentId,
    }));

    // Ensure at least 3 tiers
    if (tiers.length < 3) {
      const result = [...tiers];
      for (let i = 0; i < 3; i++) {
        if (!result.some((t) => t.rank === i)) {
          result.push({ label: tierLabel(i), rank: i, agents: [], runs: runByAgentId });
        }
      }
      result.sort((a, b) => a.rank - b.rank);
      return result;
    }

    return tiers;
  }, [agents, orgTree, agentDepthMap, runByAgentId, tab, showTerminated]);

  useEffect(() => {
    setBreadcrumbs([{ label: "Agents" }]);
  }, [setBreadcrumbs]);

  if (!selectedCompanyId) {
    return <EmptyState icon={Bot} message="Select a company to view agents." />;
  }

  if (isLoading) {
    return <PageSkeleton variant="list" />;
  }

  const filtered = filterAgents(agents ?? [], tab, showTerminated);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Tabs value={tab} onValueChange={(v) => navigate(`/agents/${v}`)}>
          <PageTabBar
            items={[
              { value: "all", label: "All" },
              { value: "active", label: "Active" },
              { value: "idle", label: "Idle" },
            ]}
            value={tab}
            onValueChange={(v) => navigate(`/agents/${v}`)}
          />
        </Tabs>
        <div className="flex items-center gap-2">
          {/* Filters */}
          <div className="relative">
            <Button
              variant="ghost"
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 border border-white bg-transparent",
                filtersOpen || showTerminated ? "text-foreground" : "text-white"
              )}
              onClick={() => setFiltersOpen(!filtersOpen)}
            >
              <SlidersHorizontal className="h-3 w-3" />
              Filters
              {showTerminated && <span className="ml-0.5 px-1 bg-foreground/10 text-[10px]">1</span>}
            </Button>
            {filtersOpen && (
              <div className="absolute right-0 top-full mt-1 z-50 w-48 border border-[var(--border-strong)] bg-[var(--bg-dark)] p-1">
                <Button
                  variant="ghost"
                  className="flex items-center gap-2 w-full px-2 py-1.5 text-left justify-start h-auto"
                  onClick={() => setShowTerminated(!showTerminated)}
                >
                  <span className={cn(
                    "flex items-center justify-center h-3.5 w-3.5 border border-[var(--border-strong)]",
                    showTerminated && "bg-white"
                  )}>
                    {showTerminated && <span className="text-[var(--bg-darker)] text-[10px] leading-none">&#10003;</span>}
                  </span>
                  Show terminated
                </Button>
              </div>
            )}
          </div>
          {/* View toggle */}
          {!forceListView && (
            <div className="flex items-center border border-border">
              <Button
                variant="ghost"
                className={cn(
                  "p-1.5 border border-white bg-transparent h-auto",
                  effectiveView === "list" ? "text-foreground" : "text-muted-foreground"
                )}
                onClick={() => setView("list")}
              >
                <List className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                className={cn(
                  "p-1.5 border border-white bg-transparent h-auto",
                  effectiveView === "org" ? "text-foreground" : "text-muted-foreground"
                )}
                onClick={() => setView("org")}
              >
                <GitBranch className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}
          <Button size="sm" variant="outline" onClick={openNewAgent}>
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            New Agent
          </Button>
        </div>
      </div>

      {filtered.length > 0 && (
        <p className="text-[10px] font-mono text-[var(--fg-dim)]">{filtered.length} agent{filtered.length !== 1 ? "s" : ""}</p>
      )}

      {error && <p className="text-sm text-destructive">{error.message}</p>}

      {agents && agents.length === 0 && (
        <EmptyState
          icon={Bot}
          message="Create your first agent to get started."
          action="New Agent"
          onAction={openNewAgent}
        />
      )}

      {/* List view */}
      {effectiveView === "list" && filtered.length > 0 && (
        <div className="border border-border">
          {filtered.map((agent) => {
            return (
              <EntityRow
                key={agent.id}
                title={agent.name}
                subtitle={`${roleLabels[agent.role] ?? agent.role}${agent.title ? ` - ${agent.title}` : ""}`}
                to={agentUrl(agent)}
                leading={
                  <span className="relative flex h-1.5 w-1.5">
                    <span
                      className={`absolute inline-flex h-full w-full ${agentStatusDot[agent.status] ?? agentStatusDotDefault}`}
                    />
                  </span>
                }
                trailing={
                  <div className="flex items-center gap-3">
                    <span className="sm:hidden">
                      {liveRunByAgent.has(agent.id) ? (
                        <LiveRunIndicator
                          agentRef={agentRouteRef(agent)}
                          runId={liveRunByAgent.get(agent.id)!.runId}
                          liveCount={liveRunByAgent.get(agent.id)!.liveCount}
                        />
                      ) : (
                        <StatusBadge status={agent.status} />
                      )}
                    </span>
                    <div className="hidden sm:flex items-center gap-3">
                      {liveRunByAgent.has(agent.id) && (
                        <LiveRunIndicator
                          agentRef={agentRouteRef(agent)}
                          runId={liveRunByAgent.get(agent.id)!.runId}
                          liveCount={liveRunByAgent.get(agent.id)!.liveCount}
                        />
                      )}
                      <span className="text-[10px] text-[var(--fg-dim)] font-mono w-14 text-right">
                        {adapterLabels[agent.adapterType] ?? agent.adapterType}
                      </span>
                      <span className="text-[10px] text-[var(--fg-dim)] font-mono w-16 text-right">
                        {agent.lastHeartbeatAt ? relativeTime(agent.lastHeartbeatAt) : "—"}
                      </span>
                      <span className="w-20 flex justify-end">
                        <StatusBadge status={agent.status} />
                      </span>
                    </div>
                  </div>
                }
              />
            );
          })}
        </div>
      )}

      {effectiveView === "list" && agents && agents.length > 0 && filtered.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-8">
          No agents match the selected filter.
        </p>
      )}

      {/* Org view — horizontal tier columns */}
      {effectiveView === "org" && displayTiers.length > 0 && (
        <div
          className="border border-[var(--border)] overflow-hidden"
          style={{ display: "flex", height: "calc(100vh - 200px)", minHeight: "300px" }}
        >
          {displayTiers.map((tier) => (
            <TierColumn
              key={tier.rank}
              tier={tier}
              style={{ flex: tierFlex(tier.rank) }}
            />
          ))}
        </div>
      )}

      {effectiveView === "org" && agents && agents.length > 0 && displayTiers.every((t) => t.agents.length === 0) && (
        <p className="text-[11px] font-mono text-[var(--fg-muted)] text-center py-8">
          No agents match the selected filter.
        </p>
      )}
    </div>
  );
}



function LiveRunIndicator({
  agentRef,
  runId,
  liveCount,
}: {
  agentRef: string;
  runId: string;
  liveCount: number;
}) {
  return (
    <Link
      to={`/agents/${agentRef}/runs/${runId}`}
      className="flex items-center gap-1.5 px-2 py-0.5 bg-[var(--alive)]/10 hover:opacity-80 no-underline"
      onClick={(e) => e.stopPropagation()}
    >
      <span className="relative flex h-1.5 w-1.5">
        <span className="relative inline-flex h-1.5 w-1.5 bg-[var(--alive)]" />
      </span>
      <span className="text-[11px] font-medium text-[var(--alive)]">
        Live{liveCount > 1 ? ` (${liveCount})` : ""}
      </span>
    </Link>
  );
}
