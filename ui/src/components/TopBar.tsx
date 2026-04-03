interface TopBarProps {
  activeCount: number;
  idleCount: number;
}

export function TopBar({ activeCount, idleCount }: TopBarProps) {
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

      {/* Pipeline label */}
      <div
        className="flex items-center px-3 h-full border-r border-[var(--border)]"
        style={{
          fontSize: "11px",
          color: "var(--fg)",
          background: "var(--bg-dark)",
        }}
      >
        pipeline
      </div>

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
