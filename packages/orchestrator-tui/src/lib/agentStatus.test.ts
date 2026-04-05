import { describe, expect, it } from "vitest";
import { getAgentOverviewDisplayStatus } from "./agentStatus.js";

describe("agentStatus", () => {
  it("keeps agents running when they still have a live run", () => {
    expect(
      getAgentOverviewDisplayStatus({ status: "idle", activeRunCount: 1 }),
    ).toBe("running");
  });

  it("clears stale raw running state when no live run remains", () => {
    expect(
      getAgentOverviewDisplayStatus({ status: "running", activeRunCount: 0 }),
    ).toBe("idle");
  });
});
