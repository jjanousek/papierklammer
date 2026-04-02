import { cn } from "../lib/utils";

export type TopBarTab = "pipeline" | "history" | "config";

interface TopBarProps {
  activeTab: TopBarTab;
  onTabChange: (tab: TopBarTab) => void;
  activeCount: number;
  idleCount: number;
}

const tabs: TopBarTab[] = ["pipeline", "history", "config"];

export function TopBar({ activeTab, onTabChange, activeCount, idleCount }: TopBarProps) {
  return (
    <div
      className="flex items-center w-full border-b border-[var(--border)]"
      style={{ height: "36px", minHeight: "36px" }}
    >
      {/* Logo cell */}
      <div
        className="flex items-center px-3 h-full border-r border-[var(--border)]"
        style={{ background: "var(--bg-darker)" }}
      >
        <span
          className="text-[var(--fg)] select-none"
          style={{
            fontSize: "12px",
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.5px",
          }}
        >
          PAPIERKLAMMER
        </span>
      </div>

      {/* Tab cells */}
      {tabs.map((tab) => {
        const isActive = tab === activeTab;
        return (
          <button
            key={tab}
            onClick={() => onTabChange(tab)}
            className={cn(
              "flex items-center px-3 h-full border-r border-[var(--border)] cursor-pointer",
              "text-[11px] bg-transparent",
            )}
            style={{
              color: isActive ? "var(--fg)" : "var(--fg-muted)",
              background: isActive ? "var(--bg-dark)" : "transparent",
            }}
          >
            {tab}
          </button>
        );
      })}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Agent status counts */}
      <div
        className="flex items-center px-3 h-full border-l border-[var(--border)]"
        style={{ fontSize: "10px", color: "var(--fg-dim)" }}
      >
        <span>{activeCount} active</span>
        <span className="mx-2">&nbsp;&nbsp;</span>
        <span>{idleCount} idle</span>
      </div>
    </div>
  );
}
