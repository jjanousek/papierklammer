import { useState, useEffect, useRef, useCallback } from "react";
import { CodexClient, type CodexClientOptions } from "../codex/client.js";
import type { DeltaParams, TurnCompletedParams, ItemStartedParams, ItemCompletedParams, CommandOutputDeltaParams, ReasoningDeltaParams, ReasoningEffort, ReasoningSummary, TurnInfo } from "../codex/types.js";

export type ConnectionState = "disconnected" | "connected" | "thinking";

export interface UseCodexOptions extends CodexClientOptions {
  /** Called when a streaming text delta arrives. */
  onDelta?: (params: DeltaParams) => void;
  /** Called when a turn completes. */
  onTurnCompleted?: (params: TurnCompletedParams) => void;
  /** Called when an item starts. */
  onItemStarted?: (params: ItemStartedParams) => void;
  /** Called when an item completes. */
  onItemCompleted?: (params: ItemCompletedParams) => void;
  /** Called when command output arrives. */
  onCommandOutput?: (params: CommandOutputDeltaParams) => void;
  /** Called when reasoning summary text arrives. */
  onReasoningDelta?: (params: ReasoningDeltaParams) => void;
  /** Called when a request or connection action fails. */
  onError?: (error: Error) => void;
}

export interface UseCodexResult {
  /** Current connection state. */
  connectionState: ConnectionState;
  /** Convenience: true when connected or thinking. */
  isConnected: boolean;
  /** Convenience: true when thinking (turn in progress). */
  isThinking: boolean;
  /** Most recent Codex connection or turn error. */
  lastError: string | null;
  /** Current thread ID (null if no thread started). */
  threadId: string | null;
  /** Send a message. Creates a thread on first call. */
  sendMessage: (
    text: string,
    baseInstructions?: string,
    modelReasoningEffort?: ReasoningEffort,
    reasoningSummary?: ReasoningSummary,
    serviceTier?: string,
    model?: string,
  ) => Promise<void>;
  /** Interrupt the current turn. */
  interruptTurn: () => Promise<void>;
}

const ACTIVE_TURN_DISCONNECT_MESSAGE = "Codex connection lost while waiting for a response.";

function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function shouldResetThread(message: string): boolean {
  return /thread not found/i.test(message);
}

function formatTurnError(turn: TurnInfo): string {
  const parts = [
    turn.error?.message ?? "Turn failed",
    turn.error?.additionalDetails ?? null,
  ];
  return parts.filter((part): part is string => Boolean(part)).join(" — ");
}

/**
 * React hook wrapping CodexClient lifecycle.
 *
 * Creates the client on mount, destroys on unmount.
 * Manages connection state, thread lifecycle, and turn interaction.
 */
