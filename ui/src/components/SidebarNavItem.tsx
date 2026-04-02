import { NavLink } from "@/lib/router";
import { cn } from "../lib/utils";
import { useSidebar } from "../context/SidebarContext";
import type { LucideIcon } from "lucide-react";

interface SidebarNavItemProps {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
  className?: string;
  badge?: number;
  badgeTone?: "default" | "danger";
  textBadge?: string;
  textBadgeTone?: "default" | "amber";
  alert?: boolean;
  liveCount?: number;
}

export function SidebarNavItem({
  to,
  label,
  icon: Icon,
  end,
  className,
  badge,
  badgeTone = "default",
  textBadge,
  textBadgeTone = "default",
  alert = false,
  liveCount,
}: SidebarNavItemProps) {
  const { isMobile, setSidebarOpen } = useSidebar();

  return (
    <NavLink
      to={to}
      end={end}
      onClick={() => { if (isMobile) setSidebarOpen(false); }}
      className={({ isActive }) =>
        cn(
          "flex items-center gap-2.5 px-3 py-2 text-[13px] font-medium",
          isActive
            ? "bg-accent text-foreground"
            : "text-foreground/80 hover:opacity-80 hover:text-foreground",
          className,
        )
      }
    >
      <span className="relative shrink-0">
        <Icon className="h-4 w-4" />
        {alert && (
          <span className="absolute -right-0.5 -top-0.5 h-2 w-2 bg-[var(--dead)] shadow-[0_0_0_2px_hsl(var(--background))]" />
        )}
      </span>
      <span className="flex-1 truncate">{label}</span>
      {textBadge && (
        <span
          className={cn(
            "ml-auto px-1.5 py-0.5 text-[10px] font-medium leading-none",
            textBadgeTone === "amber"
              ? "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400"
              : "bg-muted text-muted-foreground",
          )}
        >
          {textBadge}
        </span>
      )}
      {liveCount != null && liveCount > 0 && (
        <span className="ml-auto flex items-center gap-1.5">
          <span className="relative flex h-1.5 w-1.5">
            <span className="relative inline-flex h-1.5 w-1.5 bg-[var(--alive)]" />
          </span>
          <span className="text-[11px] font-medium text-[var(--alive)]">{liveCount} live</span>
        </span>
      )}
      {badge != null && badge > 0 && (
        <span
          className={cn(
            "ml-auto px-1.5 py-0.5 text-xs leading-none",
            badgeTone === "danger"
              ? "bg-red-600/90 text-red-50"
              : "bg-primary text-primary-foreground",
          )}
        >
          {badge}
        </span>
      )}
    </NavLink>
  );
}
