import React, { useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";
import type { AgentOverview, RunReviewEntry } from "../hooks/useOrchestratorStatus.js";
import type { PendingApprovalSummary } from "../lib/managementApi.js";
import { getAgentOverviewDisplayStatus } from "../lib/agentStatus.js";
import { AnimatedGlyph } from "./AnimatedGlyph.js";

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

function summarizeText(text: string | null, maxLength = 140): string | null {
  const normalized = (text ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function truncateText(text: string, maxLength: number): string {
  if (maxLength <= 0) return "";
  if (text.length <= maxLength) return text;
  if (maxLength === 1) return text.slice(0, 1);
  return `${text.slice(0, maxLength - 1)}…`;
}

/** Default max visible agents before scrolling kicks in */
const DEFAULT_MAX_VISIBLE = 20;

export interface AgentSidebarProps {
  agents: AgentOverview[];
  activeRuns?: RunReviewEntry[];
  recentRuns?: RunReviewEntry[];
  pendingApprovals?: PendingApprovalSummary[];
  width?: number | string;
  height?: number | string;
  /** Override max visible agents for testing */
  maxVisible?: number;
  /** Whether the sidebar is currently focused for keyboard navigation */
  focused?: boolean;
  /** Whether sidebar keyboard shortcuts should be active */
  shortcutsEnabled?: boolean;
  /** Whether the sidebar is connected to the orchestrator API */
  connected?: boolean;
  /** Whether the first status poll is still in flight */
  booting?: boolean;
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
  width = "25%",
  height,
  maxVisible = DEFAULT_MAX_VISIBLE,
  focused = false,
  shortcutsEnabled = true,
  connected = true,
  booting = false,
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
    summarizeText(inspectedRun?.resultSummaryText ?? null)
    || summarizeText(inspectedRun?.stderrExcerpt ?? null)
    || summarizeText(inspectedRun?.stdoutExcerpt ?? null)
    || null;
  const issueLabel = inspectedRun
    ? inspectedRun.issueIdentifier
      ?? inspectedRun.issueId?.slice(0, 8)
      ?? "—"
    : null;
  const runLabel = inspectedRun ? inspectedRun.runId.slice(0, 8) : null;
  const approvalLabel = selectedApproval ? selectedApproval.id.slice(0, 8) : null;
  const runningCount = agents.filter((agent) => agent.activeRunCount > 0).length;
  const blockedCount = agents.filter((agent) => getAgentOverviewDisplayStatus(agent) === "blocked").length;
  const disconnectedError = error ?? pendingApprovalsError;
  const estimatedWidth = typeof width === "number" ? Math.max(16, width - 4) : 24;
  const selectedAgent = agents[selectedIndex] ?? null;
  const selectedAgentStatus = selectedAgent ? getAgentOverviewDisplayStatus(selectedAgent) : "unknown";
  const selectedAgentMeta = selectedAgent
    ? truncateText(
        `${selectedAgent.name || selectedAgent.agentId} · ${selectedAgentStatus}${selectedAgent.activeRunCount > 0 ? ` · ${formatLiveRunCount(selectedAgent.activeRunCount)}` : ""}`,
        estimatedWidth,
      )
    : "No selection";

  return (
    <Box
      flexDirection="column"
      width={width}
      height={height}
      borderStyle="single"
      borderColor={borderColor}
      paddingX={1}
    >
      <Text bold underline>
        Agents
      </Text>
      {booting && !disconnectedError ? (
        <>
          <Text color="yellow">Connecting…</Text>
          <Text dimColor>Waiting for orchestrator status.</Text>
        </>
      ) : !connected ? (
        <>
          <Text color="red">Disconnected</Text>
          {disconnectedError ? <Text dimColor>{disconnectedError}</Text> : null}
        </>
      ) : agents.length === 0 ? (
        <>
          <Text dimColor>0 roster · 0 running · 0 blocked</Text>
          <Text>No agents connected</Text>
          <Box marginTop={1} flexDirection="column">
            <Text bold underline>
              Next Step
            </Text>
            <Text dimColor>Open the board UI to create or connect your first agent.</Text>
          </Box>
        </>
      ) : (
        <>
          <Text dimColor>
            {agents.length} roster · {runningCount} running · {blockedCount} blocked · {pendingApprovals.length} approval{pendingApprovals.length === 1 ? "" : "s"}
          </Text>
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
                  <Text color={dot.color}><AnimatedGlyph name="activeRun" /></Text>
                ) : (
                  <Text color={dot.color}>{dot.symbol}</Text>
                )}{" "}
                {truncateText(`${agent.name || agent.agentId} (${displayStatus}${liveRunSuffix})`, estimatedWidth - 2)}
              </Text>
            );
          })}
          {hasMoreBelow && <Text dimColor>▼ more below</Text>}
          <Box marginTop={1} flexDirection="column">
            <Text bold underline>
              Selected
            </Text>
            <Text>{selectedAgentMeta}</Text>
            {inspectedRun ? (
              <>
                <Text dimColor>
                  {truncateText(`${runLabel} · ${inspectedRun.status} · issue ${issueLabel}`, estimatedWidth)}
                </Text>
                {inspectedPreview ? <Text>{truncateText(inspectedPreview, estimatedWidth * 3)}</Text> : <Text dimColor>No persisted output yet.</Text>}
              </>
            ) : hasInspectableRuns ? (
              <Text dimColor>No matching run for the current selection.</Text>
            ) : (
              <Text dimColor>No recent run activity.</Text>
            )}
          </Box>
          <Box marginTop={1} flexDirection="column">
            <Text bold underline>
              Actions
            </Text>
            <Text dimColor>{truncateText("↑/↓ move · v invoke · w wake", estimatedWidth)}</Text>
            <Text dimColor>{truncateText("[ / ] approval · a approve · x reject", estimatedWidth)}</Text>
          </Box>
          <Box marginTop={1} flexDirection="column">
            <Text bold underline>
              Approvals
            </Text>
            {selectedApproval ? (
              <>
                <Text>
                  {truncateText(`${approvalLabel} · ${selectedApproval.type}`, estimatedWidth)}
                </Text>
                <Text dimColor>
                  {truncateText(`${selectedApprovalIndex + 1}/${pendingApprovals.length} · ${selectedApproval.status}`, estimatedWidth)}
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
