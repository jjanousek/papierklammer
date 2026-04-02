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
          "flex items-center gap-2.5 px-3 py-2 text-[12px]",
          isActive
            ? "font-medium"
            : "hover:opacity-70",
          className,
        )
      }
      style={({ isActive }) => ({
        color: isActive ? "var(--fg)" : "var(--fg-muted)",
        fontWeight: isActive ? 500 : 400,
        background: "transparent",
      })}
    >
      <span className="relative shrink-0">
        <Icon className="h-4 w-4" />
        {alert && (
          <span className="absolute -right-0.5 -top-0.5 h-2 w-2 bg-[var(--dead)]" />
        )}
      </span>
      <span className="flex-1 truncate">{label}</span>
      {textBadge && (
        <span
          className={cn(
            "ml-auto px-1.5 py-0.5 text-[10px] leading-none",
            textBadgeTone === "amber"
              ? "text-[var(--warn)]"
              : "text-[var(--fg-muted)]",
          )}
          style={{ background: "var(--bg-darker)", fontWeight: 400 }}
        >
          {textBadge}
        </span>
      )}
      {liveCount != null && liveCount > 0 && (
        <span className="ml-auto flex items-center gap-1.5">
          <span className="relative flex h-1.5 w-1.5">
            <span className="relative inline-flex h-1.5 w-1.5 bg-[var(--alive)]" />
          </span>
          <span className="text-[11px] text-[var(--alive)]">{liveCount} live</span>
        </span>
      )}
      {badge != null && badge > 0 && (
        <span
          className="ml-auto px-1.5 py-0.5 text-xs leading-none"
          style={{
            background: badgeTone === "danger" ? "var(--dead)" : "var(--bg-darker)",
            color: "var(--fg)",
          }}
        >
          {badge}
        </span>
      )}
    </NavLink>
  );
}
