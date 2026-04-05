import { describe, expect, it } from "vitest";
import { dashboardActivityPriority, getDashboardAgentDisplayStatus, hasDashboardLiveRun, isDashboardAgentCountedActive } from "./agentActivity";

describe("agentActivity", () => {
  it("treats queued and running runs as live dashboard work", () => {
    expect(hasDashboardLiveRun({ status: "queued" } as never)).toBe(true);
    expect(hasDashboardLiveRun({ status: "running" } as never)).toBe(true);
    expect(hasDashboardLiveRun({ status: "succeeded" } as never)).toBe(false);
  });

  it("normalizes stale raw running agents without a live run back to idle", () => {
    expect(
      getDashboardAgentDisplayStatus({ status: "running" } as never, null),
    ).toBe("idle");
  });

  it("keeps agents active when they still have a real live run", () => {
    expect(
      getDashboardAgentDisplayStatus(
        { status: "idle" } as never,
        { status: "running" } as never,
      ),
    ).toBe("running");
  });

  it("does not count stale raw running agents as active dashboard work", () => {
    expect(
      isDashboardAgentCountedActive({ status: "running" } as never, null),
    ).toBe(false);
    expect(
      isDashboardAgentCountedActive(
        { status: "active" } as never,
        { status: "queued" } as never,
      ),
    ).toBe(true);
  });

  it("sorts stale raw running agents after genuine active work", () => {
    expect(
      dashboardActivityPriority({ status: "running" } as never, null),
    ).toBeGreaterThan(
      dashboardActivityPriority(
        { status: "idle" } as never,
        { status: "running" } as never,
      ),
    );
  });
});
