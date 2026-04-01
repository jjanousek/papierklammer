import React from "react";
import { Box, Text } from "ink";

export function AgentSidebar(): React.ReactElement {
  return (
    <Box
      flexDirection="column"
      width="25%"
      borderStyle="single"
      paddingX={1}
    >
      <Text bold underline>
        Agents
      </Text>
      <Text dimColor>No agents connected</Text>
    </Box>
  );
}
