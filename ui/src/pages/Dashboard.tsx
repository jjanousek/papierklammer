import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { dashboardApi } from "../api/dashboard";
import { agentsApi, type OrgNode } from "../api/agents";
import { heartbeatsApi, type LiveRunForIssue } from "../api/heartbeats";
import { issuesApi } from "../api/issues";
import { useCompany } from "../context/CompanyContext";
import { useDialog } from "../context/DialogContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { formatCents, formatTokens } from "../lib/utils";
import { LayoutDashboard } from "lucide-react";
import { EmptyState } from "../components/EmptyState";
import { TopBar } from "../components/TopBar";
import { MetricsStrip } from "../components/MetricsStrip";
import { TierColumn, type TierInfo } from "../components/TierColumn";
import { useLiveRunTranscripts } from "../components/transcript/useLiveRunTranscripts";
import type { StreamEntry } from "../components/AgentBlock";
import type { TranscriptEntry } from "../adapters";

import type { Agent } from "@papierklammer/shared";

const MIN_DASHBOARD_RUNS = 8;
export const MAX_STREAM_ENTRIES_PER_AGENT = 20;

/** Convert adapter transcript entries into lightweight StreamEntry items for AgentBlock. */
function transcriptToStreamEntries(entries: TranscriptEntry[]): StreamEntry[] {
  const result: StreamEntry[] = [];
  for (const entry of entries.slice(-MAX_STREAM_ENTRIES_PER_AGENT)) {
    switch (entry.kind) {
      case "thinking":
      case "assistant":
        result.push({ type: "reasoning", text: entry.text });
        break;
      case "tool_call": {
        const argsStr = entry.input
          ? typeof entry.input === "string"
            ? entry.input.slice(0, 200)
            : JSON.stringify(entry.input).slice(0, 200)
          : "";
        result.push({
          type: "tool_call",
          text: argsStr ? `${entry.name} ${argsStr}` : entry.name,
        });
        break;
      }
      case "tool_result":
        result.push({ type: "tool_result", text: entry.content.slice(0, 200) });
        break;
      case "stderr":
        result.push({ type: "error", text: entry.text.slice(0, 200) });
        break;
      case "system":
        if (entry.text.toLowerCase().includes("delegat")) {
          result.push({ type: "delegation", text: entry.text.slice(0, 200) });
        }
        break;
      default:
        break;
    }
  }
  return result;
}

/**
 * Classify an agent's hierarchy tier from org tree.
 * Tier 0 = executive (no parent), 1 = leads, 2+ = workers.
 */
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

/**
 * Sort agents: active/running first (longest elapsed first),
 * then waiting/queued, then idle/completed.
 */
function sortAgentsByActivity(
  agents: Agent[],
  runs: Map<string, LiveRunForIssue>,
): Agent[] {
  return [...agents].sort((a, b) => {
    const runA = runs.get(a.id);
    const runB = runs.get(b.id);
    const prioA = activityPriority(a, runA);
    const prioB = activityPriority(b, runB);
    if (prioA !== prioB) return prioA - prioB;
    // Within same priority, sort by elapsed time (longest first)
    const elapsedA = runA?.startedAt ? Date.now() - new Date(runA.startedAt).getTime() : 0;
    const elapsedB = runB?.startedAt ? Date.now() - new Date(runB.startedAt).getTime() : 0;
    return elapsedB - elapsedA;
  });
}

function activityPriority(agent: Agent, run?: LiveRunForIssue): number {
  if (run?.status === "running" || run?.status === "queued") return 0;
  if (agent.status === "active" || agent.status === "running") return 0;
  if (agent.status === "paused" || agent.status === "pending_approval") return 1;
  return 2;
}

