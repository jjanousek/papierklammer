import { useState, useEffect, useRef, useCallback } from "react";

export interface AgentOverview {
  agentId: string;
  name: string;
  status: string;
  activeRunCount: number;
  queuedIntentCount: number;
}

export interface RunReviewEntry {
  runId: string;
  status: string;
  agentId: string;
  agentName: string;
  issueId: string | null;
  issueIdentifier: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  resultSummaryText: string | null;
  stdoutExcerpt: string | null;
  stderrExcerpt: string | null;
}

export interface StatusResponse {
  agents: AgentOverview[];
  totalActiveRuns: number;
  totalQueuedIntents: number;
  totalActiveLeases: number;
  activeRuns?: RunReviewEntry[];
  recentRuns?: RunReviewEntry[];
}

export interface OrchestratorStatusResult {
  agents: AgentOverview[];
  totalActiveRuns: number;
  totalAgents: number;
  connected: boolean;
  error: string | null;
  activeRuns: RunReviewEntry[];
  recentRuns: RunReviewEntry[];
  refresh: () => Promise<void>;
}

/**
 * Polls GET /api/orchestrator/status every `intervalMs` milliseconds.
 *
 * Uses raw fetch (not OrchestratorClient) to keep the TUI package
 * dependency-free of the console package at runtime, while still
 * being compatible with the same API surface.
 */
export function useOrchestratorStatus(
  url: string,
  apiKey: string,
  companyId: string,
  intervalMs = 5000,
  fetchFn: typeof globalThis.fetch = globalThis.fetch,
): OrchestratorStatusResult {
  const [agents, setAgents] = useState<AgentOverview[]>([]);
  const [totalActiveRuns, setTotalActiveRuns] = useState(0);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeRuns, setActiveRuns] = useState<RunReviewEntry[]>([]);
  const [recentRuns, setRecentRuns] = useState<RunReviewEntry[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const poll = useCallback(async () => {
    if (!companyId) {
      setAgents([]);
      setTotalActiveRuns(0);
      setConnected(false);
      setError(null);
      setActiveRuns([]);
      setRecentRuns([]);
      return;
    }

    try {
      const endpoint = `${url.replace(/\/+$/, "")}/api/orchestrator/status?companyId=${encodeURIComponent(companyId)}`;
      const res = await fetchFn(endpoint, {
        headers: {
          accept: "application/json",
          authorization: `Bearer ${apiKey}`,
        },
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const data = (await res.json()) as StatusResponse;
      const normalizedAgents = Array.isArray(data.agents)
        ? data.agents.map((agent) => ({
            agentId:
              typeof agent.agentId === "string"
                ? agent.agentId
                : String((agent as AgentOverview & { id?: string }).id ?? ""),
            name: agent.name,
            status: agent.status,
            activeRunCount: agent.activeRunCount,
            queuedIntentCount: agent.queuedIntentCount,
          }))
        : [];
      setAgents(normalizedAgents);
      setTotalActiveRuns(data.totalActiveRuns);
      setActiveRuns(Array.isArray(data.activeRuns) ? data.activeRuns : []);
      setRecentRuns(Array.isArray(data.recentRuns) ? data.recentRuns : []);
      setConnected(true);
      setError(null);
    } catch (err) {
      setAgents([]);
      setTotalActiveRuns(0);
      setActiveRuns([]);
      setRecentRuns([]);
      setConnected(false);
      setError(err instanceof Error ? err.message : "Unknown error");
    }
  }, [url, apiKey, companyId, fetchFn]);

  useEffect(() => {
    // Initial poll
    void poll();

    // Set up interval
    timerRef.current = setInterval(() => {
      void poll();
    }, intervalMs);

    return () => {
      if (timerRef.current !== null) {
        clearInterval(timerRef.current);
      }
    };
  }, [poll, intervalMs]);

  return {
    agents,
    totalActiveRuns,
    totalAgents: agents.length,
    connected,
    error,
    activeRuns,
    recentRuns,
    refresh: poll,
  };
}
