import React from "react";
import { Box, Text } from "ink";
import type { ReasoningEffort } from "../codex/types.js";
import { DEFAULT_TUI_FAST_MODE, DEFAULT_TUI_MODEL, DEFAULT_TUI_REASONING_EFFORT } from "../config.js";

export type CodexState = "disconnected" | "connected" | "thinking";

export interface StatusBarProps {
  codexState?: CodexState;
  error?: string | null;
  threadId?: string;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  fastMode?: boolean;
  columns?: number;
}

const STATE_COLORS: Record<CodexState, string> = {
  disconnected: "red",
  connected: "green",
  thinking: "yellow",
};

const STATE_LABELS: Record<CodexState, string> = {
  disconnected: "Codex: disconnected",
  connected: "Codex: connected",
  thinking: "Codex: thinking",
};

function truncate(text: string, maxLength: number): string {
  if (maxLength <= 0) return "";
  if (text.length <= maxLength) return text;
  if (maxLength <= 1) return text.slice(0, maxLength);
  return `${text.slice(0, maxLength - 1)}…`;
}

export function StatusBar({
  codexState = "disconnected",
  error,
  threadId,
  model = DEFAULT_TUI_MODEL,
  reasoningEffort = DEFAULT_TUI_REASONING_EFFORT,
  fastMode = DEFAULT_TUI_FAST_MODE,
  columns,
}: StatusBarProps): React.ReactElement {
  const compact = (columns ?? 120) < 70;
  const stateLabel = compact
    ? `cx:${codexState === "disconnected" ? "down" : codexState === "thinking" ? "busy" : "up"}`
    : STATE_LABELS[codexState];
  const compactSegments = [
    stateLabel,
    `r:${reasoningEffort}`,
    fastMode ? "f:on" : "f:off",
    `m:${model}`,
    threadId ? `t:${threadId.slice(0, 8)}` : null,
    error ? `err:${error}` : null,
  ].filter((segment): segment is string => Boolean(segment));
  const compactLine = truncate(compactSegments.join(" | "), columns ?? 80);

  return (
    <Box paddingX={1} gap={1} flexShrink={0} height={1}>
      {compact ? (
        <Text color={STATE_COLORS[codexState]}>{compactLine}</Text>
      ) : (
        <>
          <Text color={STATE_COLORS[codexState]}>{STATE_LABELS[codexState]}</Text>
          {reasoningEffort ? <Text dimColor>| reasoning: {reasoningEffort}</Text> : null}
          {fastMode ? (
            <Text color="yellow" bold>| fast: ON (2×)</Text>
          ) : (
            <Text dimColor>| fast: OFF</Text>
          )}
          {model ? <Text dimColor>| Model: {model}</Text> : null}
          {threadId ? <Text dimColor>| Thread: {threadId}</Text> : null}
          {error ? <Text color="red">| Error: {error}</Text> : null}
        </>
      )}
    </Box>
  );
}
