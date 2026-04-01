import React from "react";
import { Box, Text } from "ink";

export function InputBar(): React.ReactElement {
  return (
    <Box
      borderStyle="single"
      borderTop={true}
      borderBottom={false}
      borderLeft={false}
      borderRight={false}
      paddingX={1}
    >
      <Text dimColor>{">"} Type a message...</Text>
    </Box>
  );
}
