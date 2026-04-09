import React from "react";
import { Box, Text, useInput } from "ink";
import type { ReasoningEffort } from "../codex/types.js";
import { DEFAULT_TUI_MODEL } from "../config.js";

export interface SettingsOverlayProps {
  /** Whether the overlay is visible. */
  visible: boolean;
  /** Called when the user dismisses the overlay ('s' or Escape). */
  onDismiss: () => void;
  /** Current model name (e.g., "o4-mini"). */
  model?: string;
  /** Current reasoning effort level. */
  reasoningEffort: ReasoningEffort;
  /** Whether fast mode is enabled. */
  fastMode: boolean;
}

/**
 * Settings overlay displaying current configuration.
 *
 * Toggled by pressing 's' when input is not focused.
 * Dismissed by pressing 's' again or Escape.
 * Read-only display — actual toggling done via 'r' and 'f' keys.
 */
export function SettingsOverlay({
  visible,
  onDismiss,
  model = DEFAULT_TUI_MODEL,
  reasoningEffort,
  fastMode,
}: SettingsOverlayProps): React.ReactElement | null {
  useInput(
    (_input, key) => {
      if (_input === "s" || key.escape) {
        onDismiss();
      }
    },
    { isActive: visible },
  );

  if (!visible) return null;

  return (
    <Box
      flexDirection="column"
      borderStyle="double"
      borderColor="cyan"
      paddingX={2}
      paddingY={1}
      alignSelf="center"
    >
      <Text bold color="cyan">
        Settings
      </Text>
      <Text> </Text>
      <Box gap={1}>
        <Text bold color="yellow">
          {"Model".padEnd(18)}
        </Text>
        <Text>{model}</Text>
      </Box>
      <Box gap={1}>
        <Text bold color="yellow">
          {"Reasoning Effort".padEnd(18)}
        </Text>
        <Text>{reasoningEffort}</Text>
      </Box>
      <Box gap={1}>
        <Text bold color="yellow">
          {"Fast Mode".padEnd(18)}
        </Text>
        {fastMode ? (
          <Text color="yellow" bold>ON (2×)</Text>
        ) : (
          <Text>OFF</Text>
        )}
      </Box>
      <Text> </Text>
      <Text dimColor>Default profile: gpt-5.4 · high · fast</Text>
      <Text dimColor>Press r to cycle reasoning · f to toggle fast mode</Text>
      <Text dimColor>Press s or Escape to close</Text>
    </Box>
  );
}
