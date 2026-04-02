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

export interface AgentSidebarProps {
  agents: AgentOverview[];
}

export function AgentSidebar({
  agents,
}: AgentSidebarProps): React.ReactElement {
  const { isFocused } = useFocus({ id: "sidebar" });
  const [selectedIndex, setSelectedIndex] = useState(0);

  useInput(
    (_input, key) => {
      if (!isFocused) return;
      if (key.downArrow) {
        setSelectedIndex((prev) => Math.min(prev + 1, agents.length - 1));
      }
      if (key.upArrow) {
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
      }
    },
    { isActive: isFocused },
  );

  const borderColor = isFocused ? "cyan" : undefined;

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
      {agents.length === 0 ? (
        <Text dimColor>No agents connected</Text>
      ) : (
        agents.map((agent, idx) => {
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
        })
      )}
    </Box>
  );
}
