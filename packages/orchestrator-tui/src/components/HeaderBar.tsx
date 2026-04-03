import React from "react";
import { Box, Text } from "ink";

export interface HeaderBarProps {
  connected: boolean;
  totalAgents: number;
  totalActiveRuns: number;
  error?: string | null;
}

export function HeaderBar({
  connected,
  totalAgents,
  totalActiveRuns,
  error = null,
}: HeaderBarProps): React.ReactElement {
  return (
    <Box
      flexDirection="row"
      justifyContent="space-between"
      borderStyle="single"
      borderBottom={true}
      borderTop={false}
      borderLeft={false}
      borderRight={false}
      paddingX={1}
      height={2}
      flexShrink={0}
    >
      <Text bold color="cyan">
        Papierklammer
      </Text>
      <Box>
        <Text color={connected ? "green" : "red"}>
          {connected ? "Connected" : "Disconnected"}
        </Text>
        {connected ? (
          <Text dimColor>
            {" "}| {totalAgents} agent{totalAgents !== 1 ? "s" : ""} | {totalActiveRuns} active run{totalActiveRuns !== 1 ? "s" : ""}
          </Text>
        ) : error ? (
          <Text dimColor> | {error}</Text>
        ) : null}
      </Box>
    </Box>
  );
}
