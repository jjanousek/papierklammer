import React, { useState, useEffect, useCallback, useRef } from "react";
import { Box, useApp, useInput } from "ink";
import { ErrorBoundary } from "./ErrorBoundary.js";
import { HeaderBar } from "./HeaderBar.js";
import { AgentSidebar } from "./AgentSidebar.js";
import { ChatPanel } from "./ChatPanel.js";
import { InputBar } from "./InputBar.js";
import { StatusBar } from "./StatusBar.js";
import { HelpOverlay } from "./HelpOverlay.js";
import { SettingsOverlay } from "./SettingsOverlay.js";
import { CompanyPicker, type CompanyOption } from "./CompanyPicker.js";
import type { CodexState } from "./StatusBar.js";
import { useOrchestratorStatus } from "../hooks/useOrchestratorStatus.js";
import { useChat } from "../hooks/useChat.js";
import { useCodex } from "../hooks/useCodex.js";
import { useTerminalSize } from "../hooks/useTerminalSize.js";
import type { spawn as spawnType } from "node:child_process";
import type {
  DeltaParams,
  TurnCompletedParams,
  ItemCompletedParams,
  CommandOutputDeltaParams,
  ReasoningEffort,
} from "../codex/types.js";
import {
  buildOrchestratorInstructions,
  buildOrchestratorTurnInput,
} from "../codex/base-instructions.js";

const REASONING_CYCLE: ReasoningEffort[] = ["low", "medium", "high"];

function cycleReasoningEffort(current: ReasoningEffort): ReasoningEffort {
  const idx = REASONING_CYCLE.indexOf(current);
  return REASONING_CYCLE[(idx + 1) % REASONING_CYCLE.length]!;
}

