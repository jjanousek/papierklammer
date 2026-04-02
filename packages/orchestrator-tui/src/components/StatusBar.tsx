import React from "react";
import { Box, Text } from "ink";

export type CodexState = "disconnected" | "connected" | "thinking";

export interface StatusBarProps {
  codexState?: CodexState;
  threadId?: string;
  model?: string;
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
  threadId,
  model,
}: StatusBarProps): React.ReactElement {
  return (
    <Box paddingX={1} gap={1}>
      <Text color={STATE_COLORS[codexState]}>{STATE_LABELS[codexState]}</Text>
      {threadId ? <Text dimColor>| Thread: {threadId}</Text> : null}
      {model ? <Text dimColor>| Model: {model}</Text> : null}
    </Box>
  );
}
