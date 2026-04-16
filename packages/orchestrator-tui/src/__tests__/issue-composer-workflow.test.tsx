import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "ink-testing-library";
import { App } from "../components/App.js";

beforeEach(() => {
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

const tick = (ms = 50) => new Promise((resolve) => setTimeout(resolve, ms));

interface FetchCall {
  url: string;
  method: string;
  body: string | null;
}

async function waitForFrame(
  lastFrame: () => string | undefined,
  predicate: (frame: string) => boolean,
  timeoutMs = 1000,
): Promise<string> {
  const start = Date.now();
  let frame = lastFrame() ?? "";

  while (!predicate(frame)) {
    if (Date.now() - start >= timeoutMs) {
      throw new Error(`Timed out waiting for frame.\nLast frame:\n${frame}`);
    }
    await tick(20);
    frame = lastFrame() ?? "";
  }

  return frame;
}

async function waitForCall(
  calls: FetchCall[],
  predicate: (call: FetchCall) => boolean,
  timeoutMs = 1000,
): Promise<FetchCall> {
  const start = Date.now();
  let call = calls.find(predicate);

  while (!call) {
    if (Date.now() - start >= timeoutMs) {
      throw new Error(
        `Timed out waiting for fetch call.\nRecorded calls:\n${JSON.stringify(calls, null, 2)}`,
      );
    }
    await tick(20);
    call = calls.find(predicate);
  }

  return call;
}

function createComposerFetch(options?: {
  initialIssues?: Array<{
    id: string;
    identifier?: string | null;
    title: string;
    description?: string | null;
    status?: string;
    projectedStatus?: string | null;
    priority?: string;
    assigneeAgentId?: string | null;
    updatedAt?: string;
  }>;
  createError?: string;
}) {
  const calls: FetchCall[] = [];
  let issues = (options?.initialIssues ?? []).map((issue) => ({
    identifier: null,
    description: null,
    status: "todo",
    projectedStatus: null,
    priority: "medium",
    assigneeAgentId: null,
    updatedAt: "2026-04-05T00:00:00.000Z",
    createdAt: "2026-04-05T00:00:00.000Z",
    ...issue,
  }));

  const fetchFn = vi.fn().mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    const body =
      typeof init?.body === "string"
        ? init.body
        : init?.body instanceof URLSearchParams
          ? init.body.toString()
          : null;

    calls.push({ url, method, body });

    if (url.includes("/api/orchestrator/status?companyId=")) {
      return {
        ok: true,
        json: async () => ({
          agents: [
            {
              agentId: "agent-1",
              name: "CEO",
              status: "idle",
              activeRunCount: 0,
              queuedIntentCount: 0,
            },
          ],
          totalActiveRuns: 0,
          totalQueuedIntents: 0,
          totalActiveLeases: 0,
          activeRuns: [],
          recentRuns: [],
        }),
      };
    }

    if (url.endsWith("/api/companies")) {
      return {
        ok: true,
        json: async () => [
          {
            id: "company-1",
            name: "Audit Co",
            updatedAt: "2026-04-05T00:00:00.000Z",
          },
        ],
      };
    }

    if (url.endsWith("/api/companies/company-1/approvals?status=pending")) {
      return {
        ok: true,
        json: async () => [],
      };
    }

    if (url.endsWith("/api/companies/company-1/issues?status=backlog,todo,in_progress,in_review,blocked")) {
      return {
        ok: true,
        json: async () => issues,
      };
    }

    if (url.endsWith("/api/orchestrator/issues") && method === "POST") {
      if (options?.createError) {
        return {
          ok: false,
          status: 500,
          json: async () => ({ error: options.createError }),
        };
      }

      const payload = body ? JSON.parse(body) as {
        companyId: string;
        title: string;
        description?: string;
        priority?: string;
      } : {
        companyId: "",
        title: "",
      };

      const createdIssue = {
        id: "issue-created",
        identifier: "AUD-99",
        title: payload.title,
        description: payload.description ?? null,
        status: "todo",
        projectedStatus: null,
        priority: payload.priority ?? "high",
        assigneeAgentId: null,
        updatedAt: "2026-04-05T12:00:00.000Z",
        createdAt: "2026-04-05T12:00:00.000Z",
      };

      issues = [createdIssue, ...issues];

      return {
        ok: true,
        json: async () => createdIssue,
      };
    }

    throw new Error(`Unexpected ${method} ${url}`);
  });

  return { fetchFn, calls };
}

async function openIssueComposer(input: {
  stdin: { write: (value: string) => void };
  lastFrame: () => string | undefined;
}) {
  input.stdin.write("\t");
  await tick(50);
  input.stdin.write("n");
  await waitForFrame(input.lastFrame, (frame) => frame.includes("New Issue"));
}

