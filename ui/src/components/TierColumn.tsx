import type { Agent } from "@papierklammer/shared";
import type { LiveRunForIssue } from "../api/heartbeats";
import type { TranscriptEntry } from "../adapters";
import { AgentBlock } from "./AgentBlock";

export interface TierInfo {
  label: string;
  rank: number;
  agents: Agent[];
  runs?: Map<string, LiveRunForIssue>;
  transcriptsByRun?: Map<string, TranscriptEntry[]>;
}

interface TierColumnProps {
  tier: TierInfo;
  issueReferences?: Map<string, string>;
  issueHrefs?: Map<string, string>;
  className?: string;
  style?: React.CSSProperties;
}

export function TierColumn({
  tier,
  issueReferences,
  issueHrefs,
  className,
  style,
}: TierColumnProps) {
  return (
    <div
      className={className}
      style={{
        display: "flex",
        flexDirection: "column",
        borderRight: "1px solid var(--border)",
        overflow: "hidden",
        ...style,
      }}
      data-testid={`tier-column-${tier.label.toLowerCase()}`}
    >
      {/* Tier header */}
      <div
        className="flex items-center justify-between px-3 border-b border-[var(--border)]"
        style={{ height: "28px", minHeight: "28px" }}
      >
        <span
          style={{
            fontSize: "9px",
            textTransform: "uppercase",
            letterSpacing: "1.5px",
            color: "var(--fg-dim)",
          }}
        >
          {tier.label}
        </span>
        <span
          style={{
            fontSize: "9px",
            color: "var(--fg)",
            background: "var(--bg-darker)",
            padding: "2px 6px",
          }}
        >
          tier {tier.rank}
        </span>
      </div>

      {/* Agent blocks */}
      <div className="flex-1 overflow-y-auto">
        {tier.agents.map((agent) => {
          const run = tier.runs?.get(agent.id) ?? null;
          const issueReference = run?.issueId ? issueReferences?.get(run.issueId) ?? run.issueId : null;
          const issueHref = run?.issueId ? issueHrefs?.get(run.issueId) ?? `/issues/${run.issueId}` : null;
          const transcriptEntries = run ? tier.transcriptsByRun?.get(run.id) : undefined;

          return (
            <AgentBlock
              key={agent.id}
              agent={agent}
              run={run}
              issueReference={issueReference}
              issueHref={issueHref}
              transcriptEntries={transcriptEntries}
            />
          );
        })}
        {tier.agents.length === 0 && (
          <div
            className="px-3 py-4"
            style={{ fontSize: "10px", color: "var(--fg-dim)" }}
          >
            No agents in this tier
          </div>
        )}
      </div>
    </div>
  );
}
