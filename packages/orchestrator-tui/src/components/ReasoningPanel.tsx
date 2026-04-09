import React from "react";
import { Box, Text } from "ink";

export interface ReasoningPanelProps {
  text: string;
  visibleHeight?: number;
}

export function ReasoningPanel({
  text,
  visibleHeight = 6,
}: ReasoningPanelProps): React.ReactElement | null {
  const normalized = text.replace(/\r/g, "");
  if (!normalized.trim()) {
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
      {visibleLines.map((line, index) => (
        <Text key={`${startIndex + index}`}>{line || " "}</Text>
      ))}
    </Box>
  );
}
