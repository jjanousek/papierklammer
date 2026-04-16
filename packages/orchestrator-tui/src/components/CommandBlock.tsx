import React from "react";
import { Box, Text } from "ink";
import type { CommandItem } from "../hooks/useChat.js";

export interface CommandBlockProps {
  item: CommandItem;
}

/**
 * Renders a command execution as a bordered box with:
 * - Command line (e.g., '$ curl ...' in yellow)
 * - Lifecycle status
 * - Output text (in dim/gray)
 */
export function CommandBlock({ item }: CommandBlockProps): React.ReactElement {
  const status = item.status ?? "completed";
  const statusColor =
    status === "running"
      ? "blue"
      : status === "completed"
        ? "green"
        : status === "failed"
          ? "red"
          : "yellow";
  const statusSummary =
    item.exitCode != null && status !== "running"
      ? `${status} (exit ${item.exitCode})`
      : status;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      paddingX={1}
      marginY={0}
    >
      <Text color="yellow">$ {item.command}</Text>
      <Text color={statusColor}>status: {statusSummary}</Text>
      {item.output ? <Text dimColor>{item.output}</Text> : null}
    </Box>
  );
}
