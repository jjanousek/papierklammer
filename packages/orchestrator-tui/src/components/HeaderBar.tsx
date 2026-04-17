import React from "react";
import { Box, Text } from "ink";

export interface HeaderBarProps {
  connected: boolean;
  booting?: boolean;
  totalAgents: number;
  totalActiveRuns: number;
  companyLabel?: string | null;
  error?: string | null;
  columns?: number;
}

function truncate(text: string, maxLength: number): string {
  if (maxLength <= 0) return "";
  if (text.length <= maxLength) return text;
  if (maxLength <= 1) return text.slice(0, maxLength);
  return `${text.slice(0, maxLength - 1)}…`;
}

export function HeaderBar({
  connected,
  booting = false,
  totalAgents,
  totalActiveRuns,
  companyLabel = null,
  error = null,
  columns,
}: HeaderBarProps): React.ReactElement {
  const compact = (columns ?? 120) < 70;
  const leftLabel = compact
    ? truncate(companyLabel ? `PK · ${companyLabel}` : "PK", Math.max(12, Math.floor((columns ?? 80) * 0.45)))
    : truncate(companyLabel ? `Papierklammer · ${companyLabel}` : "Papierklammer", Math.max(18, Math.floor((columns ?? 120) * 0.5)));
  const rightLabel = booting && !error
    ? compact
      ? "syncing…"
      : "Connecting…"
    : connected
    ? compact
      ? `${connected ? "up" : "down"} · a:${totalAgents} · r:${totalActiveRuns}`
      : `${connected ? "Connected" : "Disconnected"} | ${totalAgents} agent${totalAgents !== 1 ? "s" : ""} | ${totalActiveRuns} active run${totalActiveRuns !== 1 ? "s" : ""}`
    : compact
      ? truncate(`down${error ? ` · ${error}` : ""}`, Math.max(10, Math.floor((columns ?? 80) * 0.45)))
      : truncate(`Disconnected${error ? ` | ${error}` : ""}`, Math.max(16, Math.floor((columns ?? 120) * 0.45)));

  return (
    <Box
      flexDirection="row"
      justifyContent="space-between"
      borderStyle="single"
      borderBottom={true}
      borderTop={false}
      borderLeft={false}
      borderRight={false}
      paddingX={1}
      height={2}
      flexShrink={0}
    >
      <Box>
        <Text bold color="cyan">
          {leftLabel}
        </Text>
      </Box>
      <Box>
        <Text color={booting && !error ? "yellow" : connected ? "green" : "red"}>{rightLabel}</Text>
      </Box>
    </Box>
  );
}
