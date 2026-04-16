import React from "react";
import { Box, Text } from "ink";
import { redactSecretLikeText } from "../lib/transcriptRedaction.js";

export interface ReasoningPanelProps {
  text: string;
  active?: boolean;
  visibleHeight?: number;
}

export function ReasoningPanel({
  text,
  active = false,
  visibleHeight = 6,
}: ReasoningPanelProps): React.ReactElement | null {
  const normalized = redactSecretLikeText(text).replace(/\r/g, "");
  if (!active && !normalized.trim()) {
    return null;
  }

  const lines = normalized.split("\n");
  const bodyHeight = Math.max(1, visibleHeight - 2);
  const startIndex = Math.max(0, lines.length - bodyHeight);
  const visibleLines = lines.slice(startIndex);
  const hiddenCount = startIndex;

  return (
    <Box flexDirection="column" borderStyle="single" paddingX={1} flexShrink={0}>
      <Text bold underline>
        Reasoning
      </Text>
      {hiddenCount > 0 ? (
        <Text dimColor>{`… ${hiddenCount} earlier line${hiddenCount === 1 ? "" : "s"}`}</Text>
      ) : null}
      {normalized.trim()
        ? visibleLines.map((line, index) => (
            <Text key={`${startIndex + index}`}>{line || " "}</Text>
          ))
        : <Text dimColor>Reasoning in progress…</Text>}
    </Box>
  );
}
