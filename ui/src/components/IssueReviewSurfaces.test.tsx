// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Agent } from "@papierklammer/shared";
import type { RunForIssue } from "../api/activity";

const mocks = vi.hoisted(() => ({
  transcriptByRun: new Map<string, Array<{ kind: "assistant"; text: string }>>(),
}));

vi.mock("@/lib/router", () => ({
  Link: ({ children, to, ...props }: { children: React.ReactNode; to?: string }) => (
    <a href={typeof to === "string" ? to : undefined} {...props}>{children}</a>
  ),
}));

vi.mock("./Identity", () => ({
  Identity: ({ name }: { name: string }) => <span>{name}</span>,
}));

vi.mock("./StatusBadge", () => ({
  StatusBadge: ({ status }: { status: string }) => <span>{status}</span>,
}));

vi.mock("./transcript/useLiveRunTranscripts", () => ({
  useLiveRunTranscripts: () => ({
    transcriptByRun: mocks.transcriptByRun,
  }),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

import { IssueReviewSurfaces } from "./IssueReviewSurfaces";

function createRun(overrides: Partial<RunForIssue> = {}): RunForIssue {
  return {
    runId: "run-1",
    status: "failed",
    agentId: "agent-1",
    startedAt: "2026-04-05T00:00:00.000Z",
    finishedAt: "2026-04-05T00:05:00.000Z",
    createdAt: "2026-04-05T00:00:00.000Z",
    invocationSource: "manual",
    usageJson: null,
    resultJson: null,
    ...overrides,
  };
}

describe("IssueReviewSurfaces", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let agentMap: Map<string, Agent>;

  beforeEach(() => {
    mocks.transcriptByRun = new Map();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    agentMap = new Map([
      [
        "agent-1",
        {
          id: "agent-1",
          companyId: "company-1",
          name: "Engineer Alpha",
          urlKey: "engineer-alpha",
          role: "engineer",
          title: null,
          icon: null,
          status: "active",
          reportsTo: null,
          capabilities: null,
          adapterType: "codex_local",
          adapterConfig: {},
          runtimeConfig: {},
          budgetMonthlyCents: 0,
          spentMonthlyCents: 0,
          pauseReason: null,
          pausedAt: null,
          permissions: { canCreateAgents: false },
          lastHeartbeatAt: null,
          metadata: null,
          createdAt: new Date("2026-04-05T00:00:00.000Z"),
          updatedAt: new Date("2026-04-05T00:00:00.000Z"),
        },
      ],
    ]);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("prefers structured failed-run summaries from resultJson.error over transcript fallback", () => {
    mocks.transcriptByRun.set("run-1", [
      {
        kind: "assistant",
        text: "Transcript fallback that should stay hidden behind the structured error summary.",
      },
    ]);

    act(() => {
      root.render(
        <IssueReviewSurfaces
          companyId="company-1"
          workProducts={[]}
          runs={[
            createRun({
              resultJson: {
                error: {
                  message: "Dependency install failed because the workspace lockfile was out of date.",
                },
                stdout: "npm output noise",
              },
            }),
          ]}
          agentMap={agentMap}
          comments={[]}
        />,
      );
    });

    expect(container.textContent).toContain("Dependency install failed because the workspace lockfile was out of date.");
    expect(container.textContent).not.toContain("Transcript fallback that should stay hidden behind the structured error summary.");
  });

  it("keeps successful run preview behavior unchanged", () => {
    mocks.transcriptByRun.set("run-1", [
      {
        kind: "assistant",
        text: "Fallback transcript that should not replace the persisted summary.",
      },
    ]);

    act(() => {
      root.render(
        <IssueReviewSurfaces
          companyId="company-1"
          workProducts={[]}
          runs={[
            createRun({
              status: "succeeded",
              resultJson: {
                summary: "Prepared the release report and attached it for board review.",
              },
            }),
          ]}
          agentMap={agentMap}
          comments={[]}
        />,
      );
    });

    expect(container.textContent).toContain("Prepared the release report and attached it for board review.");
    expect(container.textContent).not.toContain("Fallback transcript that should not replace the persisted summary.");
  });

  it("falls back to run-linked issue updates when persisted run data has no preview", () => {
    act(() => {
      root.render(
        <IssueReviewSurfaces
          companyId="company-1"
          workProducts={[]}
          runs={[
            createRun({
              status: "succeeded",
            }),
          ]}
          agentMap={agentMap}
          comments={[
            {
              id: "comment-1",
              body: [
                "Heartbeat completed as CEO with delegation-first handling.",
                "",
                "- Created CTO execution child [ORC-7](/ORC/issues/ORC-7) under [ORC-6](/ORC/issues/ORC-6).",
                "- Posted blocker references to approval [fcd4484b](/ORC/approvals/fcd4484b-fb1d-479c-bba7-b371517c4336).",
              ].join("\n"),
              createdAt: new Date("2026-04-05T00:06:00.000Z"),
              runId: "run-1",
            },
          ]}
        />,
      );
    });

    expect(container.textContent).toContain("Heartbeat completed as CEO with delegation-first handling.");
    expect(container.querySelector('a[href="/ORC/issues/ORC-7"]')?.textContent).toBe("ORC-7");
    expect(container.querySelector('a[href="/ORC/approvals/fcd4484b-fb1d-479c-bba7-b371517c4336"]')?.textContent).toBe("fcd4484b");
  });
});
