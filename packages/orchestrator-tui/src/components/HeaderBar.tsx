import React from "react";
import { Box, Text } from "ink";

export interface HeaderBarProps {
  connected: boolean;
  totalAgents: number;
  totalActiveRuns: number;
}

export function HeaderBar({
  connected,
  totalAgents,
  totalActiveRuns,
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
    >
      <Text bold color="cyan">
        Papierklammer
      </Text>
      <Box>
        <Text color={connected ? "green" : "red"}>
          {connected ? "Connected" : "Disconnected"}
        </Text>
        <Text dimColor>
          {" "}| {totalAgents} agent{totalAgents !== 1 ? "s" : ""} | {totalActiveRuns} active run{totalActiveRuns !== 1 ? "s" : ""}
        </Text>
      </Box>
    </Box>
  );
}
