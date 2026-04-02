import React, { useEffect } from "react";
import { Box, useApp, useInput } from "ink";
import { HeaderBar } from "./HeaderBar.js";
import { AgentSidebar } from "./AgentSidebar.js";
import { ChatPanel } from "./ChatPanel.js";
import { InputBar } from "./InputBar.js";
import { StatusBar } from "./StatusBar.js";
import type { CodexState } from "./StatusBar.js";
import { useOrchestratorStatus } from "../hooks/useOrchestratorStatus.js";

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
}

export function App({
  url,
  apiKey,
  companyId,
  codexState = "disconnected",
  threadId,
  model,
  fetchFn,
  pollInterval = 5000,
}: AppProps): React.ReactElement {
  const { exit } = useApp();

  // Enter alternate screen buffer on mount, restore on unmount
  useEffect(() => {
    process.stdout.write("\x1b[?1049h");
    return () => {
      process.stdout.write("\x1b[?1049l");
    };
  }, []);

  // Handle Ctrl+C for clean exit
  useInput((_input, key) => {
    if (key.ctrl && _input === "c") {
      exit();
    }
  });

  const status = useOrchestratorStatus(
    url,
    apiKey,
    companyId,
    pollInterval,
    fetchFn,
  );

  return (
    <Box flexDirection="column" width="100%" height="100%">
      <HeaderBar
        connected={status.connected}
        totalAgents={status.totalAgents}
        totalActiveRuns={status.totalActiveRuns}
      />
      <Box flexDirection="row" flexGrow={1}>
        <AgentSidebar agents={status.agents} />
        <ChatPanel />
      </Box>
      <InputBar />
      <StatusBar codexState={codexState} threadId={threadId} model={model} />
    </Box>
  );
}
