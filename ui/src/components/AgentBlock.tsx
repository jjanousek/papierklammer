import { useState } from "react";
import type { Agent } from "@papierklammer/shared";
import type { LiveRunForIssue } from "../api/heartbeats";
import { Link } from "../lib/router";
import { useCompany } from "../context/CompanyContext";
import { RunIdentityGrid } from "./RunIdentityGrid";
import { agentRouteRef, agentUrl } from "../lib/utils";

/** Stream entry in an agent's output. */
export interface StreamEntry {
  type: "reasoning" | "tool_call" | "tool_result" | "delegation" | "error" | "awaiting";
  text: string;
}

interface AgentBlockProps {
  agent: Agent;
  run?: LiveRunForIssue | null;
  elapsed?: string;
  result?: string;
  streamEntries?: StreamEntry[];
}

function isActiveRun(run?: LiveRunForIssue | null): boolean {
  return run?.status === "running" || run?.status === "queued";
}

function isActiveAgent(agent: Agent): boolean {
  return agent.status === "active" || agent.status === "running";
}

export function AgentBlock({ agent, run, elapsed, result, streamEntries }: AgentBlockProps) {
  const { selectedCompany } = useCompany();
  const activeRun = isActiveRun(run);
  const activeAgent = isActiveAgent(agent);
  // Default to expanded if the agent has an active run OR an active/running status
  const defaultExpanded = activeRun || activeAgent;
  const [expanded, setExpanded] = useState(defaultExpanded);

  const handleClick = () => {
    if (!defaultExpanded) {
      setExpanded((prev) => !prev);
    }
  };

  // Force active agents to always be expanded
  const isExpanded = defaultExpanded || expanded;

  // Status color for the 6x6 square
  const statusStyle = getStatusStyle(agent.status, activeRun);

  if (!isExpanded) {
    // Collapsed (idle) - single line ~28px
    return (
      <div
        className="flex items-center px-3 cursor-pointer hover:opacity-80 border-b border-[var(--border)]"
        style={{ height: "28px", minHeight: "28px" }}
        onClick={handleClick}
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
          {agent.status}
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
      className="border-b border-[var(--border)]"
      onClick={!defaultExpanded ? handleClick : undefined}
      style={{ cursor: defaultExpanded ? "default" : "pointer" }}
      data-testid="agent-block-expanded"
    >
      {/* Header: name + status square */}
      <div
        className="flex items-center px-3 border-b border-[var(--border)]"
        style={{ height: "34px", minHeight: "34px" }}
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
      </div>

      {/* Metadata key-value pairs */}
      <div className="px-3 py-1 border-b border-[var(--border)]">
        <MetaRow label="role" value={agent.role} />
        {agent.reportsTo && <MetaRow label="reports to" value={agent.reportsTo} />}
        {agent.adapterType && <MetaRow label="adapter" value={agent.adapterType} />}
        {run ? (
          <RunIdentityGrid
            className="mt-2"
            companyId={agent.companyId}
            companyIssuePrefix={selectedCompany?.id === agent.companyId ? selectedCompany.issuePrefix : null}
            issueId={run.issueId ?? null}
            issueHref={run.issueId ? `/issues/${run.issueId}` : null}
            agentId={agent.id}
            agentHref={agentUrl(agent)}
            runId={run.id}
            runHref={`/agents/${agentRouteRef(agent)}/runs/${run.id}`}
          />
        ) : null}
      </div>

      {/* Stream content */}
      {streamEntries && streamEntries.length > 0 && (
        <div className="px-3 py-2">
          <span
            style={{
              fontSize: "9px",
              textTransform: "uppercase",
              letterSpacing: "1px",
              color: "var(--fg-dim)",
              display: "block",
              marginBottom: "4px",
            }}
          >
            REASONING + ACTIONS
          </span>
          {streamEntries.map((entry, i) => {
            const prevType = i > 0 ? streamEntries[i - 1].type : null;
            const showGroupBorder = prevType !== null && prevType !== entry.type;
            return (
              <StreamLine key={i} entry={entry} showGroupBorder={showGroupBorder} />
            );
          })}
        </div>
      )}
    </div>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ lineHeight: "1.8", fontSize: "10px" }}>
      <span style={{ color: "var(--fg-dim)" }}>{label}</span>
      <span style={{ color: "var(--fg-dim)", margin: "0 6px" }}></span>
      <span style={{ color: "var(--fg)" }}>{value}</span>
    </div>
  );
}

const REASONING_COLLAPSE_THRESHOLD = 120;

function StreamLine({ entry, showGroupBorder }: { entry: StreamEntry; showGroupBorder?: boolean }) {
  const [expanded, setExpanded] = useState(false);

  const styleMap: Record<StreamEntry["type"], { color: string; prefix?: string; indent?: boolean }> = {
    reasoning: { color: "var(--fg-muted)" },
    tool_call: { color: "var(--warn)", prefix: "$ " },
    tool_result: { color: "var(--fg-dim)", indent: true },
    delegation: { color: "var(--alive)" },
    error: { color: "var(--dead)" },
    awaiting: { color: "var(--fg-dim)" },
  };

  const s = styleMap[entry.type];
  const isLongReasoning = entry.type === "reasoning" && entry.text.length > REASONING_COLLAPSE_THRESHOLD;
  const displayText = isLongReasoning && !expanded
    ? entry.text.slice(0, REASONING_COLLAPSE_THRESHOLD) + "…"
    : entry.text;

  return (
    <div
      style={{
        fontSize: "10px",
        color: s.color,
        paddingLeft: s.indent ? "12px" : "0",
        marginBottom: "2px",
        ...(showGroupBorder
          ? { marginTop: "6px", paddingTop: "6px", borderTop: "1px solid var(--border)" }
          : {}),
      }}
    >
      {s.prefix && <span>{s.prefix}</span>}
      <span>{displayText}</span>
      {isLongReasoning && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            setExpanded((prev) => !prev);
          }}
          style={{
            marginLeft: "4px",
            color: "var(--fg-dim)",
            fontSize: "9px",
            cursor: "pointer",
            background: "none",
            border: "none",
            padding: 0,
            textDecoration: "underline",
          }}
          data-testid="stream-expand-btn"
        >
          {expanded ? "less" : "more"}
        </button>
      )}
    </div>
  );
}

function getStatusStyle(status: string, isActive: boolean): { bg: string; border?: string } {
  if (isActive) return { bg: "var(--alive)" };
  switch (status) {
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
