import React from "react";
import { Box, Text } from "ink";
import type { AgentOverview, RunReviewEntry } from "../hooks/useOrchestratorStatus.js";
import type { PendingApprovalSummary, CompanyIssueSummary } from "../lib/managementApi.js";

const ISSUE_STATUS_WEIGHT: Record<string, number> = {
  blocked: 0,
  in_review: 1,
  in_progress: 2,
  todo: 3,
  backlog: 4,
  done: 5,
  cancelled: 6,
};

const ISSUE_PRIORITY_WEIGHT: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

function compareIssues(left: CompanyIssueSummary, right: CompanyIssueSummary): number {
  const leftStatus = ISSUE_STATUS_WEIGHT[left.projectedStatus ?? left.status] ?? 99;
  const rightStatus = ISSUE_STATUS_WEIGHT[right.projectedStatus ?? right.status] ?? 99;
  if (leftStatus !== rightStatus) {
    return leftStatus - rightStatus;
  }

  const leftPriority = ISSUE_PRIORITY_WEIGHT[left.priority] ?? 99;
  const rightPriority = ISSUE_PRIORITY_WEIGHT[right.priority] ?? 99;
  if (leftPriority !== rightPriority) {
    return leftPriority - rightPriority;
  }

  return Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
}

function summarizeText(text: string | null | undefined, maxLength: number): string {
  const trimmed = (text ?? "").replace(/\s+/g, " ").trim();
  if (!trimmed) {
    return "No description yet.";
  }
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return `${trimmed.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function issueLabel(issue: CompanyIssueSummary): string {
  return issue.identifier ?? issue.id.slice(0, 8);
}

function resolveAssigneeLabel(
  issue: CompanyIssueSummary,
  agents: AgentOverview[],
): string {
  if (!issue.assigneeAgentId) {
    return "unassigned";
  }
  return (
    agents.find((agent) => agent.agentId === issue.assigneeAgentId)?.name
    ?? issue.assigneeAgentId.slice(0, 8)
  );
}

export interface IssueDeskProps {
  issues: CompanyIssueSummary[];
  agents: AgentOverview[];
  activeRuns: RunReviewEntry[];
  pendingApprovals: PendingApprovalSummary[];
  selectedIndex: number;
  compact?: boolean;
  height?: number;
  focused?: boolean;
  error?: string | null;
}

export function IssueDesk({
  issues,
  agents,
  activeRuns,
  pendingApprovals,
  selectedIndex,
  compact = false,
  height,
  focused = false,
  error = null,
}: IssueDeskProps): React.ReactElement {
  const rankedIssues = [...issues].sort(compareIssues);
  const activeIssues = rankedIssues.filter((issue) => {
    const effectiveStatus = issue.projectedStatus ?? issue.status;
    return effectiveStatus !== "done" && effectiveStatus !== "cancelled";
  });
  const selectedIssue =
    activeIssues[Math.max(0, Math.min(selectedIndex, activeIssues.length - 1))]
    ?? null;
  const blockedCount = activeIssues.filter((issue) => (issue.projectedStatus ?? issue.status) === "blocked").length;
  const reviewCount = activeIssues.filter((issue) => (issue.projectedStatus ?? issue.status) === "in_review").length;
  const inFlightCount = activeIssues.filter((issue) => (issue.projectedStatus ?? issue.status) === "in_progress").length;
  const backlogCount = activeIssues.filter((issue) => {
    const effectiveStatus = issue.projectedStatus ?? issue.status;
    return effectiveStatus === "todo" || effectiveStatus === "backlog";
  }).length;
  const attentionCount = blockedCount + reviewCount + pendingApprovals.length;
  const selectedIssueRun =
    selectedIssue
      ? activeRuns.find((run) => run.issueId === selectedIssue.id)
      : null;
  const visibleIssueCount = compact ? 4 : 7;

  return (
    <Box
      flexDirection="column"
      height={height}
      borderStyle="single"
      borderColor={focused ? "cyan" : undefined}
      paddingX={1}
      flexShrink={0}
      minHeight={compact ? 8 : 12}
    >
      <Text bold underline>
        Issue Desk
      </Text>
      <Text dimColor>
        {compact ? "j / k select · n new · u recover" : "j / k select · n new issue · u recover selected"}
      </Text>
      <Text>
        Attention {attentionCount} | blocked {blockedCount} | review {reviewCount} | in flight {inFlightCount} | queue {backlogCount}
      </Text>
      <Text dimColor>
        {pendingApprovals.length} pending approval{pendingApprovals.length === 1 ? "" : "s"} · {activeRuns.length} live run{activeRuns.length === 1 ? "" : "s"}
      </Text>
      {error ? <Text color="red">{error}</Text> : null}
      <Box marginTop={1} flexDirection="row" gap={2}>
        <Box flexDirection="column" width="58%">
          <Text bold>Top issues</Text>
          {activeIssues.length === 0 ? (
            <Text dimColor>No active issues. Press n to draft one.</Text>
          ) : (
            activeIssues.slice(0, visibleIssueCount).map((issue, index) => {
              const effectiveStatus = issue.projectedStatus ?? issue.status;
              const isSelected = index === selectedIndex;
              return (
                <Text key={issue.id} inverse={isSelected}>
                  {issue.priority === "critical" ? "!" : "•"} {issueLabel(issue)} [{effectiveStatus}/{issue.priority}] {issue.title}
                </Text>
              );
            })
          )}
        </Box>
        <Box flexDirection="column" flexGrow={1}>
          <Text bold>Selected</Text>
          {selectedIssue ? (
            <>
              <Text>
                {issueLabel(selectedIssue)} · {(selectedIssue.projectedStatus ?? selectedIssue.status)} · {selectedIssue.priority}
              </Text>
              <Text dimColor>
                assignee {resolveAssigneeLabel(selectedIssue, agents)} · updated {new Date(selectedIssue.updatedAt).toLocaleString("en-US", {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </Text>
              {selectedIssueRun ? (
                <Text dimColor>
                  live run {selectedIssueRun.runId.slice(0, 8)} · {selectedIssueRun.agentName}
                </Text>
              ) : null}
              <Text>{summarizeText(selectedIssue.description, compact ? 120 : 220)}</Text>
            </>
          ) : (
            <Text dimColor>Select an issue to inspect the current workstream.</Text>
          )}
        </Box>
      </Box>
    </Box>
  );
}
