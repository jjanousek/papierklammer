import React, { useState } from "react";
import { Box, Text, useFocus, useInput } from "ink";
import type { AgentOverview } from "../hooks/useOrchestratorStatus.js";

const STATUS_DOT: Record<string, { symbol: string; color: string }> = {
  idle: { symbol: "●", color: "green" },
  running: { symbol: "●", color: "blue" },
  error: { symbol: "●", color: "red" },
  blocked: { symbol: "●", color: "yellow" },
};

function statusDot(status: string): { symbol: string; color: string } {
  return STATUS_DOT[status] ?? { symbol: "●", color: "gray" };
}

/** Default max visible agents before scrolling kicks in */
const DEFAULT_MAX_VISIBLE = 20;

export interface AgentSidebarProps {
  agents: AgentOverview[];
  /** Override max visible agents for testing */
  maxVisible?: number;
  /** Whether the sidebar is connected to the orchestrator API */
  connected?: boolean;
  /** Error message from the last failed poll */
  error?: string | null;
}

export function AgentSidebar({
  agents,
  maxVisible = DEFAULT_MAX_VISIBLE,
  connected = true,
  error = null,
}: AgentSidebarProps): React.ReactElement {
  const { isFocused } = useFocus({ id: "sidebar" });
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);

  useInput(
    (_input, key) => {
      if (!isFocused) return;
      if (key.downArrow) {
        setSelectedIndex((prev) => {
          const next = Math.min(prev + 1, agents.length - 1);
          // Scroll down if selection moves past visible window
          if (next >= scrollOffset + maxVisible) {
            setScrollOffset(next - maxVisible + 1);
          }
          return next;
        });
      }
      if (key.upArrow) {
        setSelectedIndex((prev) => {
          const next = Math.max(prev - 1, 0);
          // Scroll up if selection moves above visible window
          if (next < scrollOffset) {
            setScrollOffset(next);
          }
          return next;
        });
      }
    },
    { isActive: isFocused },
  );

  const borderColor = isFocused ? "cyan" : undefined;

  const hasMoreAbove = scrollOffset > 0;
  const hasMoreBelow = scrollOffset + maxVisible < agents.length;
  const visibleAgents = agents.slice(scrollOffset, scrollOffset + maxVisible);

  return (
    <Box
      flexDirection="column"
      width="25%"
      borderStyle="single"
      borderColor={borderColor}
      paddingX={1}
    >
      <Text bold underline>
        Agents
      </Text>
      {!connected ? (
        <>
          <Text color="red">Disconnected</Text>
          {error ? <Text dimColor>{error}</Text> : null}
        </>
      ) : agents.length === 0 ? (
        <Text dimColor>No agents connected</Text>
      ) : (
        <>
          {hasMoreAbove && <Text dimColor>▲ more above</Text>}
          {visibleAgents.map((agent, visIdx) => {
            const idx = scrollOffset + visIdx;
            const dot = statusDot(agent.status);
            const isSelected = idx === selectedIndex;
            return (
              <Text
                key={agent.agentId}
                inverse={isSelected && isFocused}
              >
                <Text color={dot.color}>{dot.symbol}</Text>{" "}
                {agent.name || agent.agentId} ({agent.status})
              </Text>
            );
          })}
          {hasMoreBelow && <Text dimColor>▼ more below</Text>}
        </>
      )}
    </Box>
  );
}