export function Dashboard() {
  const { selectedCompanyId, companies } = useCompany();
  const { openOnboarding } = useDialog();
  const { setBreadcrumbs } = useBreadcrumbs();


  useEffect(() => {
    setBreadcrumbs([{ label: "Dashboard" }]);
  }, [setBreadcrumbs]);

  const { data: agents } = useQuery({
    queryKey: queryKeys.agents.list(selectedCompanyId!),
    queryFn: () => agentsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const { data: orgNodes } = useQuery({
    queryKey: [...queryKeys.agents.list(selectedCompanyId!), "org"],
    queryFn: () => agentsApi.org(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const { data: summary } = useQuery({
    queryKey: queryKeys.dashboard(selectedCompanyId!),
    queryFn: () => dashboardApi.summary(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const { data: liveRuns } = useQuery({
    queryKey: [...queryKeys.liveRuns(selectedCompanyId!), "dashboard"],
    queryFn: () => heartbeatsApi.liveRunsForCompany(selectedCompanyId!, MIN_DASHBOARD_RUNS),
    enabled: !!selectedCompanyId,
    refetchInterval: 5000,
  });

  const { data: issues } = useQuery({
    queryKey: queryKeys.issues.list(selectedCompanyId!),
    queryFn: () => issuesApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  // Fetch live transcripts for running agents
  const { transcriptByRun } = useLiveRunTranscripts({
    runs: liveRuns ?? [],
    companyId: selectedCompanyId,
    maxChunksPerRun: 50,
  });

  // Build a map: agentId → latest run
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

  // Build a map: agentId → StreamEntry[] from live transcripts
  const streamsByAgent = useMemo(() => {
    const map = new Map<string, StreamEntry[]>();
    for (const run of liveRuns ?? []) {
      const entries = transcriptByRun.get(run.id);
      if (!entries || entries.length === 0) continue;
      const streams = transcriptToStreamEntries(entries);
      if (streams.length > 0) {
        map.set(run.agentId, streams);
      }
    }
    return map;
  }, [liveRuns, transcriptByRun]);

  // Build org depth map
  const agentDepthMap = useMemo(() => {
    const map = new Map<string, number>();
    if (orgNodes) {
      flattenOrgTree(orgNodes, 0, map);
    }
    return map;
  }, [orgNodes]);

  const issueReferenceById = useMemo(() => {
    const map = new Map<string, string>();
    for (const issue of issues ?? []) {
      map.set(issue.id, issue.identifier ?? issue.id);
    }
    return map;
  }, [issues]);

  const issueHrefById = useMemo(() => {
    const map = new Map<string, string>();
    for (const issue of issues ?? []) {
      map.set(issue.id, `/issues/${issue.identifier ?? issue.id}`);
    }
    return map;
  }, [issues]);

  // Group agents into tiers
  const tiers = useMemo((): TierInfo[] => {
    if (!agents) return [];

    // Build tier buckets
    const tierBuckets = new Map<number, Agent[]>();
    for (const agent of agents) {
      if (agent.status === "terminated") continue;
      const depth = agentDepthMap.get(agent.id) ?? 2; // default to workers
      if (!tierBuckets.has(depth)) tierBuckets.set(depth, []);
      tierBuckets.get(depth)!.push(agent);
    }

    // If there are no org nodes, create a simple grouping based on role
    if (!orgNodes || orgNodes.length === 0) {
      const executive: Agent[] = [];
      const leads: Agent[] = [];
      const workers: Agent[] = [];
      for (const agent of agents) {
        if (agent.status === "terminated") continue;
        if (agent.role === "ceo" || agent.role === "cto" || agent.role === "cfo" || agent.role === "cmo") {
          executive.push(agent);
        } else if (agent.role === "pm" || agent.role === "qa") {
          leads.push(agent);
        } else {
          workers.push(agent);
        }
      }
      const result: TierInfo[] = [];
      result.push({ label: "Executive", rank: 0, agents: sortAgentsByActivity(executive, runByAgentId), runs: runByAgentId, streams: streamsByAgent });
      result.push({ label: "Leads", rank: 1, agents: sortAgentsByActivity(leads, runByAgentId), runs: runByAgentId, streams: streamsByAgent });
      result.push({ label: "Workers", rank: 2, agents: sortAgentsByActivity(workers, runByAgentId), runs: runByAgentId, streams: streamsByAgent });
      return result;
    }

    // Sort depths and create tier infos
    const depths = [...tierBuckets.keys()].sort((a, b) => a - b);
    return depths.map((depth) => ({
      label: tierLabel(depth),
      rank: depth,
      agents: sortAgentsByActivity(tierBuckets.get(depth)!, runByAgentId),
      runs: runByAgentId,
      streams: streamsByAgent,
    }));
  }, [agents, orgNodes, agentDepthMap, runByAgentId, streamsByAgent]);

  // Ensure we always have 3 tiers minimum
  const displayTiers = useMemo(() => {
    if (tiers.length >= 3) return tiers;
    const result = [...tiers];
    const existingRanks = new Set(result.map((t) => t.rank));
    for (let i = 0; i < 3; i++) {
      if (!existingRanks.has(i)) {
        result.push({ label: tierLabel(i), rank: i, agents: [], runs: runByAgentId, streams: streamsByAgent });
      }
    }
    return result.sort((a, b) => a.rank - b.rank);
  }, [tiers, runByAgentId]);

  // Metrics
  const activeCount = useMemo(() => {
    if (!agents) return 0;
    return agents.filter((a) => {
      const run = runByAgentId.get(a.id);
      return run?.status === "running" || run?.status === "queued" || a.status === "running";
    }).length;
  }, [agents, runByAgentId]);

  const idleCount = useMemo(() => {
    if (!agents) return 0;
    return agents.filter((a) => a.status !== "terminated").length - activeCount;
  }, [agents, activeCount]);

  const metrics = useMemo(() => {
    const totalTokens = summary?.costs?.monthSpendCents ? "—" : "—";
    const agentCount = agents?.filter((a) => a.status !== "terminated").length ?? 0;
    const maxDepth = agentDepthMap.size > 0 ? Math.max(...agentDepthMap.values()) + 1 : 0;
    const cost = summary?.costs ? formatCents(summary.costs.monthSpendCents) : "$0.00";

    return [
      { label: "TOTAL TOKENS", value: totalTokens },
      { label: "AGENTS", value: String(agentCount) },
      { label: "DEPTH", value: String(maxDepth) },
      { label: "ELAPSED", value: "—" },
      { label: "COST", value: cost },
    ];
  }, [summary, agents, agentDepthMap]);



  if (!selectedCompanyId) {
    if (companies.length === 0) {
      return (
        <EmptyState
          icon={LayoutDashboard}
          message="Welcome to Paperclip. Set up your first company and agent to get started."
          action="Get Started"
          onAction={openOnboarding}
        />
      );
    }
    return (
      <EmptyState icon={LayoutDashboard} message="Create or select a company to view the dashboard." />
    );
  }

  if (!agents) {
    return (
      <div className="flex items-center justify-center h-full">
        <span style={{ fontSize: "10px", color: "var(--fg-dim)" }}>loading...</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full w-full" style={{ background: "var(--bg)" }}>
      <TopBar
        activeCount={activeCount}
        idleCount={idleCount}
      />
      <MetricsStrip metrics={metrics} />

      {/* Tier columns - horizontal row */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {displayTiers.map((tier) => (
          <TierColumn
            key={tier.rank}
            tier={tier}
            issueReferences={issueReferenceById}
            issueHrefs={issueHrefById}
            style={{ flex: tierFlex(tier.rank) }}
          />
        ))}
      </div>

    </div>
  );
}
