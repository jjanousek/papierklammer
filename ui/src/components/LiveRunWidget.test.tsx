// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  liveRunsForIssue: vi.fn(() => [
    {
      id: "run-1",
      status: "running",
      invocationSource: "manual",
      triggerDetail: "issue_comment",
      startedAt: "2026-04-05T00:00:00.000Z",
      finishedAt: null,
      createdAt: "2026-04-05T00:00:00.000Z",
      agentId: "agent-1",
      agentName: "Engineer Alpha",
      adapterType: "codex_local",
      issueId: "issue-1",
    },
  ]),
  activeRunForIssue: vi.fn(() => ({
    id: "run-1",
    companyId: "company-1",
    agentId: "agent-1",
    agentName: "Engineer Alpha",
    adapterType: "codex_local",
    invocationSource: "manual",
    triggerDetail: "issue_comment",
    status: "running",
    startedAt: new Date("2026-04-05T00:00:00.000Z"),
    finishedAt: null,
    error: null,
    wakeupRequestId: null,
    exitCode: null,
    signal: null,
    usageJson: null,
    resultJson: null,
    sessionIdBefore: null,
    sessionIdAfter: null,
    logStore: null,
    logRef: null,
    logBytes: null,
    logSha256: null,
    logCompressed: false,
    stdoutExcerpt: null,
    stderrExcerpt: null,
    errorCode: null,
    externalRunId: null,
    processPid: null,
    processStartedAt: null,
    retryOfRunId: null,
    processLossRetryCount: 0,
    contextSnapshot: null,
    createdAt: new Date("2026-04-05T00:00:00.000Z"),
    updatedAt: new Date("2026-04-05T00:00:00.000Z"),
  })),
  cancel: vi.fn(),
  invalidateQueries: vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ enabled = true, queryFn }: { enabled?: boolean; queryFn: () => unknown }) => ({
    data: enabled ? queryFn() : undefined,
    isLoading: false,
    error: null,
  }),
  useQueryClient: () => ({
    invalidateQueries: mocks.invalidateQueries,
  }),
}));

vi.mock("@/lib/router", () => ({
  Link: ({ children, to, ...props }: { children: React.ReactNode; to?: string }) => (
    <a href={typeof to === "string" ? to : undefined} {...props}>{children}</a>
  ),
}));

vi.mock("../api/heartbeats", () => ({
  heartbeatsApi: {
    liveRunsForIssue: mocks.liveRunsForIssue,
    activeRunForIssue: mocks.activeRunForIssue,
    cancel: mocks.cancel,
  },
}));

vi.mock("./Identity", () => ({
  Identity: ({ name }: { name: string }) => <span>{name}</span>,
}));

vi.mock("./StatusBadge", () => ({
  StatusBadge: ({ status }: { status: string }) => <span>{status}</span>,
}));

vi.mock("./transcript/useLiveRunTranscripts", () => ({
  useLiveRunTranscripts: ({ runs }: { runs: Array<{ id: string }> }) => ({
    transcriptByRun: new Map(
      runs.map((run) => [
        run.id,
        [
          {
            kind: "assistant",
            ts: "2026-04-05T00:00:05.000Z",
            text: "Generated the release notes draft and updated the CLI output fixture.",
          },
        ],
      ]),
    ),
    hasOutputForRun: () => true,
  }),
}));

vi.mock("./transcript/RunTranscriptView", () => ({
  RunTranscriptView: ({ entries, emptyMessage }: { entries: Array<{ text?: string }>; emptyMessage: string }) => (
    <div>{entries.length > 0 ? entries.map((entry) => entry.text).join("\n") : emptyMessage}</div>
  ),
}));

vi.mock("lucide-react", () => ({
  ExternalLink: () => <span data-icon="ExternalLink" />,
  Square: () => <span data-icon="Square" />,
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

import { LiveRunWidget } from "./LiveRunWidget";

describe("LiveRunWidget", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    mocks.liveRunsForIssue.mockClear();
    mocks.activeRunForIssue.mockClear();
    mocks.cancel.mockClear();
    mocks.invalidateQueries.mockClear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("renders substantive live transcript output instead of status-only noise", () => {
    act(() => {
      root.render(<LiveRunWidget issueId="issue-1" companyId="company-1" />);
    });

    expect(mocks.liveRunsForIssue).toHaveBeenCalledWith("issue-1");
    expect(mocks.activeRunForIssue).toHaveBeenCalledWith("issue-1");
    expect(container.textContent).toContain("Live Runs");
    expect(container.textContent).toContain("Engineer Alpha");
    expect(container.textContent).toContain("Generated the release notes draft and updated the CLI output fixture.");

    const runLinks = Array.from(container.querySelectorAll('a[href="/agents/agent-1/runs/run-1"]'));
    expect(runLinks).toHaveLength(2);
  });
});
