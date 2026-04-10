import { useEffect, useState } from "react";
import type { Agent } from "@papierklammer/shared";
import type { LiveRunForIssue } from "../api/heartbeats";
import type { TranscriptEntry } from "../adapters";
import { Link } from "../lib/router";
import { useCompany } from "../context/CompanyContext";
import { getDashboardAgentDisplayStatus } from "../lib/agentActivity";
import { agentRouteRef, agentUrl, cn, relativeTime } from "../lib/utils";
import { RunIdentityGrid } from "./RunIdentityGrid";
import { RunTranscriptView } from "./transcript/RunTranscriptView";

interface AgentBlockProps {
  agent: Agent;
  run?: LiveRunForIssue | null;
  issueReference?: string | null;
  issueHref?: string | null;
  elapsed?: string;
  result?: string;
  transcriptEntries?: TranscriptEntry[];
}

const ACTIVE_REASONING_PREVIEW_MAX = 220;

function isActiveRun(run?: LiveRunForIssue | null): boolean {
  return run?.status === "running" || run?.status === "queued";
}

function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncatePreview(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, Math.max(0, max - 1))}…` : value;
}

function getActiveReasoningPreview(entries?: TranscriptEntry[]): string | null {
  if (!entries || entries.length === 0) return null;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry.kind !== "assistant" && entry.kind !== "thinking") continue;
    const text = compactWhitespace(entry.text);
    if (!text) continue;
    return truncatePreview(text, ACTIVE_REASONING_PREVIEW_MAX);
  }
  return null;
}

export function AgentBlock({
  agent,
  run,
  issueReference,
  issueHref,
  elapsed,
  result,
  transcriptEntries,
}: AgentBlockProps) {
  const { selectedCompany } = useCompany();
  const activeRun = isActiveRun(run);
  const displayStatus = getDashboardAgentDisplayStatus(agent, run);
  const mustStayExpanded = activeRun;
  const [expanded, setExpanded] = useState(mustStayExpanded);

  useEffect(() => {
    if (mustStayExpanded) {
      setExpanded(true);
    }
  }, [mustStayExpanded]);

  const handleClick = () => {
    if (!mustStayExpanded) {
      setExpanded((prev) => !prev);
    }
  };

  // Force live runs to stay expanded; completed runs are collapsed until opened.
  const isExpanded = mustStayExpanded || expanded;

  // Status color for the 6x6 square
  const statusStyle = getStatusStyle(displayStatus, activeRun);
  const statusLabel = displayStatus.replace(/_/g, " ");
  const hasTranscript = Boolean(transcriptEntries && transcriptEntries.length > 0);
  const activeReasoningPreview = activeRun ? getActiveReasoningPreview(transcriptEntries) : null;

  if (!isExpanded) {
    // Collapsed (idle) - single line ~28px
    return (
      <div
        className={cn(
          "flex items-center gap-2 border-b border-[var(--border)] px-3 transition-colors",
          run ? "cursor-pointer hover:bg-background/60" : "cursor-default",
        )}
        style={{ height: "28px", minHeight: "28px" }}
        onClick={run ? handleClick : undefined}
        data-testid="agent-block-collapsed"
      >
        <Link
          to={agentUrl(agent)}
          onClick={(e) => e.stopPropagation()}
          className="hover:underline"
          style={{ fontSize: "11px", fontWeight: 500, color: "var(--fg)" }}
          data-testid="agent-name-link"
        >
          {agent.name}
        </Link>
        {issueReference && issueHref ? (
          <Link
            to={issueHref}
            onClick={(e) => e.stopPropagation()}
            className="min-w-0 max-w-[8rem] truncate rounded border border-border/70 bg-background/70 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-[0.12em] text-[var(--fg-dim)] hover:text-[var(--fg)]"
            title={issueReference}
          >
            {issueReference}
          </Link>
        ) : null}
        <span className="flex-1" />
        <span
          className="inline-block shrink-0"
          style={{
            width: "6px",
            height: "6px",
            backgroundColor: statusStyle.bg,
            border: statusStyle.border ?? "none",
            marginRight: "8px",
          }}
        />
        <span style={{ fontSize: "10px", color: "var(--fg-dim)", marginRight: "8px" }}>
          {statusLabel}
        </span>
        {elapsed && (
          <span style={{ fontSize: "10px", color: "var(--fg-dim)", marginRight: "8px" }}>
            {elapsed}
          </span>
        )}
        {result && (
          <span style={{ fontSize: "10px", color: "var(--fg-dim)" }}>
            {result}
          </span>
        )}
      </div>
    );
  }

  // Expanded (active or user-expanded idle)
  return (
    <div
      className={cn(
        "border-b border-[var(--border)]",
        activeRun ? "bg-cyan-500/[0.04]" : undefined,
      )}
      onClick={!mustStayExpanded ? handleClick : undefined}
      style={{ cursor: mustStayExpanded ? "default" : "pointer" }}
      data-testid="agent-block-expanded"
    >
      {/* Header: name + status square */}
      <div
        className="flex items-center gap-2 border-b border-[var(--border)] px-3 py-2"
      >
        <Link
          to={agentUrl(agent)}
          onClick={(e) => e.stopPropagation()}
          className="hover:underline"
          style={{ fontSize: "11px", fontWeight: 600, color: "var(--fg)" }}
          data-testid="agent-name-link"
        >
          {agent.name}
        </Link>
        {issueReference && issueHref ? (
          <Link
            to={issueHref}
            onClick={(e) => e.stopPropagation()}
            className="min-w-0 max-w-[10rem] truncate rounded border border-cyan-500/20 bg-background/70 px-2 py-0.5 text-[9px] font-medium uppercase tracking-[0.14em] text-cyan-700 hover:text-cyan-600 dark:text-cyan-300"
            title={issueReference}
          >
            {issueReference}
          </Link>
        ) : null}
        <span className="flex-1" />
        <span
          className="inline-block shrink-0"
          style={{
            width: "6px",
            height: "6px",
            backgroundColor: statusStyle.bg,
            border: statusStyle.border ?? "none",
          }}
        />
        <span className="rounded border border-border/70 bg-background/70 px-1.5 py-0.5 text-[9px] uppercase tracking-[0.12em] text-[var(--fg-dim)]">
          {statusLabel}
        </span>
      </div>

      {/* Metadata key-value pairs */}
      <div className="border-b border-[var(--border)] px-3 py-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <MetaPill label="role" value={agent.role} />
          {agent.adapterType ? <MetaPill label="adapter" value={agent.adapterType} /> : null}
          {run?.finishedAt ? (
            <MetaPill label="finished" value={relativeTime(run.finishedAt)} />
          ) : run?.startedAt ? (
            <MetaPill label={activeRun ? "started" : "updated"} value={relativeTime(run.startedAt)} />
          ) : null}
        </div>
        {run ? (
          <RunIdentityGrid
            className="mt-2"
            companyId={agent.companyId}
            companyIssuePrefix={selectedCompany?.id === agent.companyId ? selectedCompany.issuePrefix : null}
            issueId={run.issueId ?? null}
            issueValue={issueReference ?? run.issueId ?? null}
            issueHref={issueHref ?? (run.issueId ? `/issues/${run.issueId}` : null)}
            agentId={agent.id}
            agentHref={agentUrl(agent)}
            runId={run.id}
            runHref={`/agents/${agentRouteRef(agent)}/runs/${run.id}`}
            compact
          />
        ) : null}
      </div>

      {/* Stream content */}
      <div className="px-3 py-2">
        {activeReasoningPreview ? (
          <div className="mb-2 rounded border border-cyan-500/20 bg-cyan-500/[0.07] px-2.5 py-2">
            <div className="mb-1 text-[9px] font-medium uppercase tracking-[0.16em] text-cyan-700 dark:text-cyan-300">
              Now
            </div>
            <div className="text-[11px] leading-5 text-[var(--fg)]">
              {activeReasoningPreview}
            </div>
          </div>
        ) : null}
        {hasTranscript ? (
          <RunTranscriptView
            entries={transcriptEntries ?? []}
            density="compact"
            limit={4}
            streaming={activeRun}
            collapseStdout
            thinkingClassName="!text-[10px] !leading-4"
            emptyMessage="No transcript captured."
          />
        ) : run ? (
          <div className="text-[10px] text-[var(--fg-dim)]">
            {activeRun ? "Waiting for transcript output..." : "No transcript captured for this run."}
          </div>
        ) : null}
        {!hasTranscript && !run ? (
          <div className="text-[10px] text-[var(--fg-dim)]">
            No recent run.
          </div>
        ) : null}
      </div>
    </div>
  );
}

function MetaPill({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded border border-border/70 bg-background/70 px-1.5 py-0.5 text-[9px] uppercase tracking-[0.12em] text-[var(--fg-dim)]">
      <span>{label}</span>
      <span className="text-[var(--fg)]">{value}</span>
    </span>
  );
}

function getStatusStyle(status: string, isActive: boolean): { bg: string; border?: string } {
  if (isActive) return { bg: "var(--alive)" };
  switch (status) {
    case "queued":
      return { bg: "var(--warn)" };
    case "active":
    case "running":
      return { bg: "var(--alive)" };
    case "paused":
    case "pending_approval":
      return { bg: "var(--warn)" };
    case "error":
    case "terminated":
      return { bg: "var(--dead)" };
    case "idle":
    default:
      return { bg: "transparent", border: "1px solid var(--fg-muted)" };
  }
}
