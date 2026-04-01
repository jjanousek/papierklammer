import React from "react";
import { Box, Text } from "ink";

export function HeaderBar(): React.ReactElement {
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
      <Text dimColor>Status: Placeholder</Text>
    </Box>
  );
}
