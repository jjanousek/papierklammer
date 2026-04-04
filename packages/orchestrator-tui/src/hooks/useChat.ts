import { useState, useCallback, useRef } from "react";

export interface CommandItem {
  command: string;
  output: string;
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
  /** Whether the assistant is currently thinking/streaming. */
  isThinking: boolean;
  /** Command items accumulated during the current turn. */
  pendingCommandItems: CommandItem[];
  /** Send a user message. */
  sendMessage: (text: string) => void;
  /** Append a text delta to the current streaming response. */
  onDelta: (text: string) => void;
  /** Finalize the current streaming response as an assistant message. */
  onTurnCompleted: () => void;
  /** Track a command execution. */
  onCommandExecution: (command: string, output: string) => void;
  /** Surface an assistant-visible error without crashing the TUI. */
  onError: (message: string) => void;
  /**
   * Recover a still-pending turn from a send failure without duplicating an
   * error that was already surfaced through another callback path.
   */
  recoverFromPendingError: (message: string) => void;
  /** Set the thinking state (e.g. between send and first delta). */
  setIsThinking: (thinking: boolean) => void;
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
  const [isThinking, setIsThinking] = useState(false);
  const pendingTurnRef = useRef(false);
  const pendingCommandItemsRef = useRef<CommandItem[]>([]);
  const [pendingCommandItems, setPendingCommandItems] = useState<CommandItem[]>([]);

  const sendMessage = useCallback((text: string): void => {
    const userMessage: ChatMessage = {
      role: "user",
      text,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMessage]);
    pendingTurnRef.current = true;
    setIsThinking(true);
    setStreamingText("");
    pendingCommandItemsRef.current = [];
    setPendingCommandItems([]);
  }, []);

  const onDelta = useCallback((text: string): void => {
    setStreamingText((prev) => prev + text);
    // First delta means we're no longer just "thinking" — we're streaming
    setIsThinking(false);
  }, []);

  const onTurnCompleted = useCallback((): void => {
    setStreamingText((current) => {
      if (current || pendingCommandItemsRef.current.length > 0) {
        const assistantMessage: ChatMessage = {
          role: "assistant",
          text: current,
          timestamp: new Date(),
          items:
            pendingCommandItemsRef.current.length > 0
              ? [...pendingCommandItemsRef.current]
              : undefined,
        };
        setMessages((prev) => [...prev, assistantMessage]);
      }
      return "";
    });
    pendingTurnRef.current = false;
    setIsThinking(false);
    pendingCommandItemsRef.current = [];
    setPendingCommandItems([]);
  }, []);

  const onCommandExecution = useCallback(
    (command: string, output: string): void => {
      const item: CommandItem = { command, output };
      pendingCommandItemsRef.current = [
        ...pendingCommandItemsRef.current,
        item,
      ];
      setPendingCommandItems([...pendingCommandItemsRef.current]);
    },
    [],
  );

  const onError = useCallback((message: string): void => {
    setStreamingText("");
    setIsThinking(false);
    pendingTurnRef.current = false;
    const assistantMessage: ChatMessage = {
      role: "assistant",
      text: `Error: ${message}`,
      timestamp: new Date(),
      items:
        pendingCommandItemsRef.current.length > 0
          ? [...pendingCommandItemsRef.current]
          : undefined,
    };
    setMessages((prev) => [...prev, assistantMessage]);
    pendingCommandItemsRef.current = [];
    setPendingCommandItems([]);
  }, []);

  const recoverFromPendingError = useCallback((message: string): void => {
    if (!pendingTurnRef.current) {
      return;
    }

    setStreamingText("");
    setIsThinking(false);
    pendingTurnRef.current = false;

    const assistantMessage: ChatMessage = {
      role: "assistant",
      text: `Error: ${message}`,
      timestamp: new Date(),
      items:
        pendingCommandItemsRef.current.length > 0
          ? [...pendingCommandItemsRef.current]
          : undefined,
    };
    setMessages((prev) => [...prev, assistantMessage]);
    pendingCommandItemsRef.current = [];
    setPendingCommandItems([]);
  }, []);

  return {
    messages,
    streamingText,
    isThinking,
    pendingCommandItems,
    sendMessage,
    onDelta,
    onTurnCompleted,
    onCommandExecution,
    onError,
    recoverFromPendingError,
    setIsThinking,
  };
}
