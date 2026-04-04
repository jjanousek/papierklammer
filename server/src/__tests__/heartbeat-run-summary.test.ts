import { describe, expect, it } from "vitest";
import {
  mergeHeartbeatRunResultJson,
  summarizeHeartbeatRunResultJson,
} from "../services/heartbeat-run-summary.js";

describe("summarizeHeartbeatRunResultJson", () => {
  it("truncates text fields and preserves cost aliases", () => {
    const summary = summarizeHeartbeatRunResultJson({
      summary: "a".repeat(600),
      result: "ok",
      message: "done",
      error: "failed",
      total_cost_usd: 1.23,
      cost_usd: 0.45,
      costUsd: 0.67,
      nested: { ignored: true },
    });

    expect(summary).toEqual({
      summary: "a".repeat(500),
      result: "ok",
      message: "done",
      error: "failed",
      total_cost_usd: 1.23,
      cost_usd: 0.45,
      costUsd: 0.67,
    });
  });

  it("returns null for non-object and irrelevant payloads", () => {
    expect(summarizeHeartbeatRunResultJson(null)).toBeNull();
    expect(summarizeHeartbeatRunResultJson(["nope"] as unknown as Record<string, unknown>)).toBeNull();
    expect(summarizeHeartbeatRunResultJson({ nested: { only: "ignored" } })).toBeNull();
  });
});

describe("mergeHeartbeatRunResultJson", () => {
  it("persists adapter summaries alongside existing result payload fields", () => {
    expect(
      mergeHeartbeatRunResultJson(
        {
          stdout: "raw stdout",
          stderr: "",
        },
        "Prepared a concise operator-facing result summary.",
      ),
    ).toEqual({
      stdout: "raw stdout",
      stderr: "",
      summary: "Prepared a concise operator-facing result summary.",
    });
  });

  it("does not override an existing summary field", () => {
    expect(
      mergeHeartbeatRunResultJson(
        {
          summary: "keep me",
          stdout: "raw stdout",
        },
        "new summary",
      ),
    ).toEqual({
      summary: "keep me",
      stdout: "raw stdout",
    });
  });
});
