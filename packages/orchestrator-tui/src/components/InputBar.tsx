import React, { useEffect, useCallback } from "react";
import { Box, Text } from "ink";
import TextInput from "ink-text-input";
import { AnimatedGlyph } from "./AnimatedGlyph.js";

export interface InputBarProps {
  /** Current visible draft text. */
  value?: string;
  /** Called when the user submits a message (presses Enter). */
  onSubmit?: (text: string) => void;
  /** Whether input is disabled (e.g. while Codex is thinking). */
  disabled?: boolean;
  /** Whether the input bar is currently focused. */
  focused?: boolean;
  /** Called when the input bar gains or loses focus. */
  onFocusChange?: (isFocused: boolean) => void;
  /** Called whenever the current draft text changes. */
  onValueChange?: (value: string) => void;
}

/**
 * Text input bar at the bottom of the TUI.
 *
 * Uses ink-text-input for text entry. Enter sends message,
 * input is cleared after send. Shows a spinner indicator when disabled.
 */
export function InputBar({
  value = "",
  onSubmit,
  disabled = false,
  focused = false,
  onFocusChange,
  onValueChange,
}: InputBarProps): React.ReactElement {
  useEffect(() => {
    onFocusChange?.(focused);
  }, [focused, onFocusChange]);

  const borderColor = focused ? "green" : undefined;

  const handleSubmit = useCallback(
    (text: string) => {
      if (disabled || !text.trim()) return;
      onSubmit?.(text.trim());
    },
    [disabled, onSubmit],
  );

  const handleChange = useCallback(
    (newValue: string) => {
      if (!disabled) {
        onValueChange?.(newValue);
      }
    },
    [disabled, onValueChange],
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
      flexShrink={0}
    >
      {disabled ? (
        <Text dimColor><AnimatedGlyph name="waiting" /> Waiting for response...</Text>
      ) : (
        <Box>
          <Text color="green">{">"} </Text>
          <TextInput
            value={value}
            onChange={handleChange}
            onSubmit={handleSubmit}
            focus={focused}
            placeholder="Type a message..."
          />
        </Box>
      )}
    </Box>
  );
}
