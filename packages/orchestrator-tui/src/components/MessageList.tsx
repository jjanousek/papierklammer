import React, { useState, useEffect, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import Spinner from "ink-spinner";
import { CommandBlock } from "./CommandBlock.js";
import type { ChatMessage, CommandItem } from "../hooks/useChat.js";

/** A segment of parsed message text — either plain text or a code block. */
interface TextSegment {
  type: "text" | "code";
  content: string;
  language?: string;
}

/**
 * Parse message text into segments of plain text and code blocks.
 * Detects triple-backtick fenced code blocks (``` ... ```).
 */
function parseMarkdown(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  const regex = /```(\w*)\n?([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    // Add plain text before the code block
    if (match.index > lastIndex) {
      const plain = text.slice(lastIndex, match.index);
      if (plain.trim()) {
        segments.push({ type: "text", content: plain.trim() });
      }
    }

    segments.push({
      type: "code",
      content: match[2]?.trimEnd() ?? "",
      language: match[1] || undefined,
    });

    lastIndex = match.index + match[0].length;
  }

  // Add remaining plain text after last code block
  if (lastIndex < text.length) {
    const remaining = text.slice(lastIndex);
    if (remaining.trim()) {
      segments.push({ type: "text", content: remaining.trim() });
    }
  }

  // If no code blocks were found, return entire text as one segment
  if (segments.length === 0 && text.trim()) {
    segments.push({ type: "text", content: text });
  }

  return segments;
}

/**
 * Render parsed text segments with code blocks visually distinct.
 */
function RenderedText({ text }: { text: string }): React.ReactElement {
  const segments = parseMarkdown(text);

  if (segments.length === 1 && segments[0]?.type === "text") {
    return <Text>{segments[0].content}</Text>;
  }

  return (
    <Box flexDirection="column">
      {segments.map((segment, idx) => {
        if (segment.type === "code") {
          return (
            <Box
              key={idx}
              flexDirection="column"
              borderStyle="single"
              borderColor="gray"
              paddingX={1}
              marginY={0}
            >
              {segment.language ? (
                <Text dimColor>[{segment.language}]</Text>
              ) : null}
              <Text>{segment.content}</Text>
            </Box>
          );
        }
        return <Text key={idx}>{segment.content}</Text>;
      })}
    </Box>
  );
}

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
  /** Available height in rows for the message list (for windowing). */
  visibleHeight?: number;
}

/** Default visible window size when no explicit height is given. */
const DEFAULT_VISIBLE_WINDOW = 20;

/**
 * Scrollable list of chat messages with windowed rendering.
 *
 * Only renders messages within the visible window based on scrollOffset
 * and available height. Auto-scrolls to the bottom when new messages
 * arrive, unless the user has scrolled up.
 * Shift+Up/Down changes the visible window.
 */
export function MessageList({
  messages,
  streamingText,
  isThinking,
  pendingCommandItems,
  isFocused = false,
  visibleHeight,
}: MessageListProps): React.ReactElement {
  const [scrollOffset, setScrollOffset] = useState(0);
  const [userScrolled, setUserScrolled] = useState(false);

  // Window size: use explicit height or fallback
  const windowSize = visibleHeight ?? DEFAULT_VISIBLE_WINDOW;

  // Total number of renderable items (messages + streaming/thinking indicator)
  const hasStreamingItem = streamingText || isThinking || pendingCommandItems.length > 0;
  const totalItems = messages.length + (hasStreamingItem ? 1 : 0);

  // Auto-scroll to bottom when new content arrives, unless user scrolled up
  useEffect(() => {
    if (!userScrolled) {
      setScrollOffset(Math.max(0, totalItems - windowSize));
    }
  }, [totalItems, userScrolled, windowSize]);

  // Reset userScrolled when a new message is finalized (turn completed)
  useEffect(() => {
    setUserScrolled(false);
  }, [messages.length]);

  // Reset scroll offset when terminal is resized (windowSize changes)
  useEffect(() => {
    setScrollOffset((prev) => {
      const maxOffset = Math.max(0, totalItems - windowSize);
      return Math.min(prev, maxOffset);
    });
  }, [windowSize, totalItems]);

  const handleScroll = useCallback(
    (direction: "up" | "down") => {
      if (direction === "up") {
        setUserScrolled(true);
        setScrollOffset((prev) => Math.max(0, prev - 1));
      } else {
        setScrollOffset((prev) => {
          const maxOffset = Math.max(0, totalItems - windowSize);
          const next = Math.min(maxOffset, prev + 1);
          if (next >= maxOffset) {
            setUserScrolled(false);
          }
          return next;
        });
      }
    },
    [totalItems, windowSize],
  );

  // Handle keyboard input for scrolling (Shift+Up/Down and PageUp/PageDown)
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

  // Calculate visible window of messages
  const windowEnd = Math.min(messages.length, scrollOffset + windowSize);
  const windowStart = Math.max(0, scrollOffset);
  const visibleMessages = messages.slice(windowStart, windowEnd);

  // Whether to show the streaming indicator (only if it fits in the window)
  const showStreamingItem = hasStreamingItem && (scrollOffset + windowSize >= totalItems);

  return (
    <Box flexDirection="column" flexGrow={1} overflow="hidden">
      {messages.length === 0 && !streamingText && !isThinking && pendingCommandItems.length === 0 ? (
        <Text dimColor>
          No messages yet. Type below to start a conversation.
        </Text>
      ) : (
        <>
          {scrollOffset > 0 && (
            <Text dimColor>▲ {scrollOffset} more message{scrollOffset !== 1 ? "s" : ""} above</Text>
          )}
          {visibleMessages.map((msg, visIdx) => {
            const idx = windowStart + visIdx;
            return (
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
                    <Box flexDirection="column">
                      <Text color="cyan" bold>
                        Orchestrator:
                      </Text>
                      <RenderedText text={msg.text} />
                    </Box>
                    {msg.items?.map((item, cmdIdx) => (
                      <CommandBlock key={cmdIdx} item={item} />
                    ))}
                  </Box>
                )}
              </Box>
            );
          })}
          {/* Streaming / thinking indicator (only when scrolled to bottom) */}
          {showStreamingItem && (
            <Box flexDirection="column">
              {isThinking && !streamingText ? (
                <Text>
                  <Text color="cyan" bold>
                    Orchestrator:{" "}
                  </Text>
                  <Text dimColor><Spinner type="dots" /> thinking...</Text>
                </Text>
              ) : streamingText ? (
                <Box flexDirection="column">
                  <Text color="cyan" bold>
                    Orchestrator:
                  </Text>
                  <Box>
                    <RenderedText text={streamingText} />
                    <Text color="yellow">▌</Text>
                  </Box>
                </Box>
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
