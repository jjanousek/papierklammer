import { describe, expect, it, vi } from "vitest";
import { getIssueDisplayStatus, hasIssueLiveOperatorState, isRecentlyRecoveredIssue } from "./issueExecutionState";

describe("issueExecutionState", () => {
  it("prefers projected status when present", () => {
    expect(
      getIssueDisplayStatus({ status: "in_progress", projectedStatus: "todo" }),
    ).toBe("todo");
  });

  it("normalizes blocked_on_dependency to blocked for operator surfaces", () => {
    expect(
      getIssueDisplayStatus({ status: "todo", projectedStatus: "blocked_on_dependency" }),
    ).toBe("blocked");
  });

  it("treats active run or lease metadata as live operator state", () => {
    expect(hasIssueLiveOperatorState({ activeRunId: "run-1", activeLeaseId: null })).toBe(true);
    expect(hasIssueLiveOperatorState({ activeRunId: null, activeLeaseId: "lease-1" })).toBe(true);
    expect(hasIssueLiveOperatorState({ activeRunId: null, activeLeaseId: null }, true)).toBe(true);
  });

  it("marks a recently reconciled todo issue as recovered when no live ownership remains", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-05T12:00:00.000Z"));

    expect(
      isRecentlyRecoveredIssue({
        status: "todo",
        projectedStatus: "todo",
        activeRunId: null,
        activeLeaseId: null,
        executionRunId: null,
        checkoutRunId: null,
        lastReconciledAt: new Date("2026-04-05T11:55:00.000Z"),
      }),
    ).toBe(true);

    vi.useRealTimers();
  });

  it("does not mark recovered issues when stale ownership still remains", () => {
    expect(
      isRecentlyRecoveredIssue({
        status: "todo",
        projectedStatus: "todo",
        activeRunId: null,
        activeLeaseId: null,
        executionRunId: "run-1",
        checkoutRunId: null,
        lastReconciledAt: new Date(),
      }),
    ).toBe(false);
  });

  it("does not keep the recovered badge forever", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-06T12:00:01.000Z"));

    expect(
      isRecentlyRecoveredIssue({
        status: "todo",
        projectedStatus: "todo",
        activeRunId: null,
        activeLeaseId: null,
        executionRunId: null,
        checkoutRunId: null,
        lastReconciledAt: new Date("2026-04-05T12:00:00.000Z"),
      }),
    ).toBe(false);

    vi.useRealTimers();
  });
});
