import React from "react";
import { Box, Text } from "ink";
import { MessageList } from "./MessageList.js";
import { ReasoningPanel } from "./ReasoningPanel.js";
import type { ChatMessage, CommandItem, TranscriptBlock } from "../hooks/useChat.js";

export interface ChatPanelProps {
  /** Finalized messages. */
  messages?: ChatMessage[];
  /** Partial streaming text for the current assistant response. */
  streamingText?: string;
  /** Ordered live transcript blocks for the current assistant response. */
  pendingBlocks?: TranscriptBlock[];
  /** Whether the assistant is currently thinking. */
  isThinking?: boolean;
  /** Reasoning text streamed for the current turn. */
  reasoningText?: string;
  /** Pending command items for the current turn. */
  pendingCommandItems?: CommandItem[];
  /** Whether the chat panel is focused (for scroll key handling). */
  isFocused?: boolean;
  /** Available height in rows for the message list (for windowing). */
  visibleHeight?: number;
  /** Explicit outer height for the panel. */
  height?: number;
  /** Approximate transcript width for manual wrapping/windowing. */
  availableWidth?: number;
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
  pendingBlocks = [],
  isThinking = false,
  reasoningText = "",
  pendingCommandItems = [],
  isFocused = false,
  visibleHeight,
  height,
  availableWidth,
}: ChatPanelProps): React.ReactElement {
  // Account for the "Chat" header line and panel border (top + bottom = 2) + paddingY
  // The MessageList gets the remaining space inside the panel
  const hasReasoning = reasoningText.trim().length > 0;
  const reasoningHeight = hasReasoning ? Math.min(8, Math.max(4, Math.floor((visibleHeight ?? 12) * 0.3))) : 0;
  const messageListHeight = visibleHeight != null ? Math.max(1, visibleHeight - 3 - reasoningHeight) : undefined;

  return (
    <Box
      flexDirection="column"
      flexGrow={1}
      height={height}
      borderStyle="single"
      paddingX={1}
    >
      <Text bold underline>
        Chat
      </Text>
      {hasReasoning ? (
        <ReasoningPanel text={reasoningText} visibleHeight={reasoningHeight} />
      ) : null}
      <MessageList
        messages={messages}
        pendingBlocks={pendingBlocks}
        streamingText={streamingText}
        isThinking={isThinking}
        pendingCommandItems={pendingCommandItems}
        isFocused={isFocused}
        visibleHeight={messageListHeight}
        availableWidth={availableWidth}
      />
    </Box>
  );
}
