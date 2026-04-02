import React from "react";
import { Box, Text, useFocus } from "ink";

export function InputBar(): React.ReactElement {
  const { isFocused } = useFocus({ id: "input" });

  const borderColor = isFocused ? "green" : undefined;

  return (
    <Box
      borderStyle="single"
      borderTop={true}
      borderBottom={false}
      borderLeft={false}
      borderRight={false}
      borderColor={borderColor}
      paddingX={1}
    >
      <Text dimColor={!isFocused}>{">"} Type a message...</Text>
    </Box>
  );
}
