import React, { useState, useEffect, useCallback, useRef } from "react";
import { Box, useApp, useInput } from "ink";
import { HeaderBar } from "./HeaderBar.js";
import { AgentSidebar } from "./AgentSidebar.js";
import { ChatPanel } from "./ChatPanel.js";
import { InputBar } from "./InputBar.js";
import { StatusBar } from "./StatusBar.js";
import { HelpOverlay } from "./HelpOverlay.js";
import type { CodexState } from "./StatusBar.js";
import { useOrchestratorStatus } from "../hooks/useOrchestratorStatus.js";
import { useChat } from "../hooks/useChat.js";
import { useCodex } from "../hooks/useCodex.js";
import type { spawn as spawnType } from "node:child_process";
import type {
  DeltaParams,
  TurnCompletedParams,
  ItemCompletedParams,
  CommandOutputDeltaParams,
} from "../codex/types.js";

export interface AppProps {
  url: string;
  apiKey: string;
  companyId: string;
  codexState?: CodexState;
  threadId?: string;
  model?: string;
  /** Injected fetch for testing */
  fetchFn?: typeof globalThis.fetch;
  /** Polling interval override for testing */
  pollInterval?: number;
  /** Override spawn for testing (disables Codex if undefined in tests). */
  spawnFn?: typeof spawnType;
  /** Whether to enable Codex integration. Defaults to true if spawnFn is provided. */
  enableCodex?: boolean;
}

export function App({
  url,
  apiKey,
  companyId,
  codexState: codexStateProp,
  threadId: threadIdProp,
  model,
  fetchFn,
  pollInterval = 5000,
  spawnFn,
  enableCodex = false,
}: AppProps): React.ReactElement {
  const { exit } = useApp();
  const [helpVisible, setHelpVisible] = useState(false);
  const inputFocusedRef = useRef(false);

  // Enter alternate screen buffer on mount, restore on unmount
  useEffect(() => {
    process.stdout.write("\x1b[?1049h");
    return () => {
      process.stdout.write("\x1b[?1049l");
    };
  }, []);

  // Handle Ctrl+C for clean exit and '?' for help overlay
  useInput((_input, key) => {
    if (key.ctrl && _input === "c") {
      exit();
    }
    // Toggle help overlay with '?' when input bar is not focused
    // Only open (not close) from here — closing is handled by HelpOverlay itself
    if (_input === "?" && !inputFocusedRef.current && !helpVisible) {
      setHelpVisible(true);
    }
  });

  const status = useOrchestratorStatus(
    url,
    apiKey,
    companyId,
    pollInterval,
    fetchFn,
  );

  const chat = useChat();

  // Callbacks for the Codex hook
  const handleDelta = useCallback(
    (params: DeltaParams) => {
      chat.onDelta(params.delta);
    },
    [chat.onDelta],
  );

  const handleTurnCompleted = useCallback(
    (_params: TurnCompletedParams) => {
      chat.onTurnCompleted();
    },
    [chat.onTurnCompleted],
  );

  const handleItemCompleted = useCallback(
    (params: ItemCompletedParams) => {
      if (params.item.type === "commandExecution") {
        const cmdItem = params.item as {
          command: string;
          aggregatedOutput: string | null;
        };
        chat.onCommandExecution(
          cmdItem.command,
          cmdItem.aggregatedOutput ?? "",
        );
      }
    },
    [chat.onCommandExecution],
  );

  const handleCommandOutput = useCallback(
    (_params: CommandOutputDeltaParams) => {
      // Command output deltas are accumulated by the client;
      // we track finalized command output via onItemCompleted.
    },
    [],
  );

  const codex = useCodex(
    enableCodex
      ? {
          spawnFn,
          autoReconnect: true,
          onDelta: handleDelta,
          onTurnCompleted: handleTurnCompleted,
          onItemCompleted: handleItemCompleted,
          onCommandOutput: handleCommandOutput,
        }
      : { spawnFn: undefined, autoReconnect: false },
  );

  // Compute effective codex state
  const effectiveCodexState: CodexState =
    codexStateProp ?? (enableCodex ? codex.connectionState : "disconnected");
  const effectiveThreadId = threadIdProp ?? codex.threadId ?? undefined;

  // Determine if input should be disabled
  const inputDisabled = chat.isThinking || (enableCodex && codex.isThinking);

  // Handle message submission
  const handleSubmit = useCallback(
    (text: string) => {
      chat.sendMessage(text);
      if (enableCodex) {
        void codex.sendMessage(text);
      }
    },
    [chat.sendMessage, enableCodex, codex.sendMessage],
  );

  const handleDismissHelp = useCallback(() => {
    setHelpVisible(false);
  }, []);

  const handleInputFocusChange = useCallback((focused: boolean) => {
    inputFocusedRef.current = focused;
  }, []);

  return (
    <Box flexDirection="column" width="100%" height="100%">
      <HeaderBar
        connected={status.connected}
        totalAgents={status.totalAgents}
        totalActiveRuns={status.totalActiveRuns}
        error={status.error}
      />
      <Box flexDirection="row" flexGrow={1}>
        <AgentSidebar agents={status.agents} connected={status.connected} error={status.error} />
        {helpVisible ? (
          <Box flexGrow={1} justifyContent="center" alignItems="center">
            <HelpOverlay visible={helpVisible} onDismiss={handleDismissHelp} />
          </Box>
        ) : (
          <ChatPanel
            messages={chat.messages}
            streamingText={chat.streamingText}
            isThinking={chat.isThinking}
            pendingCommandItems={chat.pendingCommandItems}
          />
        )}
      </Box>
      <InputBar onSubmit={handleSubmit} disabled={inputDisabled} onFocusChange={handleInputFocusChange} />
      <StatusBar
        codexState={effectiveCodexState}
        threadId={effectiveThreadId}
        model={model}
      />
    </Box>
  );
}
