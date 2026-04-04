import type { HeartbeatRun } from "@papierklammer/shared";

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

export function readIssueIdFromRunContext(context: Record<string, unknown> | null | undefined): string | null {
  if (!context) return null;
  return asNonEmptyString(context.issueId) ?? asNonEmptyString(context.taskId);
}

export function readIssueIdFromHeartbeatRun(run: Pick<HeartbeatRun, "contextSnapshot">): string | null {
  return readIssueIdFromRunContext(run.contextSnapshot);
}

export function formatCompanyIdentity(companyId: string, companyIssuePrefix?: string | null): string {
  const prefix = asNonEmptyString(companyIssuePrefix);
  return prefix ? `${prefix} · ${companyId}` : companyId;
}
