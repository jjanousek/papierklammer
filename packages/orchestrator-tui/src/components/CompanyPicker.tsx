import React, { useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";

export interface CompanyOption {
  id: string;
  name: string;
  updatedAt: string | Date;
}

export interface CompanyPickerProps {
  companies: CompanyOption[];
  loading: boolean;
  error?: string | null;
  onSelect(company: CompanyOption): void;
}

function formatUpdatedAt(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  const timestamp = date.getTime();
  if (!Number.isFinite(timestamp)) return "updated unknown";

  const diffMs = timestamp - Date.now();
  const absMs = Math.abs(diffMs);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

  if (absMs < hour) {
    return `updated ${formatter.format(Math.round(diffMs / minute), "minute")}`;
  }
  if (absMs < day) {
    return `updated ${formatter.format(Math.round(diffMs / hour), "hour")}`;
  }
  return `updated ${formatter.format(Math.round(diffMs / day), "day")}`;
}

export function CompanyPicker({
  companies,
  loading,
  error,
  onSelect,
}: CompanyPickerProps): React.ReactElement {
  const sortedCompanies = useMemo(
    () =>
      [...companies].sort(
        (left, right) =>
          new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
      ),
    [companies],
  );
  const [selectedIndex, setSelectedIndex] = useState(0);

  useInput((_input, key) => {
    if (loading || error || sortedCompanies.length === 0) return;

    if (key.downArrow) {
      setSelectedIndex((current) => Math.min(current + 1, sortedCompanies.length - 1));
      return;
    }
    if (key.upArrow) {
      setSelectedIndex((current) => Math.max(current - 1, 0));
      return;
    }
    if (key.return) {
      const company = sortedCompanies[selectedIndex];
      if (company) {
        onSelect(company);
      }
    }
  });

  return (
    <Box
      flexDirection="column"
      width="100%"
      height="100%"
      borderStyle="round"
      borderColor="cyan"
      paddingX={1}
      paddingY={1}
    >
      <Text bold>Select a company</Text>
      <Text color="gray">Sorted by most recently updated. Use ↑/↓ and Enter.</Text>
      <Box marginTop={1} flexDirection="column">
        {loading ? <Text color="yellow">Loading companies...</Text> : null}
        {error ? <Text color="red">{error}</Text> : null}
        {!loading && !error && sortedCompanies.length === 0 ? (
          <Text color="yellow">No companies found.</Text>
        ) : null}
        {!loading && !error
          ? sortedCompanies.map((company, index) => {
              const selected = index === selectedIndex;
              return (
                <Box key={company.id} flexDirection="column" marginTop={index === 0 ? 1 : 0}>
                  <Text color={selected ? "cyan" : undefined}>
                    {selected ? "›" : " "} {company.name}
                  </Text>
                  <Text color="gray">
                    {formatUpdatedAt(company.updatedAt)}  [{company.id}]
                  </Text>
                </Box>
              );
            })
          : null}
      </Box>
    </Box>
  );
}
