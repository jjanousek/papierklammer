import { cn } from "../lib/utils";

/**
 * Map statuses to design-system colors for badge text.
 */
function statusBadgeColors(status: string): string {
  switch (status) {
    case "active":
    case "running":
    case "succeeded":
    case "done":
    case "completed":
    case "achieved":
    case "approved":
      return "bg-[var(--bg-darker)] text-[var(--alive)]";
    case "in_progress":
    case "in_review":
    case "pending":
    case "pending_approval":
    case "revision_requested":
    case "paused":
    case "idle":
      return "bg-[var(--bg-darker)] text-[var(--warn)]";
    case "failed":
    case "error":
    case "terminated":
    case "timed_out":
    case "blocked":
    case "cancelled":
    case "rejected":
      return "bg-[var(--bg-darker)] text-[var(--dead)]";
    default:
      return "bg-[var(--bg-darker)] text-[var(--fg-muted)]";
  }
}

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 text-[9px] font-mono font-normal whitespace-nowrap shrink-0",
        statusBadgeColors(status)
      )}
    >
      {status.replace("_", " ")}
    </span>
  );
}
