import { useState } from "react";

interface CommandBarProps {
  onExecute?: (command: string) => void | Promise<void>;
}

export function CommandBar({ onExecute }: CommandBarProps) {
  const [value, setValue] = useState("");
  const [isExecuting, setIsExecuting] = useState(false);

  const handleSubmit = async () => {
    const trimmed = value.trim();
    if (!trimmed || !onExecute || isExecuting) {
      return;
    }

    setIsExecuting(true);
    try {
      await onExecute(trimmed);
      setValue("");
    } finally {
      setIsExecuting(false);
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void handleSubmit();
    }
  };

  return (
    <div
      className="flex items-center w-full border-t border-[var(--border)]"
      style={{ height: "38px", minHeight: "38px" }}
      data-testid="command-bar"
    >
      {/* EXEC prefix cell */}
      <div
        className="flex items-center px-3 h-full border-r border-[var(--border)]"
        style={{
          background: "var(--bg-dark)",
          fontSize: "11px",
          fontWeight: 400,
          color: "var(--fg)",
        }}
      >
        EXEC
      </div>

      {/* Input */}
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="dispatch work: have CTO review blockers..."
        disabled={isExecuting}
        className="flex-1 h-full px-3 outline-none"
        style={{
          background: "transparent",
          border: "none",
          color: "var(--fg)",
          fontSize: "11px",
        }}
      />

      {/* RUN button */}
      <button
        onClick={() => void handleSubmit()}
        disabled={isExecuting}
        className="flex items-center px-3 h-full border-l border-[var(--border)] cursor-pointer disabled:cursor-wait disabled:opacity-70"
        style={{
          background: "var(--bg-darker)",
          fontSize: "11px",
          fontWeight: 400,
          color: "var(--fg)",
          textTransform: "uppercase",
          letterSpacing: "0.5px",
        }}
      >
        {isExecuting ? "WORKING" : "RUN"}
      </button>
    </div>
  );
}
