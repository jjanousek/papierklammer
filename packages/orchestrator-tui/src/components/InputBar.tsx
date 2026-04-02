import React, { useState, useCallback } from "react";
import { Box, Text, useFocus } from "ink";
import TextInput from "ink-text-input";

export interface InputBarProps {
  /** Called when the user submits a message (presses Enter). */
  onSubmit?: (text: string) => void;
  /** Whether input is disabled (e.g. while Codex is thinking). */
  disabled?: boolean;
}

/**
 * Text input bar at the bottom of the TUI.
 *
 * Uses ink-text-input for text entry. Enter sends message,
 * input is cleared after send. Shows a spinner indicator when disabled.
 */
export function InputBar({
  onSubmit,
  disabled = false,
}: InputBarProps): React.ReactElement {
  const { isFocused } = useFocus({ id: "input" });
  const [value, setValue] = useState("");

  const borderColor = isFocused ? "green" : undefined;

  const handleSubmit = useCallback(
    (text: string) => {
      if (disabled || !text.trim()) return;
      onSubmit?.(text.trim());
      setValue("");
    },
    [disabled, onSubmit],
  );

  const handleChange = useCallback(
    (newValue: string) => {
      if (!disabled) {
        setValue(newValue);
      }
    },
    [disabled],
  );

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
      {disabled ? (
        <Text dimColor>⠋ Waiting for response...</Text>
      ) : (
        <Box>
          <Text color="green">{">"} </Text>
          <TextInput
            value={value}
            onChange={handleChange}
            onSubmit={handleSubmit}
            focus={isFocused}
            placeholder="Type a message..."
          />
        </Box>
      )}
    </Box>
  );
}
