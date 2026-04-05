import type { Issue, IssueStatus } from "@papierklammer/shared";

const RECOVERED_BADGE_WINDOW_MS = 24 * 60 * 60 * 1000;

function toTimestamp(value: Date | string | null | undefined): number | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  const timestamp = date.getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function getIssueDisplayStatus(
  issue: Pick<Issue, "status" | "projectedStatus">,
): IssueStatus {
  if (issue.projectedStatus === "blocked_on_dependency") {
    return "blocked";
  }
  return (issue.projectedStatus ?? issue.status) as IssueStatus;
}

export function hasIssueLiveOperatorState(
  issue: Pick<Issue, "activeRunId" | "activeLeaseId">,
  liveOverride = false,
): boolean {
  return liveOverride || Boolean(issue.activeRunId || issue.activeLeaseId);
}

export function isRecentlyRecoveredIssue(
  issue: Pick<
    Issue,
    | "status"
    | "projectedStatus"
    | "activeRunId"
    | "activeLeaseId"
    | "executionRunId"
    | "checkoutRunId"
    | "lastReconciledAt"
  >,
  liveOverride = false,
): boolean {
  if (hasIssueLiveOperatorState(issue, liveOverride)) {
    return false;
  }

  const displayStatus = getIssueDisplayStatus(issue);
  if (displayStatus !== "todo" && displayStatus !== "backlog") {
    return false;
  }

  if (issue.executionRunId || issue.checkoutRunId) {
    return false;
  }

  const reconciledAt = toTimestamp(issue.lastReconciledAt);
  if (!reconciledAt) {
    return false;
  }

  return Date.now() - reconciledAt <= RECOVERED_BADGE_WINDOW_MS;
}
