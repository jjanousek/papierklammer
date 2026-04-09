import { useState, useEffect, useRef, useCallback } from "react";
import { listCompanyIssues, type CompanyIssueSummary } from "../lib/managementApi.js";

export interface CompanyIssuesResult {
  issues: CompanyIssueSummary[];
  connected: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useCompanyIssues(
  url: string,
  apiKey: string,
  companyId: string,
  intervalMs = 5000,
  fetchFn: typeof globalThis.fetch = globalThis.fetch,
): CompanyIssuesResult {
  const [issues, setIssues] = useState<CompanyIssueSummary[]>([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const poll = useCallback(async () => {
    if (!companyId) {
      setIssues([]);
      setConnected(false);
      setError(null);
      return;
    }

    try {
      const nextIssues = await listCompanyIssues(url, apiKey, companyId, fetchFn);
      setIssues(nextIssues);
      setConnected(true);
      setError(null);
    } catch (err) {
      setIssues([]);
      setConnected(false);
      setError(err instanceof Error ? err.message : "Unknown error");
    }
  }, [apiKey, companyId, fetchFn, url]);

  useEffect(() => {
    void poll();
    timerRef.current = setInterval(() => {
      void poll();
    }, intervalMs);

    return () => {
      if (timerRef.current !== null) {
        clearInterval(timerRef.current);
      }
    };
  }, [intervalMs, poll]);

  return {
    issues,
    connected,
    error,
    refresh: poll,
  };
}
