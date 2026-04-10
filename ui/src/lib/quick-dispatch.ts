import type { Agent } from "@papierklammer/shared";

export interface QuickDispatchDraft {
  title: string;
  description: string;
  assigneeAgentId: string | null;
  assigneeLabel: string | null;
}

type DispatchCandidate = {
  agent: Agent;
  phrase: string;
  score: number;
};

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sentenceCase(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

function findBestAgentMatch(command: string, agents: Agent[]): DispatchCandidate | null {
  const normalizedCommand = ` ${normalize(command)} `;
  let best: DispatchCandidate | null = null;

  for (const agent of agents) {
    if (agent.status === "terminated") continue;
    const phrases = [
      { phrase: agent.name, bonus: 100 },
      { phrase: agent.title ?? "", bonus: 50 },
      { phrase: agent.role, bonus: 25 },
    ];

    for (const entry of phrases) {
      const normalizedPhrase = normalize(entry.phrase);
      if (!normalizedPhrase) continue;
      if (!normalizedCommand.includes(` ${normalizedPhrase} `)) continue;

      const candidate: DispatchCandidate = {
        agent,
        phrase: entry.phrase,
        score: normalizedPhrase.length + entry.bonus,
      };

      if (!best || candidate.score > best.score) {
        best = candidate;
      }
    }
  }

  return best;
}

function stripDispatchPrefix(command: string, matchedPhrase: string | null): string {
  const trimmed = command.trim();
  if (!matchedPhrase) return trimmed;

  const escapedPhrase = escapeRegex(matchedPhrase.trim());
  const patterns = [
    new RegExp(`^(?:have|ask|tell|assign|dispatch|send|give)\\s+${escapedPhrase}\\s+(?:to\\s+)?`, "i"),
    new RegExp(`^(?:have|ask|tell|assign|dispatch|send|give)\\s+the\\s+${escapedPhrase}\\s+(?:to\\s+)?`, "i"),
    new RegExp(`^${escapedPhrase}\\s*[:,-]?\\s*`, "i"),
  ];

  for (const pattern of patterns) {
    const stripped = trimmed.replace(pattern, "").trim();
    if (stripped && stripped !== trimmed) {
      return stripped;
    }
  }

  return trimmed;
}

export function buildQuickDispatchDraft(command: string, agents: Agent[]): QuickDispatchDraft {
  const trimmed = command.trim();
  const bestMatch = findBestAgentMatch(trimmed, agents);
  const strippedTitle = stripDispatchPrefix(trimmed, bestMatch?.phrase ?? null);
  const title = sentenceCase(strippedTitle.length >= 8 ? strippedTitle : trimmed);

  return {
    title,
    description: [
      "Quick dispatch created from the dashboard command bar.",
      "",
      `Operator request: ${trimmed}`,
    ].join("\n"),
    assigneeAgentId: bestMatch?.agent.id ?? null,
    assigneeLabel: bestMatch?.agent.name ?? null,
  };
}
