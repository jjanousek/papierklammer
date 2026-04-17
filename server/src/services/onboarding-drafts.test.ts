import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../config-file.js", () => ({
  readConfigFile: () => null,
}));

import { generateOnboardingDraft } from "./onboarding-drafts.js";

describe("generateOnboardingDraft", () => {
  beforeEach(() => {
    vi.stubEnv("OPENAI_API_KEY", "");
  });

  it("preserves a user-written mission when refining company copy without OpenAI", async () => {
    const result = await generateOnboardingDraft({
      kind: "company",
      companyName: "Mission Test Robotics",
      companyGoal:
        "Build an AI robotics consultancy that designs warehouse automation pilots for small manufacturers and lands its first paying customer.",
    });

    expect(result.source).toBe("fallback");
    expect(result.companyName).toBe("Mission Test Robotics");
    expect(result.companyGoal).toBe(
      "Build an AI robotics consultancy that designs warehouse automation pilots for small manufacturers and lands its first paying customer.",
    );
  });

  it("turns the mission into a first CEO issue instead of generic boilerplate", async () => {
    const result = await generateOnboardingDraft({
      kind: "task",
      companyName: "Mission Test Robotics",
      companyGoal:
        "Build an AI robotics consultancy that designs warehouse automation pilots for small manufacturers and lands its first paying customer.",
      agentName: "CEO",
    });

    expect(result.source).toBe("fallback");
    expect(result.taskTitle).toBe(
      "Turn Mission Test Robotics's mission into the first operating plan",
    );
    expect(result.taskDescription).toContain("Mission / goal:");
    expect(result.taskDescription).toContain(
      "Build an AI robotics consultancy that designs warehouse automation pilots for small manufacturers and lands its first paying customer.",
    );
    expect(result.taskDescription).toContain("first CEO-owned operating plan");
    expect(result.taskDescription).not.toContain("7-day execution plan");
  });
});
