import { useState, useCallback, useRef } from "react";
import { useEffect } from "react";

export interface CommandItem {
  id?: string;
  command: string;
  output: string;
  status?: "running" | "completed" | "failed" | "interrupted";
  exitCode?: number | null;
}

export interface TextBlock {
  type: "text";
  itemId?: string;
  text: string;
}

export interface CommandBlockItem {
  type: "command";
  itemId?: string;
  item: CommandItem;
}

export type TranscriptBlock = TextBlock | CommandBlockItem;

export interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  timestamp: Date;
  items?: CommandItem[];
  blocks?: TranscriptBlock[];
}

export interface UseChatResult {
  /** All finalized messages. */
  messages: ChatMessage[];
  /** Ordered live transcript blocks for the current assistant response. */
  pendingBlocks: TranscriptBlock[];
  /** Partial streaming text for the current assistant response. */
  streamingText: string;
  /** Partial or recent reasoning text for the active turn. */
  reasoningText: string;
  /** Whether a live reasoning item is active for the current turn. */
  reasoningActive: boolean;
  /** Whether the assistant is currently thinking/streaming. */
  isThinking: boolean;
  /** Command items accumulated during the current turn. */
  pendingCommandItems: CommandItem[];
  /** Send a user message. */
  sendMessage: (text: string) => boolean;
  /** Append a text delta to the current streaming response. */
  onDelta: (itemId: string, text: string) => void;
  /** Mark a reasoning item as active for the current turn. */
  onReasoningStarted: () => void;
  /** Append a reasoning delta to the current reasoning view. */
  onReasoningDelta: (text: string) => void;
  /** Finalize the current streaming response as an assistant message. */
  onTurnCompleted: (status?: "completed" | "interrupted") => void;
  /** Finalize a failed turn, preserving seen output before surfacing the error. */
  onTurnFailed: (message: string) => void;
  /** Track the start of a command execution. */
  onCommandStarted: (itemId: string, command: string, output?: string) => void;
  /** Append live output to a running command execution. */
  onCommandOutput: (itemId: string, outputDelta: string) => void;
  /** Track a finalized command execution. */
  onCommandExecution: (
    itemId: string,
    command: string,
    output: string,
    status?: "running" | "completed" | "failed" | "interrupted",
    exitCode?: number | null,
  ) => void;
  /** Surface an assistant-visible error without crashing the TUI. */
  onError: (message: string) => void;
  /** Append an assistant-visible message for local shortcut results. */
  appendAssistantMessage: (message: string) => void;
  /**
   * Recover a still-pending turn from a send failure without duplicating an
   * error that was already surfaced through another callback path.
   */
  recoverFromPendingError: (message: string) => void;
  /** Set the thinking state (e.g. between send and first delta). */
  setIsThinking: (thinking: boolean) => void;
}

