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
import { IssueDesk } from "./IssueDesk.js";
import { IssueComposerOverlay, type IssueComposerValues } from "./IssueComposerOverlay.js";
import { CompanyPicker, type CompanyOption } from "./CompanyPicker.js";
import type { CodexState } from "./StatusBar.js";
import { useOrchestratorStatus } from "../hooks/useOrchestratorStatus.js";
import { usePendingApprovals } from "../hooks/usePendingApprovals.js";
import { useCompanyIssues } from "../hooks/useCompanyIssues.js";
import { useChat } from "../hooks/useChat.js";
import { useCodex } from "../hooks/useCodex.js";
import { useTerminalSize } from "../hooks/useTerminalSize.js";
import type { spawn as spawnType } from "node:child_process";
import type {
  DeltaParams,
  TurnCompletedParams,
  ItemCompletedParams,
  CommandOutputDeltaParams,
  ItemStartedParams,
  ReasoningDeltaParams,
  ReasoningEffort,
} from "../codex/types.js";
import {
  buildOrchestratorInstructions,
  buildOrchestratorTurnInput,
} from "../codex/base-instructions.js";
import {
  approveApproval,
  createOrchestratorIssue,
  invokeAgentHeartbeat,
  rejectApproval,
  unblockIssue,
  wakeAgent,
  type PendingApprovalSummary,
} from "../lib/managementApi.js";
import type { AgentOverview } from "../hooks/useOrchestratorStatus.js";
import { DEFAULT_TUI_FAST_MODE, DEFAULT_TUI_MODEL, DEFAULT_TUI_REASONING_EFFORT } from "../config.js";

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
  composerVisible: boolean;
  reasoningEffort: ReasoningEffort;
  fastMode: boolean;
  contentHeight: number;
  onDismissHelp: () => void;
  onDismissSettings: () => void;
  onDismissComposer: () => void;
  onOpenComposer: () => void;
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
  composerVisible,
  reasoningEffort,
  fastMode,
  contentHeight,
  onDismissHelp,
  onDismissSettings,
  onDismissComposer,
  onOpenComposer,
  onInputFocusChange,
}: CompanySessionProps): React.ReactElement {
  const [focusTarget, setFocusTarget] = useState<"sidebar" | "input">("input");
  const [selectedIssueIndex, setSelectedIssueIndex] = useState(0);
  const { columns } = useTerminalSize();

  useInput((_input, key) => {
    if (key.tab && !helpVisible && !settingsVisible && !composerVisible) {
      setFocusTarget((current) => {
        const next = current === "input" ? "sidebar" : "input";
        onInputFocusChange(next === "input");
        return next;
      });
    }
  });

  const status = useOrchestratorStatus(
    url,
    apiKey,
    companyId,
    pollInterval,
    fetchFn,
  );
  const approvals = usePendingApprovals(
    url,
    apiKey,
    companyId,
    pollInterval,
    fetchFn,
  );
  const issues = useCompanyIssues(
    url,
    apiKey,
    companyId,
    pollInterval,
    fetchFn,
  );

  const chat = useChat();
  const managementActionInFlightRef = useRef(false);

  useEffect(() => {
    setSelectedIssueIndex((current) =>
      Math.max(0, Math.min(current, Math.max(issues.issues.length - 1, 0))),
    );
  }, [issues.issues.length]);

  const reasoningItemIdsRef = useRef<Set<string>>(new Set());

  const handleDelta = useCallback(
    (params: DeltaParams) => {
      if (reasoningItemIdsRef.current.has(params.itemId)) {
        chat.onReasoningDelta(params.delta);
        return;
      }
      chat.onDelta(params.delta);
    },
    [chat.onDelta, chat.onReasoningDelta],
  );

  const handleReasoningDelta = useCallback(
    (params: ReasoningDeltaParams) => {
      chat.onReasoningDelta(params.delta);
    },
    [chat.onReasoningDelta],
  );

  const handleItemStarted = useCallback(
    (params: ItemStartedParams) => {
      const item = params.item as { type?: string; id?: string; phase?: string | null };
      const phase = typeof item.phase === "string" ? item.phase.toLowerCase() : "";
      const looksLikeReasoning =
        item.type === "reasoning"
        || phase.includes("reason")
        || phase.includes("think")
        || phase.includes("analysis");
      if (looksLikeReasoning && typeof item.id === "string") {
        reasoningItemIdsRef.current.add(item.id);
      }
    },
    [],
  );

  const handleTurnCompleted = useCallback(
    (_params: TurnCompletedParams) => {
      chat.onTurnCompleted();
    },
    [chat.onTurnCompleted],
  );

  const handleItemCompleted = useCallback(
    (params: ItemCompletedParams) => {
      reasoningItemIdsRef.current.delete(params.item.id);
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
      chat.setIsThinking(false);
      chat.onError(error.message);
    },
    [chat.onError, chat.setIsThinking],
  );

  const codex = useCodex(
    enableCodex
      ? {
          spawnFn,
          autoReconnect: true,
          onDelta: handleDelta,
          onReasoningDelta: handleReasoningDelta,
          onItemStarted: handleItemStarted,
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
  const effectiveModel = model ?? DEFAULT_TUI_MODEL;
  const lastUserMessageIndex = chat.messages.reduce(
    (latest, message, index) => (message.role === "user" ? index : latest),
    -1,
  );
  const lastAssistantErrorIndex = chat.messages.reduce(
    (latest, message, index) =>
      message.role === "assistant" && message.text.startsWith("Error:")
        ? index
        : latest,
    -1,
  );
  const surfacedAssistantError =
    lastAssistantErrorIndex > lastUserMessageIndex
    && !chat.streamingText;
  const chatThinking = surfacedAssistantError ? false : chat.isThinking;
  const inputDisabled = surfacedAssistantError ? false : (chatThinking || (enableCodex && codex.isThinking));
  const displayCodexState: CodexState =
    surfacedAssistantError && effectiveCodexState === "thinking"
      ? "connected"
      : effectiveCodexState;

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
          effectiveModel,
        )
        .catch((error: unknown) => {
          chat.setIsThinking(false);
          chat.recoverFromPendingError(
            error instanceof Error ? error.message : "Send failed",
          );
        });
    },
    [chat.sendMessage, chat.recoverFromPendingError, chat.setIsThinking, enableCodex, codex, companyId, companyName, effectiveModel, url],
  );

  const runManagementAction = useCallback(
    async (
      action: () => Promise<string>,
      onFinally?: () => Promise<void> | void,
    ) => {
      if (managementActionInFlightRef.current) {
        return;
      }

      managementActionInFlightRef.current = true;
      try {
        chat.appendAssistantMessage(await action());
      } catch (error) {
        const message = error instanceof Error ? error.message : "Management action failed";
        chat.appendAssistantMessage(`Error: ${message}`);
      } finally {
        managementActionInFlightRef.current = false;
        await onFinally?.();
      }
    },
    [chat],
  );

  const refreshManagementState = useCallback(async () => {
    await Promise.all([
      status.refresh(),
      approvals.refresh(),
      issues.refresh(),
    ]);
  }, [approvals, issues, status]);

  const handleInvokeSelectedAgent = useCallback(
    (agent: AgentOverview) => {
      void runManagementAction(
        async () => {
          const run = await invokeAgentHeartbeat(url, apiKey, agent.agentId, fetchFn);
          const runSuffix = run.id ? ` (run ${run.id.slice(0, 8)})` : "";
          return `Invoked heartbeat for ${agent.name || agent.agentId}${runSuffix}.`;
        },
        refreshManagementState,
      );
    },
    [apiKey, fetchFn, refreshManagementState, runManagementAction, url],
  );

  const handleWakeSelectedAgent = useCallback(
    (agent: AgentOverview) => {
      void runManagementAction(
        async () => {
          const run = await wakeAgent(url, apiKey, agent.agentId, fetchFn);
          const runSuffix = run.id ? ` (run ${run.id.slice(0, 8)})` : "";
          return `Queued wakeup for ${agent.name || agent.agentId}${runSuffix}.`;
        },
        refreshManagementState,
      );
    },
    [apiKey, fetchFn, refreshManagementState, runManagementAction, url],
  );

  const handleApproveSelectedApproval = useCallback(
    (approval: PendingApprovalSummary) => {
      void runManagementAction(
        async () => {
          const updated = await approveApproval(url, apiKey, approval.id, fetchFn);
          return `Approved ${updated.type} approval ${updated.id.slice(0, 8)}.`;
        },
        refreshManagementState,
      );
    },
    [apiKey, fetchFn, refreshManagementState, runManagementAction, url],
  );

  const handleRejectSelectedApproval = useCallback(
    (approval: PendingApprovalSummary) => {
      void runManagementAction(
        async () => {
          const updated = await rejectApproval(url, apiKey, approval.id, fetchFn);
          return `Rejected ${updated.type} approval ${updated.id.slice(0, 8)}.`;
        },
        refreshManagementState,
      );
    },
    [apiKey, fetchFn, refreshManagementState, runManagementAction, url],
  );

  const sortedIssues = [...issues.issues].sort((left, right) => {
    const statusWeight: Record<string, number> = {
      blocked: 0,
      in_review: 1,
      in_progress: 2,
      todo: 3,
      backlog: 4,
      done: 5,
      cancelled: 6,
    };
    const priorityWeight: Record<string, number> = {
      critical: 0,
      high: 1,
      medium: 2,
      low: 3,
    };
    const leftStatus = statusWeight[left.projectedStatus ?? left.status] ?? 99;
    const rightStatus = statusWeight[right.projectedStatus ?? right.status] ?? 99;
    if (leftStatus !== rightStatus) return leftStatus - rightStatus;
    const leftPriority = priorityWeight[left.priority] ?? 99;
    const rightPriority = priorityWeight[right.priority] ?? 99;
    if (leftPriority !== rightPriority) return leftPriority - rightPriority;
    return Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
  }).filter((issue) => {
    const effectiveStatus = issue.projectedStatus ?? issue.status;
    return effectiveStatus !== "done" && effectiveStatus !== "cancelled";
  });

  const selectedIssue =
    sortedIssues[Math.max(0, Math.min(selectedIssueIndex, sortedIssues.length - 1))]
    ?? null;

  useInput(
    (input) => {
      if (focusTarget === "input" || helpVisible || settingsVisible || composerVisible) {
        return;
      }
      if (input === "j" && sortedIssues.length > 0) {
        setSelectedIssueIndex((current) => Math.min(current + 1, sortedIssues.length - 1));
      }
      if (input === "k" && sortedIssues.length > 0) {
        setSelectedIssueIndex((current) => Math.max(current - 1, 0));
      }
      if (input === "n") {
        onOpenComposer();
      }
      if (input === "u") {
        handleRecoverSelectedIssue();
      }
    },
    { isActive: focusTarget !== "input" && !helpVisible && !settingsVisible && !composerVisible },
  );

  const handleCreateIssue = useCallback(
    async (values: IssueComposerValues) => {
      const created = await createOrchestratorIssue(
        url,
        apiKey,
        {
          companyId,
          title: values.title,
          description: values.description || undefined,
          priority: values.priority,
        },
        fetchFn,
      );
      await refreshManagementState();
      setSelectedIssueIndex(0);
      chat.appendAssistantMessage(`Created issue ${created.identifier ?? created.id.slice(0, 8)}: ${created.title}`);
    },
    [apiKey, chat, companyId, fetchFn, refreshManagementState, url],
  );

  const handleRecoverSelectedIssue = useCallback(() => {
    if (!selectedIssue) {
      return;
    }

    void runManagementAction(
      async () => {
        const recovered = await unblockIssue(url, apiKey, selectedIssue.id, fetchFn);
        const issueRef = recovered.issue?.identifier ?? selectedIssue.identifier ?? selectedIssue.id.slice(0, 8);
        const rejected = recovered.recovery?.rejectedIntentCount ?? 0;
        const releasedLeaseId = recovered.recovery?.releasedLeaseId;
        return `Recovered ${issueRef}.${releasedLeaseId ? ` Released lease ${releasedLeaseId.slice(0, 8)}.` : ""}${rejected > 0 ? ` Rejected ${rejected} stale intent${rejected === 1 ? "" : "s"}.` : ""}`;
      },
      refreshManagementState,
    );
  }, [apiKey, fetchFn, refreshManagementState, runManagementAction, selectedIssue, url]);

  const stackedLayout = columns < 76;
  const sidebarWidth = stackedLayout ? "100%" : Math.max(24, Math.min(34, Math.floor(columns * 0.28)));
  const sidebarHeight = stackedLayout
    ? Math.max(8, Math.min(12, Math.floor(contentHeight * 0.34)))
    : contentHeight;
  const mainPanelHeight = stackedLayout
    ? Math.max(8, contentHeight - sidebarHeight)
    : contentHeight;
  const issueDeskHeight = Math.max(
    stackedLayout ? 6 : 8,
    Math.min(stackedLayout ? 10 : 14, Math.floor(mainPanelHeight * (stackedLayout ? 0.42 : 0.45))),
  );
  const computedChatHeight = Math.max(4, mainPanelHeight - issueDeskHeight);
  const compactDesk = columns < 120 || mainPanelHeight < 18;

  return (
    <ErrorBoundary>
      <Box flexDirection="column" width="100%" height="100%">
        <HeaderBar
          connected={status.connected}
          totalAgents={status.totalAgents}
          totalActiveRuns={status.totalActiveRuns}
          companyLabel={companyName || companyId}
          error={status.error}
          columns={columns}
        />
        <Box flexDirection={stackedLayout ? "column" : "row"} height={contentHeight}>
          <AgentSidebar
            agents={status.agents}
            activeRuns={status.activeRuns}
            recentRuns={status.recentRuns}
            pendingApprovals={approvals.approvals}
            width={sidebarWidth}
            height={sidebarHeight}
            maxVisible={Math.max(4, sidebarHeight - 7)}
            focused={focusTarget === "sidebar"}
            shortcutsEnabled={!helpVisible && !settingsVisible}
            connected={status.connected}
            error={status.error}
            pendingApprovalsError={approvals.error}
            onInvokeSelectedAgent={handleInvokeSelectedAgent}
            onWakeSelectedAgent={handleWakeSelectedAgent}
            onApproveSelectedApproval={handleApproveSelectedApproval}
            onRejectSelectedApproval={handleRejectSelectedApproval}
          />
          {helpVisible ? (
            <Box flexGrow={1} justifyContent="center" alignItems="center">
              <HelpOverlay visible={helpVisible} onDismiss={onDismissHelp} />
            </Box>
          ) : settingsVisible ? (
            <Box flexGrow={1} height={mainPanelHeight} justifyContent="center" alignItems="center">
              <SettingsOverlay
                visible={settingsVisible}
                onDismiss={onDismissSettings}
                model={effectiveModel}
                reasoningEffort={reasoningEffort}
                fastMode={fastMode}
              />
            </Box>
          ) : composerVisible ? (
            <Box flexGrow={1} height={mainPanelHeight} justifyContent="center" alignItems="center">
              <IssueComposerOverlay
                visible={composerVisible}
                onDismiss={onDismissComposer}
                onSubmit={handleCreateIssue}
              />
            </Box>
          ) : (
            <Box flexDirection="column" flexGrow={1} height={mainPanelHeight}>
              <IssueDesk
                issues={issues.issues}
                agents={status.agents}
                activeRuns={status.activeRuns}
                pendingApprovals={approvals.approvals}
                selectedIndex={selectedIssueIndex}
                compact={compactDesk}
                height={issueDeskHeight}
                focused={focusTarget !== "input"}
                error={issues.error}
              />
              <ChatPanel
                messages={chat.messages}
                streamingText={chat.streamingText}
                isThinking={chatThinking}
                reasoningText={chat.reasoningText}
                pendingCommandItems={chat.pendingCommandItems}
                visibleHeight={computedChatHeight}
                height={computedChatHeight}
              />
            </Box>
          )}
        </Box>
        <InputBar
          onSubmit={handleSubmit}
          disabled={inputDisabled}
          focused={focusTarget === "input"}
          onFocusChange={onInputFocusChange}
        />
        <StatusBar
          codexState={displayCodexState}
          error={effectiveCodexError}
          threadId={effectiveThreadId}
          model={effectiveModel}
          reasoningEffort={reasoningEffort}
          fastMode={fastMode}
          columns={columns}
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
  const { rows, columns } = useTerminalSize();
  const [helpVisible, setHelpVisible] = useState(false);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [composerVisible, setComposerVisible] = useState(false);
  const [switcherVisible, setSwitcherVisible] = useState(false);
  const [selectedCompanyId, setSelectedCompanyId] = useState(companyId);
  const [selectedCompanyName, setSelectedCompanyName] = useState(companyName);
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>(DEFAULT_TUI_REASONING_EFFORT);
  const [fastMode, setFastMode] = useState(DEFAULT_TUI_FAST_MODE);
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [companiesLoading, setCompaniesLoading] = useState(!companyId);
  const [companiesError, setCompaniesError] = useState<string | null>(null);
  const inputFocusedRef = useRef(true);
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
  const effectiveModel = model ?? DEFAULT_TUI_MODEL;

  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      exit();
    }
    // Toggle help overlay with '?' when input bar is not focused
    // Only open (not close) from here — closing is handled by HelpOverlay itself
    if (input === "?" && !inputFocusedRef.current && !helpVisible && !settingsVisible && !composerVisible && !switcherVisible) {
      setHelpVisible(true);
    }
    // Toggle settings overlay with 's' when input is not focused
    // Only open (not close) from here — closing is handled by SettingsOverlay itself
    if (input === "s" && !inputFocusedRef.current && !helpVisible && !settingsVisible && !composerVisible && !switcherVisible) {
      setSettingsVisible(true);
    }
    // Cycle reasoning effort with 'r' when input is not focused
    // Allow 'r' even when settings overlay is open (for live adjustment)
    if (input === "r" && !inputFocusedRef.current && !helpVisible && !composerVisible && !switcherVisible) {
      setReasoningEffort((current) => cycleReasoningEffort(current));
    }
    // Toggle fast mode with 'f' when input is not focused
    // Allow 'f' even when settings overlay is open (for live adjustment)
    if (input === "f" && !inputFocusedRef.current && !helpVisible && !composerVisible && !switcherVisible) {
      setFastMode((current) => !current);
    }
    if (input === "c" && !inputFocusedRef.current && !helpVisible && !settingsVisible && !composerVisible && !switcherVisible) {
      setSwitcherVisible(true);
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
    const shouldLoadCompanies = companies.length === 0 || !selectedCompanyId || switcherVisible;
    if (!shouldLoadCompanies) {
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
  }, [url, apiKey, selectedCompanyId, fetchFn, switcherVisible, companies.length]);

  const handleDismissHelp = useCallback(() => {
    setHelpVisible(false);
  }, []);

  const handleDismissSettings = useCallback(() => {
    setSettingsVisible(false);
  }, []);

  const handleDismissComposer = useCallback(() => {
    setComposerVisible(false);
  }, []);

  const handleDismissSwitcher = useCallback(() => {
    setSwitcherVisible(false);
  }, []);

  const handleInputFocusChange = useCallback((focused: boolean) => {
    inputFocusedRef.current = focused;
  }, []);

  const handleCompanySelect = useCallback((company: CompanyOption) => {
    setSelectedCompanyId(company.id);
    setSelectedCompanyName(company.name);
    setCompaniesError(null);
    setSwitcherVisible(false);
    setHelpVisible(false);
    setSettingsVisible(false);
    setComposerVisible(false);
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
            columns={columns}
          />
          <Box flexGrow={1} height={contentHeight}>
            <CompanyPicker
              companies={companies}
              loading={companiesLoading}
              error={companiesError}
              initialSelectedId={selectedCompanyId}
              onSelect={handleCompanySelect}
            />
          </Box>
          <StatusBar
            codexState={codexStateProp ?? "disconnected"}
            error={null}
            threadId={undefined}
            model={effectiveModel}
            reasoningEffort={reasoningEffort}
            fastMode={fastMode}
            columns={columns}
          />
        </Box>
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary>
      <Box flexDirection="column" width="100%" height="100%">
        {switcherVisible ? (
          <>
            <HeaderBar
              connected={false}
              totalAgents={0}
              totalActiveRuns={0}
              companyLabel={selectedCompanyName || selectedCompanyId}
              error={companiesError}
              columns={columns}
            />
            <Box flexGrow={1} height={contentHeight} justifyContent="center" alignItems="center">
              <Box width={Math.max(50, Math.min(96, columns - 8))}>
                <CompanyPicker
                  companies={companies}
                  loading={companiesLoading}
                  error={companiesError}
                  title="Switch Company"
                  subtitle="Use ↑/↓ and Enter to switch. Company change resets the active session."
                  initialSelectedId={selectedCompanyId}
                  dismissHint="Press c or Escape to close."
                  onDismiss={handleDismissSwitcher}
                  onSelect={handleCompanySelect}
                />
              </Box>
            </Box>
            <StatusBar
              codexState={codexStateProp ?? "disconnected"}
              error={null}
              threadId={undefined}
              model={effectiveModel}
              reasoningEffort={reasoningEffort}
              fastMode={fastMode}
              columns={columns}
            />
          </>
        ) : (
          <CompanySession
            key={selectedCompanyId}
            url={url}
            apiKey={apiKey}
            companyId={selectedCompanyId}
            companyName={selectedCompanyName}
            codexState={codexStateProp}
            threadId={threadIdProp}
            model={effectiveModel}
            fetchFn={fetchFn}
            pollInterval={pollInterval}
            spawnFn={spawnFn}
            enableCodex={enableCodex}
            helpVisible={helpVisible}
            settingsVisible={settingsVisible}
            composerVisible={composerVisible}
            reasoningEffort={reasoningEffort}
            fastMode={fastMode}
            contentHeight={contentHeight}
            onDismissHelp={handleDismissHelp}
            onDismissSettings={handleDismissSettings}
            onDismissComposer={handleDismissComposer}
            onOpenComposer={() => setComposerVisible(true)}
            onInputFocusChange={handleInputFocusChange}
          />
        )}
      </Box>
    </ErrorBoundary>
  );
}