describe("issue composer workflow", () => {
  it("keeps normal text entry isolated from shortcuts and only changes priority from the priority control", async () => {
    const { fetchFn } = createComposerFetch();

    const { stdin, lastFrame, unmount } = render(
      <App
        url="http://localhost:3100"
        apiKey="board-key"
        companyId="company-1"
        companyName="Audit Co"
        fetchFn={fetchFn}
        pollInterval={60000}
        enableCodex={false}
      />,
    );

    await tick(100);
    await openIssueComposer({ stdin, lastFrame });

    stdin.write("scope psc");
    let frame = await waitForFrame(
      lastFrame,
      (current) => current.includes("scope psc"),
    );
    expect(frame).toContain("Priority: high");
    expect(frame).not.toContain("Settings");
    expect(frame).not.toContain("Switch Company");

    stdin.write("\t");
    await tick(50);
    stdin.write("prep notes");
    frame = await waitForFrame(
      lastFrame,
      (current) => current.includes("prep notes"),
    );
    expect(frame).toContain("Priority: high");

    stdin.write("\t");
    await tick(50);
    stdin.write("\u001B[C");
    frame = await waitForFrame(
      lastFrame,
      (current) => current.includes("Priority: medium"),
    );
    expect(frame).toContain("scope psc");
    expect(frame).toContain("prep notes");

    unmount();
  });

  it("creates a company-scoped issue, closes the overlay, refreshes the queue, and appends confirmation", async () => {
    const { fetchFn, calls } = createComposerFetch({
      initialIssues: [
        {
          id: "issue-1",
          identifier: "AUD-1",
          title: "Existing queue item",
          description: "Already present before composer submit",
          priority: "medium",
          updatedAt: "2026-04-05T00:00:00.000Z",
        },
      ],
    });

    const { stdin, lastFrame, unmount } = render(
      <App
        url="http://localhost:3100"
        apiKey="board-key"
        companyId="company-1"
        companyName="Audit Co"
        fetchFn={fetchFn}
        pollInterval={60000}
        enableCodex={false}
      />,
    );

    await tick(100);
    await openIssueComposer({ stdin, lastFrame });

    stdin.write("Keyboard-only issue");
    await waitForFrame(lastFrame, (frame) => frame.includes("Keyboard-only issue"));
    stdin.write("\t");
    await tick(50);
    stdin.write("Needs queue feedback");
    await waitForFrame(lastFrame, (frame) => frame.includes("Needs queue feedback"));
    stdin.write("\t");
    await tick(50);
    stdin.write("\r");

    const createCall = await waitForCall(
      calls,
      (call) => call.url.endsWith("/api/orchestrator/issues") && call.method === "POST",
    );
    expect(JSON.parse(createCall.body ?? "{}")).toMatchObject({
      companyId: "company-1",
      title: "Keyboard-only issue",
      description: "Needs queue feedback",
      priority: "high",
    });

    const frame = await waitForFrame(
      lastFrame,
      (current) =>
        current.includes("Created issue AUD-99: Keyboard-only issue")
        && current.includes("AUD-99"),
    );
    expect(frame).not.toContain("New Issue");
    expect(frame).toContain("Keyboard-only issue");
    expect(
      calls.filter(
        (call) =>
          call.method === "GET"
          && call.url.endsWith("/api/companies/company-1/issues?status=backlog,todo,in_progress,in_review,blocked"),
      ).length,
    ).toBeGreaterThan(1);

    unmount();
  });

  it("keeps the overlay open with the entered values visible when issue creation fails", async () => {
    const { fetchFn, calls } = createComposerFetch({
      createError: "Server rejected the issue",
    });

    const { stdin, lastFrame, unmount } = render(
      <App
        url="http://localhost:3100"
        apiKey="board-key"
        companyId="company-1"
        companyName="Audit Co"
        fetchFn={fetchFn}
        pollInterval={60000}
        enableCodex={false}
      />,
    );

    await tick(100);
    await openIssueComposer({ stdin, lastFrame });

    stdin.write("Failure draft");
    await waitForFrame(lastFrame, (frame) => frame.includes("Failure draft"));
    stdin.write("\t");
    await tick(50);
    stdin.write("Keep this description");
    await waitForFrame(lastFrame, (frame) => frame.includes("Keep this description"));
    stdin.write("\t");
    await tick(50);
    stdin.write("\r");

    const createCall = await waitForCall(
      calls,
      (call) => call.url.endsWith("/api/orchestrator/issues") && call.method === "POST",
    );
    expect(JSON.parse(createCall.body ?? "{}")).toMatchObject({
      companyId: "company-1",
      title: "Failure draft",
      description: "Keep this description",
      priority: "high",
    });

    const frame = await waitForFrame(
      lastFrame,
      (current) => current.includes("Server rejected the issue"),
    );
    expect(frame).toContain("New Issue");
    expect(frame).toContain("Failure draft");
    expect(frame).toContain("Keep this description");
    expect(frame).toContain("Priority: high");

    unmount();
  });
});
