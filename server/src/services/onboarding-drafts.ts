import { readConfigFile } from "../config-file.js";

type DraftKind = "company" | "task";

export interface OnboardingDraftInput {
  kind: DraftKind;
  companyName?: string | null;
  companyGoal?: string | null;
  agentName?: string | null;
  adapterType?: string | null;
  taskTitle?: string | null;
  taskDescription?: string | null;
}

export interface OnboardingDraftResult {
  source: "openai" | "fallback";
  companyName: string | null;
  companyGoal: string | null;
  taskTitle: string | null;
  taskDescription: string | null;
}

const OPENAI_RESPONSES_ENDPOINT = "https://api.openai.com/v1/chat/completions";
const OPENAI_TIMEOUT_MS = 10_000;
const DEFAULT_OPENAI_MODEL = "gpt-5-mini";

function resolveOpenAiApiKey() {
  const envKey = process.env.OPENAI_API_KEY?.trim();
  if (envKey) return envKey;

  const config = readConfigFile();
  if (config?.llm?.provider !== "openai") return null;
  const configKey = config.llm.apiKey?.trim();
  return configKey && configKey.length > 0 ? configKey : null;
}

function asTrimmedString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function normalizeDraftResult(value: unknown): Omit<OnboardingDraftResult, "source"> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  return {
    companyName: asTrimmedString(record.companyName),
    companyGoal: asTrimmedString(record.companyGoal),
    taskTitle: asTrimmedString(record.taskTitle),
    taskDescription: asTrimmedString(record.taskDescription),
  };
}

function adapterLabel(adapterType: string | null | undefined) {
  switch (adapterType) {
    case "claude_local": return "Claude Code";
    case "codex_local": return "Codex";
    case "cursor": return "Cursor";
    case "gemini_local": return "Gemini";
    case "opencode_local": return "OpenCode";
    case "pi_local": return "Pi";
    case "hermes_local": return "Hermes";
    case "openclaw_gateway": return "OpenClaw Gateway";
    default: return "your selected adapter";
  }
}

function fallbackCompanyDraft(input: OnboardingDraftInput): OnboardingDraftResult {
  const rawGoal = asTrimmedString(input.companyGoal);
  const normalizedGoal = rawGoal
    ? rawGoal.replace(/\s+/g, " ").trim()
    : "Ship a useful product with a small autonomous founding team.";
  const baseName = asTrimmedString(input.companyName);
  const name = baseName
    ?? (rawGoal
      ? normalizedGoal
        .replace(/^(build|create|launch|grow|make)\s+/i, "")
        .split(/[\.,:;!?]/)[0]
        .split(/\s+/)
        .slice(0, 3)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ")
      : "Foundry Labs");
  const goal = rawGoal ?? `Build ${name} into a focused, fast-moving AI company with a concrete near-term operating goal.`;

  return {
    source: "fallback",
    companyName: name || "Foundry Labs",
    companyGoal: goal,
    taskTitle: null,
    taskDescription: null,
  };
}

function fallbackTaskDraft(input: OnboardingDraftInput): OnboardingDraftResult {
  const name = asTrimmedString(input.companyName) ?? "the company";
  const goal = asTrimmedString(input.companyGoal) ?? `Define an initial operating plan for ${name}.`;
  const agentName = asTrimmedString(input.agentName) ?? "CEO";
  const taskTitle =
    asTrimmedString(input.taskTitle)
    ?? `Turn ${name}'s mission into a 7-day execution plan`;
  const taskDescription =
    asTrimmedString(input.taskDescription)
    ?? [
      `You are ${agentName}. Use ${goal} as the company mission.`,
      "",
      "Please:",
      "- write a short strategy memo with the immediate objective",
      "- identify the first hires or collaborators needed",
      "- break the work into concrete tasks and create the highest-priority next task",
      "- call out blockers, assumptions, and what the board should review next",
    ].join("\n");

  return {
    source: "fallback",
    companyName: null,
    companyGoal: null,
    taskTitle,
    taskDescription,
  };
}

function fallbackDraft(input: OnboardingDraftInput): OnboardingDraftResult {
  return input.kind === "company" ? fallbackCompanyDraft(input) : fallbackTaskDraft(input);
}

async function fetchOpenAiDraft(input: OnboardingDraftInput): Promise<Omit<OnboardingDraftResult, "source"> | null> {
  const apiKey = resolveOpenAiApiKey();
  if (!apiKey) return null;

  const systemPrompt = input.kind === "company"
    ? "You draft onboarding copy for an AI company control plane. Return JSON with companyName and companyGoal. Keep it concise, operator-friendly, and specific."
    : "You draft a first starter task for a newly configured AI CEO. Return JSON with taskTitle and taskDescription. Keep it concrete, actionable, and aligned to the mission.";
  const userPrompt = JSON.stringify({
    companyName: asTrimmedString(input.companyName),
    companyGoal: asTrimmedString(input.companyGoal),
    agentName: asTrimmedString(input.agentName),
    adapterType: adapterLabel(input.adapterType),
    taskTitle: asTrimmedString(input.taskTitle),
    taskDescription: asTrimmedString(input.taskDescription),
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);
  try {
    const response = await fetch(OPENAI_RESPONSES_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: DEFAULT_OPENAI_MODEL,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const payload = await response.json() as {
      choices?: Array<{ message?: { content?: string | null } }>;
    };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) return null;
    const parsed = JSON.parse(content) as unknown;
    return normalizeDraftResult(parsed);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function generateOnboardingDraft(input: OnboardingDraftInput): Promise<OnboardingDraftResult> {
  const openAiDraft = await fetchOpenAiDraft(input);
  if (openAiDraft) {
    return {
      source: "openai",
      ...openAiDraft,
    };
  }
  return fallbackDraft(input);
}
