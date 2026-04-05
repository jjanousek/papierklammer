import { Link } from "../lib/router";
import { cn } from "../lib/utils";
import { formatCompanyIdentity } from "../lib/runIdentity";

type RunIdentityValue = {
  label: string;
  value: string;
  href?: string | null;
};

function RunIdentityValueRow({ label, value, href }: RunIdentityValue) {
  const content = href ? (
    <Link to={href} className="font-mono text-[10px] text-[var(--fg)] break-all hover:underline">
      {value}
    </Link>
  ) : (
    <span className="font-mono text-[10px] text-[var(--fg)] break-all">{value}</span>
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
}: RunIdentityGridProps) {
  const visibleIssueValue = issueValue ?? issueId;

  return (
    <div className={cn("grid gap-1.5", className)} data-testid="run-identity-grid">
      <RunIdentityValueRow
        label="company"
        value={formatCompanyIdentity(companyId, companyIssuePrefix)}
        href={companyHref}
      />
      {visibleIssueValue ? <RunIdentityValueRow label="issue" value={visibleIssueValue} href={issueHref} /> : null}
      <RunIdentityValueRow label="agent" value={agentId} href={agentHref} />
      <RunIdentityValueRow label="run" value={runId} href={runHref} />
    </div>
  );
}
