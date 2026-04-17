import React, { useState, useEffect, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import { AnimatedGlyph } from "./AnimatedGlyph.js";
import {
  summarizeToolOnlyTurn,
  type ChatMessage,
  type CommandItem,
  type TranscriptBlock,
} from "../hooks/useChat.js";
import { redactSecretLikeText } from "../lib/transcriptRedaction.js";

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
  /** Approximate transcript width for manual wrapping/windowing. */
  availableWidth?: number;
  /** Reports the current transcript viewport state for status surfaces. */
  onViewportChange?: (state: TranscriptViewportState) => void;
}

export interface TranscriptViewportState {
  liveBottom: boolean;
  newerLineCount: number;
  earlierLineCount: number;
}

/** Default visible window size when no explicit height is given. */
const DEFAULT_VISIBLE_WINDOW = 20;
const DEFAULT_WRAP_WIDTH = 76;
const MIN_WRAP_WIDTH = 20;
const MAX_ACTIVITY_OUTPUT_LINES = 4;

interface DisplayLine {
  key: string;
  text?: string;
  element?: React.ReactElement;
}

function wrapText(
  text: string,
  width: number,
  preserveWhitespace = false,
): string[] {
  const normalizedWidth = Math.max(1, Math.floor(width));
  const normalizedText = text.replace(/\t/g, "  ");

  if (normalizedText.length === 0) {
    return [""];
  }

  if (normalizedText.length <= normalizedWidth) {
    return [normalizedText];
  }

  const chunks: string[] = [];
  let remaining = normalizedText;

  while (remaining.length > normalizedWidth) {
    if (preserveWhitespace) {
      chunks.push(remaining.slice(0, normalizedWidth));
      remaining = remaining.slice(normalizedWidth);
      continue;
    }

    const candidate = remaining.slice(0, normalizedWidth);
    const breakIndex = candidate.lastIndexOf(" ");
    if (breakIndex > normalizedWidth * 0.4) {
      chunks.push(candidate.slice(0, breakIndex).trimEnd());
      remaining = remaining.slice(breakIndex + 1).trimStart();
      continue;
    }

    chunks.push(candidate);
    remaining = remaining.slice(normalizedWidth);
  }

  if (remaining.length > 0) {
    chunks.push(remaining);
  }

  return chunks;
}

function wrapWithPrefix(
  prefix: string,
  text: string,
  width: number,
  options: {
    continuationPrefix?: string;
    preserveWhitespace?: boolean;
  } = {},
): string[] {
  const continuationPrefix = options.continuationPrefix ?? " ".repeat(prefix.length);
  const availableWidth = Math.max(1, width - prefix.length);
  const chunks = wrapText(text, availableWidth, options.preserveWhitespace);

  return chunks.map((chunk, index) =>
    `${index === 0 ? prefix : continuationPrefix}${chunk}`,
  );
}

function inlineMarkdownToText(text: string): string {
  return parseInlineMarkdown(text)
    .map((token) => {
      if (token.type === "link") {
        return `${token.label} (${token.url})`;
      }
      return token.content;
    })
    .join("");
}

