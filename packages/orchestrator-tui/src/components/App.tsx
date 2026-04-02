import React, { useState, useEffect, useCallback, useRef } from "react";
import { Box, useApp, useInput } from "ink";
import { ErrorBoundary } from "./ErrorBoundary.js";
import { HeaderBar } from "./HeaderBar.js";
import { AgentSidebar } from "./AgentSidebar.js";
import { ChatPanel } from "./ChatPanel.js";
import { InputBar } from "./InputBar.js";
import { StatusBar } from "./StatusBar.js";
import { HelpOverlay } from "./HelpOverlay.js";
import { CompanyPicker, type CompanyOption } from "./CompanyPicker.js";
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
import { ORCHESTRATOR_INSTRUCTIONS } from "../codex/base-instructions.js";

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
  enableCodex = spawnFn !== undefined,
}: AppProps): React.ReactElement {
  const { exit } = useApp();
  const [helpVisible, setHelpVisible] = useState(false);
  const [selectedCompanyId, setSelectedCompanyId] = useState(companyId);
  const [focusTarget, setFocusTarget] = useState<"sidebar" | "input">("input");
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [companiesLoading, setCompaniesLoading] = useState(!companyId);
  const [companiesError, setCompaniesError] = useState<string | null>(null);
  const inputFocusedRef = useRef(false);

  // Enter alternate screen buffer on mount, restore on unmount
  useEffect(() => {
    process.stdout.write("\x1b[?1049h");
    return () => {
      process.stdout.write("\x1b[?1049l");
    };
  }, []);

  // Handle Ctrl+C for clean exit and '?' for help overlay
  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      exit();
    }
    if (key.tab && selectedCompanyId && !helpVisible) {
      setFocusTarget((current) => (current === "input" ? "sidebar" : "input"));
      return;
    }
    // Toggle help overlay with '?' when input bar is not focused
    // Only open (not close) from here — closing is handled by HelpOverlay itself
    if (input === "?" && !inputFocusedRef.current && !helpVisible) {
      setHelpVisible(true);
    }
  });

  useEffect(() => {
    if (selectedCompanyId) {
      setCompaniesLoading(false);
      return;
    }

    let active = true;
    const loadCompanies = async () => {
      setCompaniesLoading(true);
      try {
        const response = await (fetchFn ?? globalThis.fetch)(
          `${url.replace(/\/+$/, "")}/api/companies`,
          {
            headers: {
              accept: "application/json",
              ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
            },
          },
        );

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const payload = (await response.json()) as CompanyOption[];
        if (!Array.isArray(payload)) {
          throw new Error("Expected /api/companies to return an array");
        }

        if (!active) return;
        setCompanies(payload);
        setCompaniesError(null);
        if (payload.length === 1 && payload[0]?.id) {
          setSelectedCompanyId(payload[0].id);
        }
      } catch (error) {
        if (!active) return;
        setCompaniesError(error instanceof Error ? error.message : "Failed to load companies");
      } finally {
        if (active) {
          setCompaniesLoading(false);
        }
      }
    };

    void loadCompanies();

    return () => {
      active = false;
    };
  }, [url, apiKey, selectedCompanyId, fetchFn]);

  const status = useOrchestratorStatus(
    url,
    apiKey,
    selectedCompanyId,
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

  const handleCodexError = useCallback(
    (error: Error) => {
      chat.onError(error.message);
    },
    [chat.onError],
  );

  const codexEnabled = enableCodex && Boolean(selectedCompanyId);

  const codex = useCodex(
    codexEnabled
      ? {
          spawnFn,
          autoReconnect: true,
          onDelta: handleDelta,
          onTurnCompleted: handleTurnCompleted,
          onItemCompleted: handleItemCompleted,
          onCommandOutput: handleCommandOutput,
          onError: handleCodexError,
        }
      : { spawnFn: undefined, autoReconnect: false },
  );

  // Compute effective codex state
  const effectiveCodexState: CodexState =
    codexStateProp ?? (codexEnabled ? codex.connectionState : "disconnected");
  const effectiveThreadId = threadIdProp ?? codex.threadId ?? undefined;

  // Determine if input should be disabled
  const inputDisabled = chat.isThinking || (codexEnabled && codex.isThinking);

  // Handle message submission
  const handleSubmit = useCallback(
    (text: string) => {
      chat.sendMessage(text);
      if (codexEnabled) {
        void codex.sendMessage(text, ORCHESTRATOR_INSTRUCTIONS).catch(() => {
          // useCodex reports the failure via onError; keep the UI alive.
        });
      }
    },
    [chat.sendMessage, codexEnabled, codex.sendMessage],
  );

  const handleDismissHelp = useCallback(() => {
    setHelpVisible(false);
  }, []);

  const handleInputFocusChange = useCallback((focused: boolean) => {
    inputFocusedRef.current = focused;
  }, []);

  const handleCompanySelect = useCallback((company: CompanyOption) => {
    setSelectedCompanyId(company.id);
    setFocusTarget("input");
  }, []);

  if (!selectedCompanyId) {
    return (
      <ErrorBoundary>
        <Box flexDirection="column" width="100%" height="100%">
          <HeaderBar
            connected={false}
            totalAgents={0}
            totalActiveRuns={0}
            error={companiesError}
          />
          <Box flexGrow={1}>
            <CompanyPicker
              companies={companies}
              loading={companiesLoading}
              error={companiesError}
              onSelect={handleCompanySelect}
            />
          </Box>
          <StatusBar
            codexState={effectiveCodexState}
            threadId={undefined}
            model={model}
          />
        </Box>
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary>
      <Box flexDirection="column" width="100%" height="100%">
        <HeaderBar
          connected={status.connected}
          totalAgents={status.totalAgents}
          totalActiveRuns={status.totalActiveRuns}
          error={status.error}
        />
        <Box flexDirection="row" flexGrow={1}>
          <AgentSidebar
            agents={status.agents}
            focused={focusTarget === "sidebar"}
            connected={status.connected}
            error={status.error}
          />
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
        <InputBar
          onSubmit={handleSubmit}
          disabled={inputDisabled}
          focused={focusTarget === "input"}
          onFocusChange={handleInputFocusChange}
        />
        <StatusBar
          codexState={effectiveCodexState}
          threadId={effectiveThreadId}
          model={model}
        />
      </Box>
    </ErrorBoundary>
  );
}
