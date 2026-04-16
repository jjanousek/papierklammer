import React from "react";
import { Box, Text } from "ink";
import type { CommandItem } from "../hooks/useChat.js";
import { redactSecretLikeText } from "../lib/transcriptRedaction.js";

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
  const command = redactSecretLikeText(item.command);
  const output = redactSecretLikeText(item.output);
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
      <Text color="yellow">$ {command}</Text>
      <Text color={statusColor}>status: {statusSummary}</Text>
      {output ? <Text dimColor>{output}</Text> : null}
    </Box>
  );
}
