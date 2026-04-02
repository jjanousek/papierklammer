import React from "react";
import { Box, Text } from "ink";
import { MessageList } from "./MessageList.js";
import type { ChatMessage, CommandItem } from "../hooks/useChat.js";

export interface ChatPanelProps {
  /** Finalized messages. */
  messages?: ChatMessage[];
  /** Partial streaming text for the current assistant response. */
  streamingText?: string;
  /** Whether the assistant is currently thinking. */
  isThinking?: boolean;
  /** Pending command items for the current turn. */
  pendingCommandItems?: CommandItem[];
  /** Whether the chat panel is focused (for scroll key handling). */
  isFocused?: boolean;
}

/**
 * Main chat panel component.
 *
 * Renders the message history via MessageList with scrolling support,
 * streaming text display, and command execution blocks.
 */
export function ChatPanel({
  messages = [],
  streamingText = "",
  isThinking = false,
  pendingCommandItems = [],
  isFocused = false,
}: ChatPanelProps): React.ReactElement {
  return (
    <Box
      flexDirection="column"
      flexGrow={1}
      borderStyle="single"
      paddingX={1}
    >
      <Text bold underline>
        Chat
      </Text>
      <MessageList
        messages={messages}
        streamingText={streamingText}
        isThinking={isThinking}
        pendingCommandItems={pendingCommandItems}
        isFocused={isFocused}
      />
    </Box>
  );
}
