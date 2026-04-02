import { useState, useEffect, useRef, useCallback } from "react";

export interface AgentOverview {
  agentId: string;
  name: string;
  status: string;
  activeRunCount: number;
  queuedIntentCount: number;
}

export interface StatusResponse {
  agents: AgentOverview[];
  totalActiveRuns: number;
  totalQueuedIntents: number;
  totalActiveLeases: number;
}

export interface OrchestratorStatusResult {
  agents: AgentOverview[];
  totalActiveRuns: number;
  totalAgents: number;
  connected: boolean;
  error: string | null;
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
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const poll = useCallback(async () => {
    if (!companyId) {
      setAgents([]);
      setTotalActiveRuns(0);
      setConnected(false);
      setError(null);
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
      setAgents(data.agents);
      setTotalActiveRuns(data.totalActiveRuns);
      setConnected(true);
      setError(null);
    } catch (err) {
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
  };
}
