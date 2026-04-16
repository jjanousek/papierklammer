import React, { useState, useEffect, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import { CommandBlock } from "./CommandBlock.js";
import { AnimatedGlyph } from "./AnimatedGlyph.js";
import {
  summarizeToolOnlyTurn,
  type ChatMessage,
  type CommandItem,
  type TranscriptBlock,
} from "../hooks/useChat.js";

/** A segment of parsed message text — either plain text or a code block. */
interface TextSegment {
  type: "text" | "code";
  content: string;
  language?: string;
}

type InlineToken =
  | { type: "text"; content: string }
  | { type: "bold"; content: string }
  | { type: "code"; content: string }
  | { type: "link"; label: string; url: string };

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

function isInlineAssistantText(text: string): boolean {
  return !text.includes("```") && !text.includes("\n") && !/\*\*|`|\[[^\]]+\]\([^)]+\)/.test(text);
}

function parseInlineMarkdown(text: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  const pattern = /(\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ type: "text", content: text.slice(lastIndex, match.index) });
    }

    if (typeof match[2] === "string") {
      tokens.push({ type: "bold", content: match[2] });
    } else if (typeof match[3] === "string") {
      tokens.push({ type: "code", content: match[3] });
    } else if (typeof match[4] === "string" && typeof match[5] === "string") {
      tokens.push({ type: "link", label: match[4], url: match[5] });
    }

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    tokens.push({ type: "text", content: text.slice(lastIndex) });
  }

  return tokens.length > 0 ? tokens : [{ type: "text", content: text }];
}

function RenderInlineMarkdown({ text }: { text: string }): React.ReactElement {
  const tokens = parseInlineMarkdown(text);

  return (
    <Text>
      {tokens.map((token, index) => {
        if (token.type === "bold") {
          return (
            <Text key={index} bold>
              {token.content}
            </Text>
          );
        }
        if (token.type === "code") {
          return (
            <Text key={index} color="yellow">
              {token.content}
            </Text>
          );
        }
        if (token.type === "link") {
          return (
            <Text key={index}>
              <Text underline>{token.label}</Text>
              <Text dimColor>{` (${token.url})`}</Text>
            </Text>
          );
        }
        return <Text key={index}>{token.content}</Text>;
      })}
    </Text>
  );
}

function renderMarkdownLine(line: string, key: string): React.ReactElement {
  if (!line.trim()) {
    return <Text key={key}> </Text>;
  }

  const headingMatch = line.match(/^(#{1,3})\s+(.+)$/);
  if (headingMatch) {
    return (
      <Text key={key} bold underline>
        {headingMatch[2] ?? line}
      </Text>
    );
  }

  const bulletMatch = line.match(/^([-*])\s+(.+)$/);
  if (bulletMatch) {
    return (
      <Text key={key}>
        <Text color="cyan">• </Text>
        <RenderInlineMarkdown text={bulletMatch[2] ?? ""} />
      </Text>
    );
  }

  const numberedMatch = line.match(/^(\d+\.)\s+(.+)$/);
  if (numberedMatch) {
    return (
      <Text key={key}>
        <Text color="cyan">{`${numberedMatch[1]} `}</Text>
        <RenderInlineMarkdown text={numberedMatch[2] ?? ""} />
      </Text>
    );
  }

  return <RenderInlineMarkdown key={key} text={line} />;
}

/**
 * Render parsed text segments with code blocks visually distinct.
 */
function RenderedText({ text }: { text: string }): React.ReactElement {
  const segments = parseMarkdown(text);

  if (segments.length === 1 && segments[0]?.type === "text") {
    const lines = segments[0].content.split("\n");
    return (
      <Box flexDirection="column">
        {lines.map((line, index) => renderMarkdownLine(line, `line-${index}`))}
      </Box>
    );
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
        return (
          <Box key={idx} flexDirection="column">
            {segment.content.split("\n").map((line, lineIndex) =>
              renderMarkdownLine(line, `segment-${idx}-line-${lineIndex}`),
            )}
          </Box>
        );
      })}
    </Box>
  );
}

export interface MessageListProps {
  /** Finalized messages. */
  messages: ChatMessage[];
  /** Ordered live transcript blocks for the active turn. */
  pendingBlocks?: TranscriptBlock[];
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

function getAssistantBlocks(message: ChatMessage): TranscriptBlock[] {
  if (message.blocks && message.blocks.length > 0) {
    return message.blocks;
  }

  const blocks: TranscriptBlock[] = [];
  if (message.text.trim().length > 0) {
    blocks.push({
      type: "text",
      text: message.text,
    });
  }

  for (const item of message.items ?? []) {
    blocks.push({
      type: "command",
      item,
    });
  }

  return blocks;
}

function getPendingBlocks(
  pendingBlocks: TranscriptBlock[],
  streamingText: string,
  pendingCommandItems: CommandItem[],
): TranscriptBlock[] {
  if (pendingBlocks.length > 0) {
    return pendingBlocks;
  }

  const blocks: TranscriptBlock[] = [];
  if (streamingText) {
    blocks.push({
      type: "text",
      text: streamingText,
    });
  }

  for (const item of pendingCommandItems) {
    blocks.push({
      type: "command",
      item,
    });
  }

  return blocks;
}

function AssistantBlocks({
  blocks,
}: {
  blocks: TranscriptBlock[];
}): React.ReactElement {
  const textBlocks = blocks.filter((block): block is Extract<TranscriptBlock, { type: "text" }> => block.type === "text");
  const commandBlocks = blocks.filter((block): block is Extract<TranscriptBlock, { type: "command" }> => block.type === "command");
  const hasCommands = commandBlocks.length > 0;
  const inlineOnly =
    blocks.length === 1
    && blocks[0]?.type === "text"
    && isInlineAssistantText(blocks[0].text);

  if (!hasCommands && inlineOnly) {
    return <Text>{textBlocks[0]?.text ?? ""}</Text>;
  }

  const fallbackText =
    textBlocks.length === 0 && commandBlocks.length > 0
      ? summarizeToolOnlyTurn(commandBlocks.map((block) => block.item))
      : null;

  return (
    <Box flexDirection="column">
      {fallbackText ? <RenderedText text={fallbackText} /> : null}
      {blocks.map((block, index) =>
        block.type === "text" ? (
          <RenderedText key={`text-${index}`} text={block.text} />
        ) : (
          <CommandBlock key={`command-${index}`} item={block.item} />
        ),
      )}
    </Box>
  );
}

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
  pendingBlocks = [],
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
  const activePendingBlocks = getPendingBlocks(
    pendingBlocks,
    streamingText,
    pendingCommandItems,
  );

  // Total number of renderable items (messages + streaming/thinking indicator)
  const hasStreamingItem = activePendingBlocks.length > 0 || isThinking;
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

  // Reset scroll offset to show latest messages when terminal is resized (windowSize changes)
  useEffect(() => {
    setScrollOffset(Math.max(0, totalItems - windowSize));
    setUserScrolled(false);
    // Only trigger on windowSize change — totalItems is read but not a dependency,
    // because we only want to reset on resize, not on every new message.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [windowSize]);

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
            const assistantBlocks = msg.role === "assistant" ? getAssistantBlocks(msg) : [];
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
                  assistantBlocks.length === 1
                  && assistantBlocks[0]?.type === "text"
                  && isInlineAssistantText(assistantBlocks[0].text) ? (
                    <Text>
                      <Text color="cyan" bold>
                        Orchestrator:{" "}
                      </Text>
                      <Text>{assistantBlocks[0].text}</Text>
                    </Text>
                  ) : (
                    <Box flexDirection="column">
                      <Text color="cyan" bold>
                        Orchestrator:
                      </Text>
                      <AssistantBlocks blocks={assistantBlocks} />
                    </Box>
                  )
                )}
              </Box>
            );
          })}
          {/* Streaming / thinking indicator (only when scrolled to bottom) */}
          {showStreamingItem && (
            <Box flexDirection="column">
              {isThinking && activePendingBlocks.length === 0 ? (
                <Text>
                  <Text color="cyan" bold>
                    Orchestrator:{" "}
                  </Text>
                  <Text dimColor><AnimatedGlyph name="thinking" /> thinking...</Text>
                </Text>
              ) : activePendingBlocks.length > 0 ? (
                <Box flexDirection="column">
                  <Text color="cyan" bold>
                    Orchestrator:
                  </Text>
                  <AssistantBlocks blocks={activePendingBlocks} />
                  {activePendingBlocks.some((block) => block.type === "text") ? (
                    <Text color="yellow">▌</Text>
                  ) : null}
                </Box>
              ) : null}
            </Box>
          )}
        </>
      )}
    </Box>
  );
}
