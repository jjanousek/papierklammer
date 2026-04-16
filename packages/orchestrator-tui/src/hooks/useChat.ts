import { useState, useCallback, useRef } from "react";
import { useEffect } from "react";

export interface CommandItem {
  id?: string;
  command: string;
  output: string;
  status?: "running" | "completed" | "failed" | "interrupted";
  exitCode?: number | null;
}

export interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  timestamp: Date;
  items?: CommandItem[];
}

export interface UseChatResult {
  /** All finalized messages. */
  messages: ChatMessage[];
  /** Partial streaming text for the current assistant response. */
  streamingText: string;
  /** Partial or recent reasoning text for the active turn. */
  reasoningText: string;
  /** Whether the assistant is currently thinking/streaming. */
  isThinking: boolean;
  /** Command items accumulated during the current turn. */
  pendingCommandItems: CommandItem[];
  /** Send a user message. */
  sendMessage: (text: string) => boolean;
  /** Append a text delta to the current streaming response. */
  onDelta: (text: string) => void;
  /** Append a reasoning delta to the current reasoning view. */
  onReasoningDelta: (text: string) => void;
  /** Finalize the current streaming response as an assistant message. */
  onTurnCompleted: (status?: "completed" | "interrupted") => void;
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

function withPendingCommandItemsTerminalStatus(
  items: CommandItem[],
  fallbackStatus: "completed" | "interrupted",
): CommandItem[] {
  return items.map((item) => {
    if (!item.status || item.status === "running") {
      return { ...item, status: fallbackStatus };
    }
    return item;
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
  const [streamingText, setStreamingText] = useState("");
  const [reasoningText, setReasoningText] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const streamingTextRef = useRef("");
  const pendingTurnRef = useRef(false);
  const pendingCommandItemsRef = useRef<CommandItem[]>([]);
  const [pendingCommandItems, setPendingCommandItems] = useState<CommandItem[]>([]);

  const updatePendingCommandItems = useCallback(
    (
      updater: (items: CommandItem[]) => CommandItem[],
    ): CommandItem[] => {
      const nextItems = updater(pendingCommandItemsRef.current);
      pendingCommandItemsRef.current = nextItems;
      setPendingCommandItems(nextItems);
      return nextItems;
    },
    [],
  );

  useEffect(() => {
    const lastMessage = messages[messages.length - 1];
    if (lastMessage?.role !== "assistant" || !lastMessage.text.startsWith("Error:")) {
      return;
    }

    pendingTurnRef.current = false;
    pendingCommandItemsRef.current = [];
    setPendingCommandItems([]);
    setStreamingText("");
    setIsThinking(false);
  }, [messages]);

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
    streamingTextRef.current = "";
    setStreamingText("");
    setReasoningText("");
    updatePendingCommandItems(() => []);
    return true;
  }, [updatePendingCommandItems]);

  const onDelta = useCallback((text: string): void => {
    streamingTextRef.current += text;
    setStreamingText((prev) => prev + text);
    // First delta means we're no longer just "thinking" — we're streaming
    setIsThinking(false);
  }, []);

  const onReasoningDelta = useCallback((text: string): void => {
    setReasoningText((prev) => prev + text);
  }, []);

  const onTurnCompleted = useCallback((status: "completed" | "interrupted" = "completed"): void => {
    const finalizedStreamingText = streamingTextRef.current;
    const finalizedCommandItems = withPendingCommandItemsTerminalStatus(
      pendingCommandItemsRef.current,
      status === "interrupted" ? "interrupted" : "completed",
    );
    if (finalizedStreamingText || finalizedCommandItems.length > 0) {
      const assistantMessage: ChatMessage = {
        role: "assistant",
        text: finalizedStreamingText || summarizeToolOnlyTurn(finalizedCommandItems),
        timestamp: new Date(),
        items:
          finalizedCommandItems.length > 0
            ? [...finalizedCommandItems]
            : undefined,
      };
      setMessages((prev) => [...prev, assistantMessage]);
    }
    streamingTextRef.current = "";
    setStreamingText("");
    pendingTurnRef.current = false;
    setIsThinking(false);
    updatePendingCommandItems(() => []);
  }, [updatePendingCommandItems]);

  const onCommandStarted = useCallback(
    (itemId: string, command: string, output = ""): void => {
      updatePendingCommandItems((items) => {
        const existingIndex = items.findIndex((item) => item.id === itemId);
        if (existingIndex === -1) {
          return [...items, { id: itemId, command, output, status: "running", exitCode: null }];
        }

        return items.map((item, index) =>
          index === existingIndex
            ? {
                ...item,
                command,
                output: output || item.output,
                status: item.status ?? "running",
              }
            : item,
        );
      });
    },
    [updatePendingCommandItems],
  );

  const onCommandOutput = useCallback(
    (itemId: string, outputDelta: string): void => {
      updatePendingCommandItems((items) => {
        const existingIndex = items.findIndex((item) => item.id === itemId);
        if (existingIndex === -1) {
          return [
            ...items,
            {
              id: itemId,
              command: "Tool call",
              output: outputDelta,
              status: "running",
              exitCode: null,
            },
          ];
        }

        return items.map((item, index) =>
          index === existingIndex
            ? {
                ...item,
                output: `${item.output}${outputDelta}`,
                status: item.status === "completed" ? "completed" : "running",
              }
            : item,
        );
      });
    },
    [updatePendingCommandItems],
  );

  const onCommandExecution = useCallback(
    (
      itemId: string,
      command: string,
      output: string,
      status: "running" | "completed" | "failed" | "interrupted" = "completed",
      exitCode: number | null = null,
    ): void => {
      updatePendingCommandItems((items) => {
        const existingIndex = items.findIndex((item) => item.id === itemId);
        if (existingIndex === -1) {
          return [...items, { id: itemId, command, output, status, exitCode }];
        }

        return items.map((item, index) =>
          index === existingIndex
            ? {
                ...item,
                command,
                output: output || item.output,
                status,
                exitCode,
              }
            : item,
        );
      });
    },
    [updatePendingCommandItems],
  );

  const onError = useCallback((message: string): void => {
    streamingTextRef.current = "";
    setStreamingText("");
    setIsThinking(false);
    pendingTurnRef.current = false;
    const finalizedCommandItems = withPendingCommandItemsTerminalStatus(
      pendingCommandItemsRef.current,
      "interrupted",
    );
    const assistantMessage: ChatMessage = {
      role: "assistant",
      text: `Error: ${message}`,
      timestamp: new Date(),
      items:
        finalizedCommandItems.length > 0
          ? [...finalizedCommandItems]
          : undefined,
    };
    setMessages((prev) => [...prev, assistantMessage]);
    updatePendingCommandItems(() => []);
  }, [updatePendingCommandItems]);

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

    streamingTextRef.current = "";
    setStreamingText("");
    setIsThinking(false);
    pendingTurnRef.current = false;
    const finalizedCommandItems = withPendingCommandItemsTerminalStatus(
      pendingCommandItemsRef.current,
      "interrupted",
    );

    const assistantMessage: ChatMessage = {
      role: "assistant",
      text: `Error: ${message}`,
      timestamp: new Date(),
      items:
        finalizedCommandItems.length > 0
          ? [...finalizedCommandItems]
          : undefined,
    };
    setMessages((prev) => [...prev, assistantMessage]);
    updatePendingCommandItems(() => []);
  }, [updatePendingCommandItems]);

  return {
    messages,
    streamingText,
    reasoningText,
    isThinking,
    pendingCommandItems,
    sendMessage,
    onDelta,
    onReasoningDelta,
    onTurnCompleted,
    onCommandStarted,
    onCommandOutput,
    onCommandExecution,
    onError,
    appendAssistantMessage,
    recoverFromPendingError,
    setIsThinking,
  };
}
