import { Link } from "../lib/router";
import { cn } from "../lib/utils";
import { formatCompanyIdentity } from "../lib/runIdentity";

type RunIdentityValue = {
  label: string;
  value: string;
  href?: string | null;
  title?: string;
};

function RunIdentityValueRow({ label, value, href, title }: RunIdentityValue) {
  const content = href ? (
    <Link
      to={href}
      className="font-mono text-[10px] text-[var(--fg)] break-all hover:underline"
      title={title ?? value}
    >
      {value}
    </Link>
  ) : (
    <span className="font-mono text-[10px] text-[var(--fg)] break-all" title={title ?? value}>
      {value}
    </span>
  );

  return (
    <div className="grid grid-cols-[auto,1fr] gap-x-2 gap-y-0.5 items-start" data-testid={`run-identity-${label}`}>
      <span className="text-[9px] uppercase tracking-[0.16em] text-[var(--fg-dim)]">{label}</span>
      {content}
    </div>
  );
}

interface RunIdentityGridProps {
  companyId: string;
  companyIssuePrefix?: string | null;
  issueId?: string | null;
  issueValue?: string | null;
  agentId: string;
  runId: string;
  companyHref?: string | null;
  issueHref?: string | null;
  agentHref?: string | null;
  runHref?: string | null;
  className?: string;
  compact?: boolean;
}

export function RunIdentityGrid({
  companyId,
  companyIssuePrefix,
  issueId,
  issueValue,
  agentId,
  runId,
  companyHref,
  issueHref,
  agentHref,
  runHref,
  className,
  compact = false,
}: RunIdentityGridProps) {
  const visibleIssueValue = issueValue ?? issueId;
  const companyValue = compact
    ? companyIssuePrefix ?? companyId.slice(0, 8)
    : formatCompanyIdentity(companyId, companyIssuePrefix);
  const runValue = compact ? runId.slice(0, 8) : runId;

  return (
    <div className={cn("grid gap-1.5", className)} data-testid="run-identity-grid">
      <RunIdentityValueRow
        label="company"
        value={companyValue}
        href={companyHref}
        title={formatCompanyIdentity(companyId, companyIssuePrefix)}
      />
      {visibleIssueValue ? <RunIdentityValueRow label="issue" value={visibleIssueValue} href={issueHref} /> : null}
      {!compact ? <RunIdentityValueRow label="agent" value={agentId} href={agentHref} /> : null}
      <RunIdentityValueRow label="run" value={runValue} href={runHref} title={runId} />
    </div>
  );
}
