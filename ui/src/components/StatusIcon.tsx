import { useState } from "react";
import { cn } from "../lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";

const allStatuses = ["backlog", "todo", "in_progress", "in_review", "done", "cancelled", "blocked"];

function statusLabel(status: string): string {
  return status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Map issue statuses to design-system semantic colors.
 * Active/running/success statuses → alive (#82E88A)
 * Error/blocked statuses → dead (#FF6060)
 * In-progress → warn (#E8D560)
 * Idle/backlog/inactive statuses → transparent with 1px border in --fg-muted
 */
function statusSquareStyle(status: string): { bg: string; border?: string } {
  switch (status) {
    case "done":
    case "in_review":
    case "running":
    case "active":
    case "succeeded":
    case "alive":
      return { bg: "var(--alive)" };
    case "in_progress":
    case "paused":
    case "pending":
    case "pending_approval":
      return { bg: "var(--warn)" };
    case "blocked":
    case "cancelled":
    case "error":
    case "failed":
    case "terminated":
      return { bg: "var(--dead)" };
    case "todo":
    case "backlog":
    case "idle":
    default:
      return { bg: "transparent", border: "1px solid var(--fg-muted)" };
  }
}

interface StatusIconProps {
  status: string;
  onChange?: (status: string) => void;
  className?: string;
  showLabel?: boolean;
}

export function StatusIcon({ status, onChange, className, showLabel }: StatusIconProps) {
  const [open, setOpen] = useState(false);
  const style = statusSquareStyle(status);

  const square = (
    <span
      data-testid="status-indicator"
      className={cn(
        "inline-block shrink-0",
        onChange && !showLabel && "cursor-pointer",
        className
      )}
      style={{
        width: "6px",
        height: "6px",
        backgroundColor: style.bg,
        border: style.border ?? "none",
      }}
    />
  );

  if (!onChange) return showLabel ? <span className="inline-flex items-center gap-1.5">{square}<span className="text-[11px] text-[var(--fg-muted)]">{statusLabel(status)}</span></span> : square;

  const trigger = showLabel ? (
    <Button variant="ghost" className="inline-flex items-center gap-1.5 cursor-pointer px-1 -mx-1 py-0.5 h-auto">
      {square}
      <span className="text-[11px] text-[var(--fg-muted)]">{statusLabel(status)}</span>
    </Button>
  ) : square;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent className="w-40 p-1" align="start">
        {allStatuses.map((s) => (
          <Button
            key={s}
            variant="ghost"
            size="sm"
            className={cn("w-full justify-start gap-2 text-xs normal-case", s === status && "bg-[var(--bg-darker)]")}
            onClick={() => {
              onChange(s);
              setOpen(false);
            }}
          >
            <StatusIcon status={s} />
            {statusLabel(s)}
          </Button>
        ))}
      </PopoverContent>
    </Popover>
  );
}