export function useCodex(opts: UseCodexOptions = {}): UseCodexResult {
  const [connectionState, setConnectionState] = useState<ConnectionState>("disconnected");
  const [lastError, setLastError] = useState<string | null>(null);
  const [threadId, setThreadId] = useState<string | null>(null);

  const clientRef = useRef<CodexClient | null>(null);
  const turnIdRef = useRef<string | null>(null);
  const threadIdRef = useRef<string | null>(null);
  const lastErrorRef = useRef<string | null>(null);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const setErrorMessage = useCallback((message: string | null): void => {
    lastErrorRef.current = message;
    setLastError(message);
  }, []);

  const resetThreadState = useCallback((): void => {
    threadIdRef.current = null;
    setThreadId(null);
  }, []);

  // Create client on mount, destroy on unmount
  useEffect(() => {
    const client = new CodexClient({
      spawnFn: optsRef.current.spawnFn,
      autoReconnect: optsRef.current.autoReconnect,
      reconnectDelayMs: optsRef.current.reconnectDelayMs,
    });

    client.callbacks = {
      onDelta: (params) => optsRef.current.onDelta?.(params),
      onItemStarted: (params) => optsRef.current.onItemStarted?.(params),
      onItemCompleted: (params) => optsRef.current.onItemCompleted?.(params),
      onTurnCompleted: (params) => {
        turnIdRef.current = null;
        setConnectionState("connected");
        if (params.turn.status === "failed") {
          setErrorMessage(formatTurnError(params.turn));
        } else {
          setErrorMessage(null);
        }
        optsRef.current.onTurnCompleted?.(params);
      },
      onCommandOutput: (params) => optsRef.current.onCommandOutput?.(params),
      onReasoningDelta: (params) => optsRef.current.onReasoningDelta?.(params),
      onConnected: () => {
        setConnectionState("connected");
        setErrorMessage(null);
      },
      onDisconnected: () => {
        const hadActiveTurn = turnIdRef.current !== null;
        setConnectionState("disconnected");
        turnIdRef.current = null;
        resetThreadState();
        if (hadActiveTurn) {
          const error = new Error(ACTIVE_TURN_DISCONNECT_MESSAGE);
          setErrorMessage(error.message);
          optsRef.current.onError?.(error);
        }
      },
      onError: (error) => {
        setErrorMessage(normalizeError(error).message);
      },
    };

    clientRef.current = client;

    // Initialize the handshake
    void client.initialize().then(() => {
      setConnectionState("connected");
    }).catch(() => {
      // Initialization failed — will be retried on reconnect
    });

    return () => {
      client.destroy();
      clientRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const sendMessage = useCallback(async (
    text: string,
    baseInstructions?: string,
    modelReasoningEffort?: ReasoningEffort,
    reasoningSummary?: ReasoningSummary,
    serviceTier?: string,
    model?: string,
  ): Promise<void> => {
    const client = clientRef.current;
    if (!client) {
      const err = new Error("Codex client is not available");
      optsRef.current.onError?.(err);
      throw err;
    }

    try {
      if (!client.isConnected) {
        await client.reconnect();
        setConnectionState("connected");
      }

      setErrorMessage(null);
      let tid = threadIdRef.current;

      // Create thread on first message
      if (!tid) {
        tid = await client.startThread({
          ...(model ? { model } : {}),
          ...(baseInstructions ? { baseInstructions } : {}),
          ...(modelReasoningEffort ? { modelReasoningEffort } : {}),
          ...(serviceTier ? { serviceTier } : {}),
        });
        threadIdRef.current = tid;
        setThreadId(tid);
      }

      setConnectionState("thinking");
      const overrides: {
        modelReasoningEffort?: ReasoningEffort;
        summary?: ReasoningSummary;
        serviceTier?: string;
      } = {};
      if (modelReasoningEffort) overrides.modelReasoningEffort = modelReasoningEffort;
      if (reasoningSummary) overrides.summary = reasoningSummary;
      if (serviceTier) overrides.serviceTier = serviceTier;
      const result = await client.startTurn(tid, text, Object.keys(overrides).length > 0 ? overrides : undefined);
      turnIdRef.current = result.turn.id;
    } catch (error) {
      turnIdRef.current = null;
      const normalizedError = normalizeError(error);
      const message =
        !client.isConnected && lastErrorRef.current
          ? lastErrorRef.current
          : normalizedError.message;
      const alreadyReported = lastErrorRef.current === message;

      if (shouldResetThread(message)) {
        resetThreadState();
      }

      setConnectionState(client.isConnected ? "connected" : "disconnected");
      setErrorMessage(message);
      if (!alreadyReported || client.isConnected) {
        optsRef.current.onError?.(new Error(message));
      }
      throw new Error(message);
    }
  }, [resetThreadState, setErrorMessage]);

  const interruptTurn = useCallback(async (): Promise<void> => {
    const client = clientRef.current;
    const tid = threadIdRef.current;
    const turnId = turnIdRef.current;

    if (!client || !tid || !turnId) return;

    await client.interrupt(tid, turnId);
    turnIdRef.current = null;
    setConnectionState("connected");
  }, []);

  return {
    connectionState,
    isConnected: connectionState !== "disconnected",
    isThinking: connectionState === "thinking",
    lastError,
    threadId,
    sendMessage,
    interruptTurn,
  };
}