function summarizeCommandItems(items: CommandItem[]): string {
  const counts = items.reduce<Record<string, number>>((acc, item) => {
    const key = item.status ?? "completed";
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  const parts = [
    counts.running ? `${counts.running} running` : null,
    counts.completed ? `${counts.completed} completed` : null,
    counts.failed ? `${counts.failed} failed` : null,
    counts.interrupted ? `${counts.interrupted} interrupted` : null,
  ].filter((part): part is string => Boolean(part));

  return parts.length > 0 ? parts.join(", ") : `${items.length} completed`;
}

export function summarizeToolOnlyTurn(items: CommandItem[]): string {
  if (items.length === 0) {
    return "Tool activity";
  }

  const noun = items.length === 1 ? "tool call" : "tool calls";
  return `Tool activity — ${summarizeCommandItems(items)} ${noun}.`;
}

function extractCommandItems(blocks: TranscriptBlock[]): CommandItem[] {
  return blocks.flatMap((block) => (block.type === "command" ? [block.item] : []));
}

function flattenTranscriptText(blocks: TranscriptBlock[]): string {
  return blocks
    .flatMap((block) => (block.type === "text" && block.text.trim().length > 0 ? [block.text] : []))
    .join("\n\n");
}

function withPendingCommandItemsTerminalStatus(
  blocks: TranscriptBlock[],
  fallbackStatus: "completed" | "failed" | "interrupted",
): TranscriptBlock[] {
  return blocks.map((block) => {
    if (block.type !== "command") {
      return block;
    }

    if (!block.item.status || block.item.status === "running") {
      return {
        ...block,
        item: {
          ...block.item,
          status: fallbackStatus,
        },
      };
    }

    return block;
  });
}

/**
 * Chat state management hook.
 *
 * Manages message history, streaming text, command execution items,
 * and thinking state. Works in conjunction with useCodex for the
 * actual Codex communication.
 */
export function useChat(): UseChatResult {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pendingBlocks, setPendingBlocks] = useState<TranscriptBlock[]>([]);
  const [reasoningText, setReasoningText] = useState("");
  const [reasoningActive, setReasoningActive] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const pendingTurnRef = useRef(false);
  const pendingBlocksRef = useRef<TranscriptBlock[]>([]);

  const updatePendingBlocks = useCallback(
    (
      updater: (blocks: TranscriptBlock[]) => TranscriptBlock[],
    ): TranscriptBlock[] => {
      const nextBlocks = updater(pendingBlocksRef.current);
      pendingBlocksRef.current = nextBlocks;
      setPendingBlocks(nextBlocks);
      return nextBlocks;
    },
    [],
  );

  useEffect(() => {
    const lastMessage = messages[messages.length - 1];
    if (lastMessage?.role !== "assistant" || !lastMessage.text.startsWith("Error:")) {
      return;
    }

    pendingTurnRef.current = false;
    pendingBlocksRef.current = [];
    setPendingBlocks([]);
    setReasoningText("");
    setReasoningActive(false);
    setIsThinking(false);
  }, [messages]);

  const clearPendingTurn = useCallback(() => {
    pendingTurnRef.current = false;
    setIsThinking(false);
    setReasoningText("");
    setReasoningActive(false);
    updatePendingBlocks(() => []);
  }, [updatePendingBlocks]);

  const finalizePendingTurn = useCallback(
    (status: "completed" | "interrupted" | "failed"): TranscriptBlock[] => {
      const fallbackStatus =
        status === "completed"
          ? "completed"
          : status === "failed"
            ? "failed"
            : "interrupted";
      const finalizedBlocks = withPendingCommandItemsTerminalStatus(
        pendingBlocksRef.current,
        fallbackStatus,
      );
      const assistantText = flattenTranscriptText(finalizedBlocks);
      const commandItems = extractCommandItems(finalizedBlocks);

      if (assistantText || commandItems.length > 0) {
        const assistantMessage: ChatMessage = {
          role: "assistant",
          text: assistantText || summarizeToolOnlyTurn(commandItems),
          timestamp: new Date(),
          items: commandItems.length > 0 ? [...commandItems] : undefined,
          blocks: finalizedBlocks.length > 0 ? finalizedBlocks : undefined,
        };
        setMessages((prev) => [...prev, assistantMessage]);
      }

      clearPendingTurn();
      return finalizedBlocks;
    },
    [clearPendingTurn],
  );

  const sendMessage = useCallback((text: string): boolean => {
    const normalizedText = text.trim();
    if (!normalizedText || pendingTurnRef.current) {
      return false;
    }

    const userMessage: ChatMessage = {
      role: "user",
      text: normalizedText,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMessage]);
    pendingTurnRef.current = true;
    setIsThinking(true);
    setReasoningText("");
    setReasoningActive(false);
    updatePendingBlocks(() => []);
    return true;
  }, [updatePendingBlocks]);

  const onReasoningStarted = useCallback((): void => {
    setReasoningActive(true);
  }, []);

  const onDelta = useCallback((itemId: string, text: string): void => {
    updatePendingBlocks((blocks) => {
      const lastBlock = blocks[blocks.length - 1];
      if (
        lastBlock?.type === "text"
        && lastBlock.itemId === itemId
      ) {
        return [
          ...blocks.slice(0, -1),
          {
            ...lastBlock,
            text: `${lastBlock.text}${text}`,
          },
        ];
      }

      return [
        ...blocks,
        {
          type: "text",
          itemId,
          text,
        },
      ];
    });
    // First delta means we're no longer just "thinking" — we're streaming
    setIsThinking(false);
  }, [updatePendingBlocks]);

  const onReasoningDelta = useCallback((text: string): void => {
    setReasoningActive(true);
    setReasoningText((prev) => prev + text);
  }, []);

  const onTurnCompleted = useCallback((status: "completed" | "interrupted" = "completed"): void => {
    finalizePendingTurn(status);
  }, [finalizePendingTurn]);

  const onTurnFailed = useCallback((message: string): void => {
    finalizePendingTurn("failed");
    setMessages((prev) => [
      ...prev,
      {
        role: "assistant",
        text: `Error: ${message}`,
        timestamp: new Date(),
      },
    ]);
  }, [finalizePendingTurn]);

  const onCommandStarted = useCallback(
    (itemId: string, command: string, output = ""): void => {
      updatePendingBlocks((blocks) => {
        const existingIndex = blocks.findIndex(
          (block) => block.type === "command" && block.item.id === itemId,
        );
        if (existingIndex === -1) {
          return [
            ...blocks,
            {
              type: "command",
              itemId,
              item: { id: itemId, command, output, status: "running", exitCode: null },
            },
          ];
        }

        return blocks.map((block, index) =>
          index === existingIndex && block.type === "command"
            ? {
                ...block,
                item: {
                  ...block.item,
                  command,
                  output: output || block.item.output,
                  status: block.item.status ?? "running",
                },
              }
            : block,
        );
      });
    },
    [updatePendingBlocks],
  );

  const onCommandOutput = useCallback(
    (itemId: string, outputDelta: string): void => {
      updatePendingBlocks((blocks) => {
        const existingIndex = blocks.findIndex(
          (block) => block.type === "command" && block.item.id === itemId,
        );
        if (existingIndex === -1) {
          return [
            ...blocks,
            {
              type: "command",
              itemId,
              item: {
                id: itemId,
                command: "Tool call",
                output: outputDelta,
                status: "running",
                exitCode: null,
              },
            },
          ];
        }

        return blocks.map((block, index) =>
          index === existingIndex && block.type === "command"
            ? {
                ...block,
                item: {
                  ...block.item,
                  output: `${block.item.output}${outputDelta}`,
                  status: block.item.status === "completed" ? "completed" : "running",
                },
              }
            : block,
        );
      });
    },
    [updatePendingBlocks],
  );

  const onCommandExecution = useCallback(
    (
      itemId: string,
      command: string,
      output: string,
      status: "running" | "completed" | "failed" | "interrupted" = "completed",
      exitCode: number | null = null,
    ): void => {
      updatePendingBlocks((blocks) => {
        const existingIndex = blocks.findIndex(
          (block) => block.type === "command" && block.item.id === itemId,
        );
        if (existingIndex === -1) {
          return [
            ...blocks,
            {
              type: "command",
              itemId,
              item: { id: itemId, command, output, status, exitCode },
            },
          ];
        }

        return blocks.map((block, index) =>
          index === existingIndex && block.type === "command"
            ? {
                ...block,
                item: {
                  ...block.item,
                  command,
                  output: output || block.item.output,
                  status,
                  exitCode,
                },
              }
            : block,
        );
      });
    },
    [updatePendingBlocks],
  );

  const onError = useCallback((message: string): void => {
    finalizePendingTurn("interrupted");
    setMessages((prev) => [
      ...prev,
      {
        role: "assistant",
        text: `Error: ${message}`,
        timestamp: new Date(),
      },
    ]);
  }, [finalizePendingTurn]);

  const appendAssistantMessage = useCallback((message: string): void => {
    setMessages((prev) => [
      ...prev,
      {
        role: "assistant",
        text: message,
        timestamp: new Date(),
      },
    ]);
  }, []);

  const recoverFromPendingError = useCallback((message: string): void => {
    if (!pendingTurnRef.current) {
      return;
    }

    finalizePendingTurn("interrupted");
    setMessages((prev) => [
      ...prev,
      {
        role: "assistant",
        text: `Error: ${message}`,
        timestamp: new Date(),
      },
    ]);
  }, [finalizePendingTurn]);

  const streamingText = flattenTranscriptText(pendingBlocks);
  const pendingCommandItems = extractCommandItems(pendingBlocks);

  return {
    messages,
    pendingBlocks,
    streamingText,
    reasoningText,
    reasoningActive,
    isThinking,
    pendingCommandItems,
    sendMessage,
    onDelta,
    onReasoningStarted,
    onReasoningDelta,
    onTurnCompleted,
    onTurnFailed,
    onCommandStarted,
    onCommandOutput,
    onCommandExecution,
    onError,
    appendAssistantMessage,
    recoverFromPendingError,
    setIsThinking,
  };
}
