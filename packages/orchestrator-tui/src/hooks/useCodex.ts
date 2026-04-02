import { useState, useEffect, useRef, useCallback } from "react";
import { CodexClient, type CodexClientOptions } from "../codex/client.js";
import type { DeltaParams, TurnCompletedParams, ItemStartedParams, ItemCompletedParams, CommandOutputDeltaParams } from "../codex/types.js";

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
  /** Current thread ID (null if no thread started). */
  threadId: string | null;
  /** Send a message. Creates a thread on first call. */
  sendMessage: (text: string, baseInstructions?: string) => Promise<void>;
  /** Interrupt the current turn. */
  interruptTurn: () => Promise<void>;
}

/**
 * React hook wrapping CodexClient lifecycle.
 *
 * Creates the client on mount, destroys on unmount.
 * Manages connection state, thread lifecycle, and turn interaction.
 */
export function useCodex(opts: UseCodexOptions = {}): UseCodexResult {
  const [connectionState, setConnectionState] = useState<ConnectionState>("disconnected");
  const [threadId, setThreadId] = useState<string | null>(null);

  const clientRef = useRef<CodexClient | null>(null);
  const turnIdRef = useRef<string | null>(null);
  const optsRef = useRef(opts);
  optsRef.current = opts;

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
        optsRef.current.onTurnCompleted?.(params);
      },
      onCommandOutput: (params) => optsRef.current.onCommandOutput?.(params),
      onConnected: () => setConnectionState("connected"),
      onDisconnected: () => {
        setConnectionState("disconnected");
        turnIdRef.current = null;
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

  const sendMessage = useCallback(async (text: string, baseInstructions?: string): Promise<void> => {
    const client = clientRef.current;
    if (!client) return;

    try {
      let tid = threadId;

      // Create thread on first message
      if (!tid) {
        tid = await client.startThread({
          ...(baseInstructions ? { baseInstructions } : {}),
        });
        setThreadId(tid);
      }

      setConnectionState("thinking");
      const result = await client.startTurn(tid, text);
      turnIdRef.current = result.turn.id;
    } catch (error) {
      turnIdRef.current = null;
      setConnectionState(client.isConnected ? "connected" : "disconnected");
      optsRef.current.onError?.(
        error instanceof Error ? error : new Error(String(error)),
      );
      throw error;
    }
  }, [threadId]);

  const interruptTurn = useCallback(async (): Promise<void> => {
    const client = clientRef.current;
    const tid = threadId;
    const turnId = turnIdRef.current;

    if (!client || !tid || !turnId) return;

    await client.interrupt(tid, turnId);
    turnIdRef.current = null;
    setConnectionState("connected");
  }, [threadId]);

  return {
    connectionState,
    isConnected: connectionState !== "disconnected",
    isThinking: connectionState === "thinking",
    threadId,
    sendMessage,
    interruptTurn,
  };
}