function markdownLineToText(line: string): string {
  if (!line.trim()) {
    return "";
  }

  const headingMatch = line.match(/^(#{1,3})\s+(.+)$/);
  if (headingMatch) {
    return inlineMarkdownToText(headingMatch[2] ?? line);
  }

  const bulletMatch = line.match(/^([-*])\s+(.+)$/);
  if (bulletMatch) {
    return `• ${inlineMarkdownToText(bulletMatch[2] ?? "")}`;
  }

  const numberedMatch = line.match(/^(\d+\.)\s+(.+)$/);
  if (numberedMatch) {
    return `${numberedMatch[1]} ${inlineMarkdownToText(numberedMatch[2] ?? "")}`;
  }

  return inlineMarkdownToText(line);
}

function getTextBlockLines(
  text: string,
  width: number,
  keyPrefix: string,
  relatedTexts: string[] = [],
): DisplayLine[] {
  const segments = parseMarkdown(redactSecretLikeText(text, { relatedTexts }));
  const lines: DisplayLine[] = [];

  if (segments.length === 0) {
    return lines;
  }

  segments.forEach((segment, segmentIndex) => {
    if (segment.type === "code") {
      lines.push({
        key: `${keyPrefix}-code-top-${segmentIndex}`,
        text: segment.language ? `┌─ [${segment.language}]` : "┌─",
      });
      for (const [lineIndex, rawLine] of segment.content.split("\n").entries()) {
        const wrapped = wrapWithPrefix("│ ", rawLine || " ", width, {
          continuationPrefix: "│ ",
          preserveWhitespace: true,
        });
        wrapped.forEach((wrappedLine, wrappedIndex) => {
          lines.push({
            key: `${keyPrefix}-code-${segmentIndex}-${lineIndex}-${wrappedIndex}`,
            text: wrappedLine,
          });
        });
      }
      lines.push({
        key: `${keyPrefix}-code-bottom-${segmentIndex}`,
        text: "└─",
      });
      return;
    }

    for (const [lineIndex, rawLine] of segment.content.split("\n").entries()) {
      const displayText = markdownLineToText(rawLine);
      const wrapped = wrapText(displayText || " ", width);
      wrapped.forEach((wrappedLine, wrappedIndex) => {
        lines.push({
          key: `${keyPrefix}-text-${segmentIndex}-${lineIndex}-${wrappedIndex}`,
          text: wrappedLine,
        });
      });
    }
  });

  return lines;
}

function getCommandBlockLines(
  item: CommandItem,
  width: number,
  keyPrefix: string,
  relatedTexts: string[] = [],
): DisplayLine[] {
  const command = redactSecretLikeText(item.command, { relatedTexts });
  const output = redactSecretLikeText(item.output, { relatedTexts });
  const outputLines = output ? output.split("\n") : [];
  const visibleOutputLines =
    item.kind === "tool"
      ? outputLines.slice(0, MAX_ACTIVITY_OUTPUT_LINES)
      : outputLines;
  const hiddenOutputLineCount = Math.max(0, outputLines.length - visibleOutputLines.length);
  const status = item.status ?? "completed";
  const statusSummary =
    item.exitCode != null && status !== "running"
      ? `${status} (exit ${item.exitCode})`
      : status;
  const commandLabel = item.kind === "tool" ? `tool: ${command}` : `$ ${command}`;
  const lines: DisplayLine[] = [];

  for (const [index, line] of wrapWithPrefix(
    "",
    `${commandLabel} [${statusSummary}]`,
    width,
    {
      continuationPrefix: "  ",
    },
  ).entries()) {
    lines.push({
      key: `${keyPrefix}-command-${index}`,
      text: line,
    });
  }

  if (visibleOutputLines.length > 0) {
    for (const [lineIndex, rawLine] of visibleOutputLines.entries()) {
      const wrapped = wrapWithPrefix("  ", rawLine || " ", width, {
        continuationPrefix: "  ",
        preserveWhitespace: true,
      });
      wrapped.forEach((wrappedLine, wrappedIndex) => {
        lines.push({
          key: `${keyPrefix}-output-${lineIndex}-${wrappedIndex}`,
          text: wrappedLine,
        });
      });
    }

    if (hiddenOutputLineCount > 0) {
      for (const [index, line] of wrapWithPrefix(
        "  ",
        `… ${hiddenOutputLineCount} more line${hiddenOutputLineCount === 1 ? "" : "s"}`,
        width,
        { continuationPrefix: "  " },
      ).entries()) {
        lines.push({
          key: `${keyPrefix}-hidden-${index}`,
          text: line,
        });
      }
    }
  }
  return lines;
}

function getAssistantDisplayLines(
  blocks: TranscriptBlock[],
  width: number,
  keyPrefix: string,
  options: {
    streaming?: boolean;
  } = {},
): DisplayLine[] {
  const textBlocks = blocks.filter((block): block is Extract<TranscriptBlock, { type: "text" }> => block.type === "text");
  const commandBlocks = blocks.filter((block): block is Extract<TranscriptBlock, { type: "command" }> => block.type === "command");
  const relatedTexts = blocks.flatMap((block) =>
    block.type === "text"
      ? [block.text]
      : [block.item.command, block.item.output],
  );
  const inlineOnly =
    blocks.length === 1
    && blocks[0]?.type === "text"
    && isInlineAssistantText(blocks[0].text);

  if (inlineOnly) {
    const baseLines = wrapWithPrefix(
      "Orchestrator: ",
      inlineMarkdownToText(redactSecretLikeText(textBlocks[0]?.text ?? "", { relatedTexts })),
      width,
    );
    const displayLines = baseLines.map((line, index) => ({
      key: `${keyPrefix}-inline-${index}`,
      text: line,
    }));
    if (options.streaming) {
      displayLines.push({ key: `${keyPrefix}-cursor`, text: "▌" });
    }
    return displayLines;
  }

  const lines: DisplayLine[] = [];
  let prefixedAssistantLead = false;

  blocks.forEach((block, index) => {
    const blockLines =
      block.type === "text"
        ? getTextBlockLines(block.text, width, `${keyPrefix}-text-${index}`, relatedTexts)
        : getCommandBlockLines(block.item, width, `${keyPrefix}-command-${index}`, relatedTexts);

    if (!prefixedAssistantLead && blockLines.length > 0) {
      const firstLine = blockLines[0];
      if (firstLine?.text) {
        blockLines[0] = {
          ...firstLine,
          text: `Orchestrator: ${firstLine.text}`,
        };
        prefixedAssistantLead = true;
      }
    }

    if (block.type === "text") {
      lines.push(...blockLines);
      return;
    }
    lines.push(...blockLines);
  });

  if (!prefixedAssistantLead) {
    lines.push({ key: `${keyPrefix}-label`, text: "Orchestrator:" });
  }

  if (options.streaming && textBlocks.length > 0) {
    lines.push({ key: `${keyPrefix}-cursor`, text: "▌" });
  }

  return lines;
}

function getMessageDisplayLines(
  messages: ChatMessage[],
  width: number,
): DisplayLine[] {
  return messages.flatMap((message, messageIndex) => {
    if (message.role === "user") {
      return wrapWithPrefix("You: ", message.text, width).map((line, lineIndex) => ({
        key: `message-${messageIndex}-user-${lineIndex}`,
        text: line,
      }));
    }

    const assistantBlocks = getAssistantBlocks(message);
    return getAssistantDisplayLines(assistantBlocks, width, `message-${messageIndex}`);
  });
}

function getPendingDisplayLines(
  pendingBlocks: TranscriptBlock[],
  streamingText: string,
  pendingCommandItems: CommandItem[],
  isThinking: boolean,
  width: number,
): DisplayLine[] {
  const activePendingBlocks = getPendingBlocks(
    pendingBlocks,
    streamingText,
    pendingCommandItems,
  );

  if (activePendingBlocks.length > 0) {
    return getAssistantDisplayLines(activePendingBlocks, width, "pending", {
      streaming: activePendingBlocks.some((block) => block.type === "text"),
    });
  }

  if (!isThinking) {
    return [];
  }

  return [
    {
      key: "thinking",
      element: (
        <Text>
          <Text color="cyan" bold>
            Orchestrator:{" "}
          </Text>
          <Text dimColor>
            <AnimatedGlyph name="thinking" /> thinking...
          </Text>
        </Text>
      ),
    },
  ];
}

function getViewportMetrics(
  totalLines: number,
  windowSize: number,
  scrollOffset: number,
  userScrolled: boolean,
): {
  hasMoreAbove: boolean;
  hasMoreBelow: boolean;
  contentWindowSize: number;
  maxScrollOffset: number;
} {
  const liveBottomOffset =
    totalLines > windowSize
      ? Math.max(0, totalLines - Math.max(1, windowSize - 1))
      : 0;
  const hasMoreAbove = scrollOffset > 0;
  const hasMoreBelow = userScrolled && scrollOffset < liveBottomOffset;
  const contentWindowSize = Math.max(
    1,
    windowSize - (hasMoreAbove ? 1 : 0) - (hasMoreBelow ? 1 : 0),
  );

  return {
    hasMoreAbove,
    hasMoreBelow,
    contentWindowSize,
    maxScrollOffset: liveBottomOffset,
  };
}

function getAssistantBlocks(message: ChatMessage): TranscriptBlock[] {
  if (message.blocks && message.blocks.length > 0) {
    return message.blocks;
  }

  const blocks: TranscriptBlock[] = [];
  const isRedundantToolOnlySummary =
    (message.items?.length ?? 0) > 0
    && message.text.trim() === summarizeToolOnlyTurn(message.items ?? []);

  if (message.text.trim().length > 0 && !isRedundantToolOnlySummary) {
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
  availableWidth,
  onViewportChange,
}: MessageListProps): React.ReactElement {
  const [scrollOffset, setScrollOffset] = useState(0);
  const [userScrolled, setUserScrolled] = useState(false);

  const windowSize = visibleHeight ?? DEFAULT_VISIBLE_WINDOW;
  const wrapWidth = Math.max(
    MIN_WRAP_WIDTH,
    Math.floor(availableWidth ?? DEFAULT_WRAP_WIDTH),
  );
  const transcriptLines = getMessageDisplayLines(messages, wrapWidth);
  const pendingLines = getPendingDisplayLines(
    pendingBlocks,
    streamingText,
    pendingCommandItems,
    isThinking,
    wrapWidth,
  );
  const emptyState: DisplayLine[] =
    transcriptLines.length === 0 && pendingLines.length === 0
      ? [
          {
            key: "empty",
            text: "No messages yet. Type below to start a conversation.",
          },
        ]
      : [];
  const contentLines = emptyState.length > 0
    ? emptyState
    : [...transcriptLines, ...pendingLines];
  const totalLines = contentLines.length;
  const viewport = getViewportMetrics(totalLines, windowSize, scrollOffset, userScrolled);

  useEffect(() => {
    setScrollOffset((current) => {
      if (!userScrolled) {
        return viewport.maxScrollOffset;
      }
      return Math.min(current, viewport.maxScrollOffset);
    });
  }, [totalLines, userScrolled, viewport.maxScrollOffset, windowSize]);

  const handleScroll = useCallback(
    (delta: number) => {
      setScrollOffset((prev) => {
        const next = Math.max(0, Math.min(viewport.maxScrollOffset, prev + delta));
        setUserScrolled(next < viewport.maxScrollOffset);
        return next;
      });
    },
    [viewport.maxScrollOffset],
  );

  const handleFollowLive = useCallback(() => {
    setScrollOffset(viewport.maxScrollOffset);
    setUserScrolled(false);
  }, [viewport.maxScrollOffset]);

  useInput(
    (input, key) => {
      if (input === "l") {
        handleFollowLive();
      }
      if (key.upArrow && key.shift) {
        handleScroll(-1);
      }
      if (key.downArrow && key.shift) {
        handleScroll(1);
      }
      if (key.pageUp) {
        handleScroll(-Math.max(1, viewport.contentWindowSize - 1));
      }
      if (key.pageDown) {
        handleScroll(Math.max(1, viewport.contentWindowSize - 1));
      }
    },
    { isActive: isFocused },
  );

  const visibleLines = contentLines.slice(
    scrollOffset,
    scrollOffset + viewport.contentWindowSize,
  );
  const newerLineCount = Math.max(
    0,
    totalLines - (scrollOffset + viewport.contentWindowSize),
  );
  const liveBottom = scrollOffset >= viewport.maxScrollOffset;

  useEffect(() => {
    onViewportChange?.({
      liveBottom,
      newerLineCount,
      earlierLineCount: scrollOffset,
    });
  }, [liveBottom, newerLineCount, onViewportChange, scrollOffset]);

  return (
    <Box flexDirection="column" flexGrow={1} overflow="hidden">
      {viewport.hasMoreAbove ? (
        <Text dimColor>
          ▲ {scrollOffset} earlier line{scrollOffset === 1 ? "" : "s"} above
        </Text>
      ) : null}
      {visibleLines.map((line) =>
        line.element ? (
          <React.Fragment key={line.key}>{line.element}</React.Fragment>
        ) : (
          <Text key={line.key}>{line.text}</Text>
        ),
      )}
      {viewport.hasMoreBelow ? (
        <Text dimColor>
          ▼ {newerLineCount} newer line{newerLineCount === 1 ? "" : "s"} below — l to jump live, or PageDown / Shift+↓ to follow
        </Text>
      ) : null}
    </Box>
  );
}
