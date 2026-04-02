import React, { useState, useEffect, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import { CommandBlock } from "./CommandBlock.js";
import type { ChatMessage, CommandItem } from "../hooks/useChat.js";

export interface MessageListProps {
  /** Finalized messages. */
  messages: ChatMessage[];
  /** Currently streaming partial text (not yet finalized). */
  streamingText: string;
  /** Whether the assistant is thinking (show spinner). */
  isThinking: boolean;
  /** Pending command items for current turn. */
  pendingCommandItems: CommandItem[];
  /** Whether this component's parent panel is focused. */
  isFocused?: boolean;
}

/**
 * Scrollable list of chat messages.
 *
 * Auto-scrolls to the bottom when new messages arrive,
 * unless the user has scrolled up.
 */
export function MessageList({
  messages,
  streamingText,
  isThinking,
  pendingCommandItems,
  isFocused = false,
}: MessageListProps): React.ReactElement {
  const [scrollOffset, setScrollOffset] = useState(0);
  const [userScrolled, setUserScrolled] = useState(false);

  // Total number of renderable items (messages + streaming + thinking)
  const totalItems = messages.length + (streamingText || isThinking || pendingCommandItems.length > 0 ? 1 : 0);

  // Auto-scroll to bottom when new content arrives, unless user scrolled up
  useEffect(() => {
    if (!userScrolled) {
      setScrollOffset(Math.max(0, totalItems - 1));
    }
  }, [totalItems, userScrolled]);

  // Reset userScrolled when a new message is finalized (turn completed)
  useEffect(() => {
    setUserScrolled(false);
  }, [messages.length]);

  const handleScroll = useCallback(
    (direction: "up" | "down") => {
      if (direction === "up") {
        setUserScrolled(true);
        setScrollOffset((prev) => Math.max(0, prev - 1));
      } else {
        setScrollOffset((prev) => {
          const next = Math.min(totalItems - 1, prev + 1);
          if (next >= totalItems - 1) {
            setUserScrolled(false);
          }
          return next;
        });
      }
    },
    [totalItems],
  );

  // Handle keyboard input for scrolling
  useInput(
    (_input, key) => {
      if (key.upArrow && key.shift) {
        handleScroll("up");
      }
      if (key.downArrow && key.shift) {
        handleScroll("down");
      }
      if (key.pageUp) {
        handleScroll("up");
      }
      if (key.pageDown) {
        handleScroll("down");
      }
    },
    { isActive: isFocused },
  );

  return (
    <Box flexDirection="column" flexGrow={1} overflow="hidden">
      {messages.length === 0 && !streamingText && !isThinking && pendingCommandItems.length === 0 ? (
        <Text dimColor>
          No messages yet. Type below to start a conversation.
        </Text>
      ) : (
        <>
          {messages.map((msg, idx) => (
            <Box key={idx} flexDirection="column">
              {msg.role === "user" ? (
                <Text>
                  <Text color="green" bold>
                    You:{" "}
                  </Text>
                  <Text>{msg.text}</Text>
                </Text>
              ) : (
                <Box flexDirection="column">
                  <Text>
                    <Text color="cyan" bold>
                      Orchestrator:{" "}
                    </Text>
                    <Text>{msg.text}</Text>
                  </Text>
                  {msg.items?.map((item, cmdIdx) => (
                    <CommandBlock key={cmdIdx} item={item} />
                  ))}
                </Box>
              )}
            </Box>
          ))}
          {/* Streaming / thinking indicator */}
          {(streamingText || isThinking || pendingCommandItems.length > 0) && (
            <Box flexDirection="column">
              {isThinking && !streamingText ? (
                <Text>
                  <Text color="cyan" bold>
                    Orchestrator:{" "}
                  </Text>
                  <Text dimColor>⠋ thinking...</Text>
                </Text>
              ) : streamingText ? (
                <Text>
                  <Text color="cyan" bold>
                    Orchestrator:{" "}
                  </Text>
                  <Text>{streamingText}</Text>
                  <Text color="yellow">▌</Text>
                </Text>
              ) : null}
              {pendingCommandItems.map((item, cmdIdx) => (
                <CommandBlock key={cmdIdx} item={item} />
              ))}
            </Box>
          )}
        </>
      )}
    </Box>
  );
}
