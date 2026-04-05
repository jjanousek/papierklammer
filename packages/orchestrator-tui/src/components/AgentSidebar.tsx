import React, { useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";
import Spinner from "ink-spinner";
import type { AgentOverview, RunReviewEntry } from "../hooks/useOrchestratorStatus.js";
import type { PendingApprovalSummary } from "../lib/managementApi.js";
import { getAgentOverviewDisplayStatus } from "../lib/agentStatus.js";

const STATUS_DOT: Record<string, { symbol: string; color: string }> = {
  idle: { symbol: "●", color: "green" },
  running: { symbol: "●", color: "blue" },
  error: { symbol: "●", color: "red" },
  blocked: { symbol: "●", color: "yellow" },
};

function statusDot(status: string): { symbol: string; color: string } {
  return STATUS_DOT[status] ?? { symbol: "●", color: "gray" };
}

function formatLiveRunCount(count: number): string {
  return `${count} live run${count === 1 ? "" : "s"}`;
}

/** Default max visible agents before scrolling kicks in */
const DEFAULT_MAX_VISIBLE = 20;

export interface AgentSidebarProps {
  agents: AgentOverview[];
  activeRuns?: RunReviewEntry[];
  recentRuns?: RunReviewEntry[];
  pendingApprovals?: PendingApprovalSummary[];
  /** Override max visible agents for testing */
  maxVisible?: number;
  /** Whether the sidebar is currently focused for keyboard navigation */
  focused?: boolean;
  /** Whether sidebar keyboard shortcuts should be active */
  shortcutsEnabled?: boolean;
  /** Whether the sidebar is connected to the orchestrator API */
  connected?: boolean;
  /** Error message from the last failed poll */
  error?: string | null;
  /** Error message from pending approvals polling */
  pendingApprovalsError?: string | null;
  onInvokeSelectedAgent?: (agent: AgentOverview) => void;
  onWakeSelectedAgent?: (agent: AgentOverview) => void;
  onApproveSelectedApproval?: (approval: PendingApprovalSummary) => void;
  onRejectSelectedApproval?: (approval: PendingApprovalSummary) => void;
}

export function AgentSidebar({
  agents,
  activeRuns = [],
  recentRuns = [],
  pendingApprovals = [],
  maxVisible = DEFAULT_MAX_VISIBLE,
  focused = false,
  shortcutsEnabled = true,
  connected = true,
  error = null,
  pendingApprovalsError = null,
  onInvokeSelectedAgent,
  onWakeSelectedAgent,
  onApproveSelectedApproval,
  onRejectSelectedApproval,
}: AgentSidebarProps): React.ReactElement {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [selectedApprovalIndex, setSelectedApprovalIndex] = useState(0);

  useEffect(() => {
    setSelectedIndex((current) => Math.max(0, Math.min(current, agents.length - 1)));
    setScrollOffset((current) => Math.max(0, Math.min(current, Math.max(0, agents.length - maxVisible))));
  }, [agents.length, maxVisible]);

  useEffect(() => {
    setSelectedApprovalIndex((current) => Math.max(0, Math.min(current, pendingApprovals.length - 1)));
  }, [pendingApprovals.length]);

  useInput(
    (input, key) => {
      if (!focused || !shortcutsEnabled) return;
      if (key.downArrow) {
        setSelectedIndex((prev) => {
          const next = Math.min(prev + 1, agents.length - 1);
          // Scroll down if selection moves past visible window
          if (next >= scrollOffset + maxVisible) {
            setScrollOffset(next - maxVisible + 1);
          }
          return next;
        });
      }
      if (key.upArrow) {
        setSelectedIndex((prev) => {
          const next = Math.max(prev - 1, 0);
          // Scroll up if selection moves above visible window
          if (next < scrollOffset) {
            setScrollOffset(next);
          }
          return next;
        });
      }
      if (input === "v" && agents[selectedIndex]) {
        onInvokeSelectedAgent?.(agents[selectedIndex]!);
      }
      if (input === "w" && agents[selectedIndex]) {
        onWakeSelectedAgent?.(agents[selectedIndex]!);
      }
      if (input === "[" && pendingApprovals.length > 0) {
        setSelectedApprovalIndex((prev) => (prev - 1 + pendingApprovals.length) % pendingApprovals.length);
      }
      if (input === "]" && pendingApprovals.length > 0) {
        setSelectedApprovalIndex((prev) => (prev + 1) % pendingApprovals.length);
      }
      if (input === "a" && pendingApprovals[selectedApprovalIndex]) {
        onApproveSelectedApproval?.(pendingApprovals[selectedApprovalIndex]!);
      }
      if (input === "x" && pendingApprovals[selectedApprovalIndex]) {
        onRejectSelectedApproval?.(pendingApprovals[selectedApprovalIndex]!);
      }
    },
    { isActive: focused && shortcutsEnabled },
  );

  const borderColor = focused ? "cyan" : undefined;

  const hasMoreAbove = scrollOffset > 0;
  const hasMoreBelow = scrollOffset + maxVisible < agents.length;
  const visibleAgents = agents.slice(scrollOffset, scrollOffset + maxVisible);
  const selectedAgentId = agents[selectedIndex]?.agentId ?? null;
  const selectedAgentName = agents[selectedIndex]?.name ?? selectedAgentId ?? "selected agent";
  const hasInspectableRuns = activeRuns.length > 0 || recentRuns.length > 0;
  const selectedApproval = pendingApprovals[selectedApprovalIndex] ?? null;
  const inspectedRun =
    [...activeRuns, ...recentRuns].find((run) => run.agentId === selectedAgentId)
    ?? null;
  const inspectedPreview =
    inspectedRun?.resultSummaryText?.trim()
    || inspectedRun?.stderrExcerpt?.trim()
    || inspectedRun?.stdoutExcerpt?.trim()
    || null;
  const issueLabel = inspectedRun
    ? inspectedRun.issueIdentifier
      ?? inspectedRun.issueId?.slice(0, 8)
      ?? "—"
    : null;
  const runLabel = inspectedRun ? inspectedRun.runId.slice(0, 8) : null;
  const approvalLabel = selectedApproval ? selectedApproval.id.slice(0, 8) : null;

  return (
    <Box
      flexDirection="column"
      width="25%"
      borderStyle="single"
      borderColor={borderColor}
      paddingX={1}
    >
      <Text bold underline>
        Agents
      </Text>
      {!connected ? (
        <>
          <Text color="red">Disconnected</Text>
          {error ? <Text dimColor>{error}</Text> : null}
        </>
      ) : agents.length === 0 ? (
        <Text dimColor>No agents connected</Text>
      ) : (
        <>
          {hasMoreAbove && <Text dimColor>▲ more above</Text>}
          {visibleAgents.map((agent, visIdx) => {
            const idx = scrollOffset + visIdx;
            const displayStatus = getAgentOverviewDisplayStatus(agent);
            const dot =
              agent.activeRunCount > 0
                ? { symbol: "●", color: "blue" }
                : statusDot(displayStatus);
            const isSelected = idx === selectedIndex;
            const isRunning = agent.activeRunCount > 0;
            const liveRunSuffix =
              agent.activeRunCount > 0
                ? ` · ${formatLiveRunCount(agent.activeRunCount)}`
                : "";
            return (
              <Text
                key={`${agent.agentId}:${idx}`}
                inverse={isSelected && focused}
              >
                {isRunning ? (
                  <Text color={dot.color}><Spinner type="dots" /></Text>
                ) : (
                  <Text color={dot.color}>{dot.symbol}</Text>
                )}{" "}
                {agent.name || agent.agentId} ({displayStatus}{liveRunSuffix})
              </Text>
            );
          })}
          {hasMoreBelow && <Text dimColor>▼ more below</Text>}
          {hasInspectableRuns ? (
            <Box marginTop={1} flexDirection="column">
              <Text bold underline>
                Run inspection
              </Text>
              <Text dimColor>↑/↓ inspect run</Text>
              {inspectedRun ? (
                <>
                  <Text>
                    {runLabel} · {inspectedRun.status}
                  </Text>
                  <Text dimColor>
                    issue {issueLabel} · agent {inspectedRun.agentName}
                  </Text>
                  <Text dimColor>Result/output</Text>
                  {inspectedPreview ? (
                    <Text>{inspectedPreview}</Text>
                  ) : inspectedRun.status === "queued" || inspectedRun.status === "running" ? (
                    <Text dimColor>Waiting for persisted output…</Text>
                  ) : (
                    <Text dimColor>No persisted result summary.</Text>
                  )}
                </>
              ) : (
                <Text dimColor>No runs for {selectedAgentName}</Text>
              )}
            </Box>
          ) : null}
          <Box marginTop={1} flexDirection="column">
            <Text bold underline>
              Management
            </Text>
            <Text dimColor>v invoke · w wake selected agent</Text>
            <Text dimColor>a approve · x reject · [ / ] cycle approvals</Text>
            <Text>
              Agent: {selectedAgentName}
            </Text>
            <Text bold underline>
              Pending approvals
            </Text>
            {selectedApproval ? (
              <>
                <Text>
                  {approvalLabel} · {selectedApproval.type}
                </Text>
                <Text dimColor>
                  {selectedApprovalIndex + 1}/{pendingApprovals.length} · status {selectedApproval.status}
                </Text>
              </>
            ) : pendingApprovalsError ? (
              <>
                <Text color="red">Pending approvals unavailable</Text>
                <Text dimColor>{pendingApprovalsError}</Text>
              </>
            ) : (
              <Text dimColor>No pending approvals</Text>
            )}
          </Box>
        </>
      )}
    </Box>
  );
}
