import React from "react";
import { Box, Text } from "ink";
import type { CommandItem } from "../hooks/useChat.js";

export interface CommandBlockProps {
  item: CommandItem;
}

/**
 * Renders a command execution as a bordered box with:
 * - Command line (e.g., '$ curl ...' in yellow)
 * - Output text (in dim/gray)
 */
export function CommandBlock({ item }: CommandBlockProps): React.ReactElement {
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      paddingX={1}
      marginY={0}
    >
      <Text color="yellow">$ {item.command}</Text>
      {item.output ? <Text dimColor>{item.output}</Text> : null}
    </Box>
  );
}
