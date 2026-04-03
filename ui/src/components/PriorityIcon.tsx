import { useState } from "react";
import { cn } from "../lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";

const priorityConfig: Record<string, { bgColor: string; borderColor?: string; label: string }> = {
  critical: { bgColor: "var(--dead)", label: "Critical" },
  high: { bgColor: "var(--warn)", label: "High" },
  medium: { bgColor: "var(--fg-muted)", label: "Medium" },
  low: { bgColor: "transparent", borderColor: "1px solid var(--fg-dim)", label: "Low" },
};

const allPriorities = ["critical", "high", "medium", "low"];

interface PriorityIconProps {
  priority: string;
  onChange?: (priority: string) => void;
  className?: string;
  showLabel?: boolean;
}

export function PriorityIcon({ priority, onChange, className, showLabel }: PriorityIconProps) {
  const [open, setOpen] = useState(false);
  const config = priorityConfig[priority] ?? priorityConfig.medium!;

  const icon = (
    <span
      data-testid="priority-indicator"
      className={cn(
        "inline-block shrink-0",
        onChange && !showLabel && "cursor-pointer",
        className
      )}
      style={{
        width: "6px",
        height: "6px",
        backgroundColor: config.bgColor,
        border: config.borderColor ?? "none",
      }}
    />
  );

  if (!onChange) return showLabel ? <span className="inline-flex items-center gap-1.5">{icon}<span className="text-[10px] font-mono text-[var(--fg-muted)]">{config.label}</span></span> : icon;

  const trigger = showLabel ? (
    <button className="inline-flex items-center gap-1.5 cursor-pointer hover:opacity-80 px-1 -mx-1 py-0.5 text-[10px]">
      {icon}
      <span className="text-[10px] font-mono text-[var(--fg-muted)]">{config.label}</span>
    </button>
  ) : icon;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent className="w-36 p-1" align="start">
        {allPriorities.map((p) => {
          const c = priorityConfig[p]!;
          return (
            <Button
              key={p}
              variant="ghost"
              size="sm"
              className={cn("w-full justify-start gap-2 text-[11px] font-mono", p === priority && "bg-[var(--bg-darker)]")}
              onClick={() => {
                onChange(p);
                setOpen(false);
              }}
            >
              <span
                className="inline-block shrink-0"
                style={{
                  width: "6px",
                  height: "6px",
                  backgroundColor: c.bgColor,
                  border: c.borderColor ?? "none",
                }}
              />
              {c.label}
            </Button>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}
