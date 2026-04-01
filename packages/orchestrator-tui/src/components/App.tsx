import React, { useEffect } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { HeaderBar } from "./HeaderBar.js";
import { AgentSidebar } from "./AgentSidebar.js";
import { ChatPanel } from "./ChatPanel.js";
import { InputBar } from "./InputBar.js";
import { StatusBar } from "./StatusBar.js";

export interface AppProps {
  url: string;
  apiKey: string;
  companyId: string;
}

export function App({ url, apiKey, companyId }: AppProps): React.ReactElement {
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

  return (
    <Box flexDirection="column" width="100%" height="100%">
      <HeaderBar />
      <Box flexDirection="row" flexGrow={1}>
        <AgentSidebar />
        <ChatPanel />
      </Box>
      <InputBar />
      <StatusBar />
    </Box>
  );
}
