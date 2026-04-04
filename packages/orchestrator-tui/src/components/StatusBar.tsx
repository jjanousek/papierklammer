import React from "react";
import { Box, Text } from "ink";
import type { ReasoningEffort } from "../codex/types.js";

export type CodexState = "disconnected" | "connected" | "thinking";

export interface StatusBarProps {
  codexState?: CodexState;
  error?: string | null;
  threadId?: string;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  fastMode?: boolean;
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

export function StatusBar({
  codexState = "disconnected",
  error,
  threadId,
  model,
  reasoningEffort,
  fastMode,
}: StatusBarProps): React.ReactElement {
  return (
    <Box paddingX={1} gap={1} flexShrink={0} height={1}>
      <Text color={STATE_COLORS[codexState]}>{STATE_LABELS[codexState]}</Text>
      {error ? <Text color="red">| Error: {error}</Text> : null}
      {threadId ? <Text dimColor>| Thread: {threadId}</Text> : null}
      {model ? <Text dimColor>| Model: {model}</Text> : null}
      {reasoningEffort ? <Text dimColor>| reasoning: {reasoningEffort}</Text> : null}
      <Text dimColor>|</Text>
      {fastMode ? (
        <Text color="yellow" bold>fast: ON (2×)</Text>
      ) : (
        <Text dimColor>fast: OFF</Text>
      )}
    </Box>
  );
}
