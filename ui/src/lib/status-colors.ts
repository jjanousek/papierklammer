/**
 * Canonical status & priority color definitions — Papierklammer design system.
 *
 * Status hierarchy uses the design system semantic colors:
 * - alive (#82E88A) for running/active/success states
 * - warn (#E8D560) for pending/in-progress states
 * - dead (#FF6060) for error/failed/blocked states
 * - fg-muted for idle/backlog/default states
 */

// ---------------------------------------------------------------------------
// Issue status colors — used by StatusIcon squares
// ---------------------------------------------------------------------------

/** StatusIcon square style classes (no longer circular) */
export const issueStatusIcon: Record<string, string> = {
  backlog: "text-[var(--fg-muted)]",
  todo: "text-[var(--fg-muted)]",
  in_progress: "text-[var(--warn)]",
  in_review: "text-[var(--alive)]",
  done: "text-[var(--alive)]",
  cancelled: "text-[var(--dead)]",
  blocked: "text-[var(--dead)]",
};

export const issueStatusIconDefault = "text-[var(--fg-muted)]";

/** Text-only color for issue statuses (dropdowns, labels) */
export const issueStatusText: Record<string, string> = {
  backlog: "text-[var(--fg-muted)]",
  todo: "text-[var(--fg-muted)]",
  in_progress: "text-[var(--warn)]",
  in_review: "text-[var(--alive)]",
  done: "text-[var(--alive)]",
  cancelled: "text-[var(--dead)]",
  blocked: "text-[var(--dead)]",
};

export const issueStatusTextDefault = "text-[var(--fg-muted)]";

// ---------------------------------------------------------------------------
// Badge colors — used by StatusBadge for all entity types
// ---------------------------------------------------------------------------

export const statusBadge: Record<string, string> = {
  // Agent statuses
  active: "bg-[var(--bg-darker)] text-[var(--alive)]",
  running: "bg-[var(--bg-darker)] text-[var(--alive)]",
  paused: "bg-[var(--bg-darker)] text-[var(--warn)]",
  idle: "bg-[var(--bg-darker)] text-[var(--warn)]",
  archived: "bg-[var(--bg-darker)] text-[var(--fg-muted)]",

  // Goal statuses
  planned: "bg-[var(--bg-darker)] text-[var(--fg-muted)]",
  achieved: "bg-[var(--bg-darker)] text-[var(--alive)]",
  completed: "bg-[var(--bg-darker)] text-[var(--alive)]",

  // Run statuses
  failed: "bg-[var(--bg-darker)] text-[var(--dead)]",
  timed_out: "bg-[var(--bg-darker)] text-[var(--dead)]",
  succeeded: "bg-[var(--bg-darker)] text-[var(--alive)]",
  error: "bg-[var(--bg-darker)] text-[var(--dead)]",
  terminated: "bg-[var(--bg-darker)] text-[var(--dead)]",
  pending: "bg-[var(--bg-darker)] text-[var(--warn)]",

  // Approval statuses
  pending_approval: "bg-[var(--bg-darker)] text-[var(--warn)]",
  revision_requested: "bg-[var(--bg-darker)] text-[var(--warn)]",
  approved: "bg-[var(--bg-darker)] text-[var(--alive)]",
  rejected: "bg-[var(--bg-darker)] text-[var(--dead)]",

  // Issue statuses
  backlog: "bg-[var(--bg-darker)] text-[var(--fg-muted)]",
  todo: "bg-[var(--bg-darker)] text-[var(--fg-muted)]",
  in_progress: "bg-[var(--bg-darker)] text-[var(--warn)]",
  in_review: "bg-[var(--bg-darker)] text-[var(--alive)]",
  blocked: "bg-[var(--bg-darker)] text-[var(--dead)]",
  done: "bg-[var(--bg-darker)] text-[var(--alive)]",
  cancelled: "bg-[var(--bg-darker)] text-[var(--dead)]",
};

export const statusBadgeDefault = "bg-[var(--bg-darker)] text-[var(--fg-muted)]";

// ---------------------------------------------------------------------------
// Agent status dot — 6x6 square indicator (no longer circular)
// ---------------------------------------------------------------------------

export const agentStatusDot: Record<string, string> = {
  running: "bg-[var(--alive)]",
  active: "bg-[var(--alive)]",
  paused: "bg-[var(--warn)]",
  idle: "bg-[var(--warn)]",
  pending_approval: "bg-[var(--warn)]",
  error: "bg-[var(--dead)]",
  archived: "bg-[var(--fg-dim)]",
};

export const agentStatusDotDefault = "bg-[var(--fg-dim)]";

// ---------------------------------------------------------------------------
// Priority colors
// ---------------------------------------------------------------------------

export const priorityColor: Record<string, string> = {
  critical: "text-[var(--dead)]",
  high: "text-[var(--warn)]",
  medium: "text-[var(--fg-muted)]",
  low: "text-[var(--fg-dim)]",
};

export const priorityColorDefault = "text-[var(--fg-muted)]";
