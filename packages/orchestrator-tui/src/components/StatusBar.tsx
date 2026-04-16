import React from "react";
import { Box, Text } from "ink";
import type { ReasoningEffort } from "../codex/types.js";
import { DEFAULT_TUI_FAST_MODE, DEFAULT_TUI_MODEL, DEFAULT_TUI_REASONING_EFFORT } from "../config.js";
import type { TranscriptViewportState } from "./MessageList.js";

export type CodexState = "disconnected" | "connected" | "thinking";

export interface StatusBarProps {
  codexState?: CodexState;
  error?: string | null;
  threadId?: string;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  fastMode?: boolean;
  focusRegion?: string;
  columns?: number;
  transcriptState?: TranscriptViewportState;
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

function formatTranscriptState(
  transcriptState: TranscriptViewportState | undefined,
  compact: boolean,
): string | null {
  if (!transcriptState) {
    return null;
  }

  if (compact) {
    return transcriptState.liveBottom
      ? "tx:live"
      : `tx:+${transcriptState.newerLineCount}`;
  }

  return transcriptState.liveBottom
    ? "transcript: live bottom"
    : `transcript: ${transcriptState.newerLineCount} newer below`;
}

export function StatusBar({
  codexState = "disconnected",
  error,
  threadId,
  model = DEFAULT_TUI_MODEL,
  reasoningEffort = DEFAULT_TUI_REASONING_EFFORT,
  fastMode = DEFAULT_TUI_FAST_MODE,
  focusRegion,
  columns,
  transcriptState,
}: StatusBarProps): React.ReactElement {
  const compact = (columns ?? 120) < 70;
  const transcriptLabel = formatTranscriptState(transcriptState, compact);
  const compactLine = truncate(
    [
      `cx:${codexState === "disconnected" ? "down" : codexState === "thinking" ? "busy" : "up"}`,
      error ? `err:${error}` : null,
      focusRegion ? `focus:${focusRegion}` : null,
      fastMode ? "f:on" : "f:off",
      `r:${reasoningEffort}`,
      transcriptLabel,
      !error ? `m:${model}` : null,
      !error && threadId ? `t:${threadId.slice(0, 8)}` : null,
    ].filter((segment): segment is string => Boolean(segment)).join(" | "),
    columns ?? 80,
  );
  const fullLine = truncate(
    [
      STATE_LABELS[codexState],
      error ? `Error: ${error}` : null,
      focusRegion ? `focus: ${focusRegion}` : null,
      fastMode ? "fast: ON (2×)" : "fast: OFF",
      `reasoning: ${reasoningEffort}`,
      transcriptLabel,
      !error && model ? `Model: ${model}` : null,
      !error && threadId ? `Thread: ${threadId}` : null,
    ].filter((segment): segment is string => Boolean(segment)).join(" | "),
    columns ?? 120,
  );

  return (
    <Box paddingX={1} flexShrink={0} height={1}>
      <Text color={STATE_COLORS[codexState]}>
        {compact ? compactLine : fullLine}
      </Text>
    </Box>
  );
}
