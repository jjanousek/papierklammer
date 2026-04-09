import React from "react";
import { Box, Text, useInput } from "ink";

export interface HelpOverlayProps {
  /** Whether the overlay is visible. */
  visible: boolean;
  /** Called when the user dismisses the overlay (? or Escape). */
  onDismiss: () => void;
}

const SHORTCUTS: Array<{ key: string; description: string }> = [
  { key: "Tab", description: "Switch panels (sidebar ↔ input)" },
  { key: "Enter", description: "Send message" },
  { key: "v / w", description: "Invoke or wake selected agent (sidebar)" },
  { key: "a / x", description: "Approve or reject selected approval (sidebar)" },
  { key: "[ / ]", description: "Cycle pending approvals (sidebar)" },
  { key: "j / k", description: "Move through the issue desk queue" },
  { key: "n", description: "Draft a new issue from the TUI" },
  { key: "u", description: "Recover the selected issue" },
  { key: "r", description: "Cycle reasoning effort (low→med→high)" },
  { key: "f", description: "Toggle fast mode (default ON)" },
  { key: "s", description: "Open settings overlay" },
  { key: "Ctrl+C", description: "Exit" },
  { key: "↑ / ↓", description: "Scroll agents (when sidebar focused)" },
  { key: "?", description: "Toggle this help overlay" },
];

/**
 * Help overlay displaying keyboard shortcuts.
 *
 * Toggled by pressing '?' when input is not focused.
 * Dismissed by pressing '?' again or Escape.
 * Rendered as a centered bordered box overlaying the main content.
 */
export function HelpOverlay({
  visible,
  onDismiss,
}: HelpOverlayProps): React.ReactElement | null {
  useInput(
    (_input, key) => {
      if (_input === "?" || key.escape) {
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
        Keyboard Shortcuts
      </Text>
      <Text> </Text>
      {SHORTCUTS.map((shortcut) => (
        <Box key={shortcut.key} gap={1}>
          <Text bold color="yellow">
            {shortcut.key.padEnd(10)}
          </Text>
          <Text>{shortcut.description}</Text>
        </Box>
      ))}
      <Text> </Text>
      <Text dimColor>Press ? or Escape to close</Text>
    </Box>
  );
}
