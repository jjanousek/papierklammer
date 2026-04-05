import { useCallback, useEffect, useRef, useState } from "react";
import {
  listPendingApprovals,
  type PendingApprovalSummary,
} from "../lib/managementApi.js";

export interface PendingApprovalsResult {
  approvals: PendingApprovalSummary[];
  error: string | null;
  refresh: () => Promise<void>;
}

export function usePendingApprovals(
  url: string,
  apiKey: string,
  companyId: string,
  intervalMs = 5000,
  fetchFn: typeof globalThis.fetch = globalThis.fetch,
): PendingApprovalsResult {
  const [approvals, setApprovals] = useState<PendingApprovalSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    if (!companyId) {
      setApprovals([]);
      setError(null);
      return;
    }

    try {
      const result = await listPendingApprovals(url, apiKey, companyId, fetchFn);
      setApprovals(result);
      setError(null);
    } catch (err) {
      setApprovals([]);
      setError(err instanceof Error ? err.message : "Unknown error");
    }
  }, [url, apiKey, companyId, fetchFn]);

  useEffect(() => {
    void refresh();

    timerRef.current = setInterval(() => {
      void refresh();
    }, intervalMs);

    return () => {
      if (timerRef.current !== null) {
        clearInterval(timerRef.current);
      }
    };
  }, [refresh, intervalMs]);

  return {
    approvals,
    error,
    refresh,
  };
}
