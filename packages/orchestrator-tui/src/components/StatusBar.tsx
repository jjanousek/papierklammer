import React from "react";
import { Box, Text } from "ink";

export function StatusBar(): React.ReactElement {
  return (
    <Box paddingX={1}>
      <Text dimColor>Disconnected</Text>
    </Box>
  );
}
