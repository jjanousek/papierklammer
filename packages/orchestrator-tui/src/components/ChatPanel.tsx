import React from "react";
import { Box, Text } from "ink";

export function ChatPanel(): React.ReactElement {
  return (
    <Box
      flexDirection="column"
      flexGrow={1}
      borderStyle="single"
      paddingX={1}
    >
      <Text bold underline>
        Chat
      </Text>
      <Text dimColor>No messages yet. Type below to start a conversation.</Text>
    </Box>
  );
}