export interface AppProps {
  url: string;
  apiKey: string;
  companyId: string;
  companyName?: string;
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

interface CompanySessionProps {
  url: string;
  apiKey: string;
  companyId: string;
  companyName?: string;
  codexState?: CodexState;
  threadId?: string;
  model?: string;
  fetchFn?: typeof globalThis.fetch;
  pollInterval: number;
  spawnFn?: typeof spawnType;
  enableCodex: boolean;
  helpVisible: boolean;
  settingsVisible: boolean;
  reasoningEffort: ReasoningEffort;
  fastMode: boolean;
  contentHeight: number;
  onDismissHelp: () => void;
  onDismissSettings: () => void;
  onInputFocusChange: (focused: boolean) => void;
}

function CompanySession({
  url,
  apiKey,
  companyId,
  companyName = "",
  codexState: codexStateProp,
  threadId: threadIdProp,
  model,
  fetchFn,
  pollInterval,
  spawnFn,
  enableCodex,
  helpVisible,
  settingsVisible,
  reasoningEffort,
  fastMode,
  contentHeight,
  onDismissHelp,
  onDismissSettings,
  onInputFocusChange,
}: CompanySessionProps): React.ReactElement {
  const [focusTarget, setFocusTarget] = useState<"sidebar" | "input">("input");

  useInput((_input, key) => {
    if (key.tab && !helpVisible) {
      setFocusTarget((current) => (current === "input" ? "sidebar" : "input"));
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
        chat.onCommandExecution(cmdItem.command, cmdItem.aggregatedOutput ?? "");
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

  const codex = useCodex(
    enableCodex
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

  const effectiveCodexState: CodexState =
    codexStateProp ?? (enableCodex ? codex.connectionState : "disconnected");
  const effectiveCodexError = enableCodex ? codex.lastError : null;
  const effectiveThreadId = threadIdProp ?? codex.threadId ?? undefined;
  const inputDisabled = chat.isThinking || (enableCodex && codex.isThinking);

  const isThinkingRef = useRef(chat.isThinking);
  isThinkingRef.current = chat.isThinking;

  const reasoningEffortRef = useRef(reasoningEffort);
  reasoningEffortRef.current = reasoningEffort;

  const fastModeRef = useRef(fastMode);
  fastModeRef.current = fastMode;

  const handleSubmit = useCallback(
    (text: string) => {
      chat.sendMessage(text);
      if (!enableCodex) {
        return;
      }

      const serviceTier = fastModeRef.current ? "fast" : undefined;
      const scopedText = buildOrchestratorTurnInput(text, {
        companyId,
        companyName,
        baseUrl: url,
      });
      const scopedInstructions = buildOrchestratorInstructions({
        companyId,
        companyName,
        baseUrl: url,
      });

      void codex
        .sendMessage(
          scopedText,
          scopedInstructions,
          reasoningEffortRef.current,
          serviceTier,
        )
        .catch((error: unknown) => {
          if (isThinkingRef.current) {
            chat.onError(error instanceof Error ? error.message : "Send failed");
          }
        });
    },
    [chat.sendMessage, chat.onError, enableCodex, codex, companyId, companyName],
  );

  return (
    <ErrorBoundary>
      <Box flexDirection="column" width="100%" height="100%">
        <HeaderBar
          connected={status.connected}
          totalAgents={status.totalAgents}
          totalActiveRuns={status.totalActiveRuns}
          companyLabel={companyName || companyId}
          error={status.error}
        />
        <Box flexDirection="row" height={contentHeight}>
          <AgentSidebar
            agents={status.agents}
            focused={focusTarget === "sidebar"}
            connected={status.connected}
            error={status.error}
          />
          {helpVisible ? (
            <Box flexGrow={1} justifyContent="center" alignItems="center">
              <HelpOverlay visible={helpVisible} onDismiss={onDismissHelp} />
            </Box>
          ) : settingsVisible ? (
            <Box flexGrow={1} justifyContent="center" alignItems="center">
              <SettingsOverlay
                visible={settingsVisible}
                onDismiss={onDismissSettings}
                model={model}
                reasoningEffort={reasoningEffort}
                fastMode={fastMode}
              />
            </Box>
          ) : (
            <ChatPanel
              messages={chat.messages}
              streamingText={chat.streamingText}
              isThinking={chat.isThinking}
              pendingCommandItems={chat.pendingCommandItems}
              visibleHeight={contentHeight}
            />
          )}
        </Box>
        <InputBar
          onSubmit={handleSubmit}
          disabled={inputDisabled}
          focused={focusTarget === "input"}
          onFocusChange={onInputFocusChange}
        />
        <StatusBar
          codexState={effectiveCodexState}
          error={effectiveCodexError}
          threadId={effectiveThreadId}
          model={model}
          reasoningEffort={reasoningEffort}
          fastMode={fastMode}
        />
      </Box>
    </ErrorBoundary>
  );
}

export function App({
  url,
  apiKey,
  companyId,
  companyName = "",
  codexState: codexStateProp,
  threadId: threadIdProp,
  model,
  fetchFn,
  pollInterval = 5000,
  spawnFn,
  enableCodex = spawnFn !== undefined,
}: AppProps): React.ReactElement {
  const { exit } = useApp();
  const { rows } = useTerminalSize();
  const [helpVisible, setHelpVisible] = useState(false);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [selectedCompanyId, setSelectedCompanyId] = useState(companyId);
  const [selectedCompanyName, setSelectedCompanyName] = useState(companyName);
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>("high");
  const [fastMode, setFastMode] = useState(false);
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [companiesLoading, setCompaniesLoading] = useState(!companyId);
  const [companiesError, setCompaniesError] = useState<string | null>(null);
  const inputFocusedRef = useRef(false);
  const previousLaunchContextRef = useRef({
    companyId,
    companyName,
  });

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
    // Toggle help overlay with '?' when input bar is not focused
    // Only open (not close) from here — closing is handled by HelpOverlay itself
    if (input === "?" && !inputFocusedRef.current && !helpVisible && !settingsVisible) {
      setHelpVisible(true);
    }
    // Toggle settings overlay with 's' when input is not focused
    // Only open (not close) from here — closing is handled by SettingsOverlay itself
    if (input === "s" && !inputFocusedRef.current && !helpVisible && !settingsVisible) {
      setSettingsVisible(true);
    }
    // Cycle reasoning effort with 'r' when input is not focused
    // Allow 'r' even when settings overlay is open (for live adjustment)
    if (input === "r" && !inputFocusedRef.current && !helpVisible) {
      setReasoningEffort((current) => cycleReasoningEffort(current));
    }
    // Toggle fast mode with 'f' when input is not focused
    // Allow 'f' even when settings overlay is open (for live adjustment)
    if (input === "f" && !inputFocusedRef.current && !helpVisible) {
      setFastMode((current) => !current);
    }
  });

  useEffect(() => {
    const previous = previousLaunchContextRef.current;
    if (
      previous.companyId === companyId &&
      previous.companyName === companyName
    ) {
      return;
    }

    previousLaunchContextRef.current = { companyId, companyName };
    setSelectedCompanyId(companyId);
    setSelectedCompanyName(companyName);
    setCompaniesLoading(!companyId);
    setCompaniesError(null);
  }, [companyId, companyName]);

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
          setSelectedCompanyName(payload[0].name);
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

  const handleDismissHelp = useCallback(() => {
    setHelpVisible(false);
  }, []);

  const handleDismissSettings = useCallback(() => {
    setSettingsVisible(false);
  }, []);

  const handleInputFocusChange = useCallback((focused: boolean) => {
    inputFocusedRef.current = focused;
  }, []);

  const handleCompanySelect = useCallback((company: CompanyOption) => {
    setSelectedCompanyId(company.id);
    setSelectedCompanyName(company.name);
    setCompaniesError(null);
  }, []);

  // Fixed bars: HeaderBar (2 rows: content + border), InputBar (2 rows: border + content),
  // StatusBar (1 row). Middle content area gets the remaining height.
  const fixedBarHeight = 5; // 2 + 2 + 1
  const contentHeight = Math.max(1, rows - fixedBarHeight);

  if (!selectedCompanyId) {
    return (
      <ErrorBoundary>
        <Box flexDirection="column" width="100%" height={rows}>
          <HeaderBar
            connected={false}
            totalAgents={0}
            totalActiveRuns={0}
            companyLabel={null}
            error={companiesError}
          />
          <Box flexGrow={1} height={contentHeight}>
            <CompanyPicker
              companies={companies}
              loading={companiesLoading}
              error={companiesError}
              onSelect={handleCompanySelect}
            />
          </Box>
          <StatusBar
            codexState={codexStateProp ?? "disconnected"}
            error={null}
            threadId={undefined}
            model={model}
            reasoningEffort={reasoningEffort}
            fastMode={fastMode}
          />
        </Box>
      </ErrorBoundary>
    );
  }

  return (
    <CompanySession
      key={selectedCompanyId}
      url={url}
      apiKey={apiKey}
      companyId={selectedCompanyId}
      companyName={selectedCompanyName}
      codexState={codexStateProp}
      threadId={threadIdProp}
      model={model}
      fetchFn={fetchFn}
      pollInterval={pollInterval}
      spawnFn={spawnFn}
      enableCodex={enableCodex}
      helpVisible={helpVisible}
      settingsVisible={settingsVisible}
      reasoningEffort={reasoningEffort}
      fastMode={fastMode}
      contentHeight={contentHeight}
      onDismissHelp={handleDismissHelp}
      onDismissSettings={handleDismissSettings}
      onInputFocusChange={handleInputFocusChange}
    />
  );
}
