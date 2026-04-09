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

function createManagementFetch(options?: {
  approvals?: Array<{
    id: string;
    type: string;
    status?: string;
    requestedByAgentId?: string | null;
    createdAt?: string;
  }>;
  approvalsError?: string;
}) {
  const calls: FetchCall[] = [];
  let approvals = (options?.approvals ?? []).map((approval) => ({
    status: "pending",
    requestedByAgentId: null,
    createdAt: "2026-04-05T00:00:00.000Z",
    ...approval,
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

    if (url.endsWith("/api/companies/company-1/approvals?status=pending")) {
      if (options?.approvalsError) {
        return {
          ok: false,
          status: 500,
          json: async () => ({ error: options.approvalsError }),
        };
      }

      return {
        ok: true,
        json: async () => approvals,
      };
    }

    if (url.endsWith("/api/companies/company-1/issues?status=backlog,todo,in_progress,in_review,blocked")) {
      return {
        ok: true,
        json: async () => [],
      };
    }

    if (url.endsWith("/api/agents/agent-1/heartbeat/invoke") && method === "POST") {
      return {
        ok: true,
        json: async () => ({ id: "12345678-run", status: "queued" }),
      };
    }

    if (url.endsWith("/api/agents/agent-1/wakeup") && method === "POST") {
      return {
        ok: true,
        json: async () => ({ id: "87654321-run", status: "queued" }),
      };
    }

    const approveMatch = url.match(/\/api\/approvals\/([^/]+)\/approve$/);
    if (approveMatch && method === "POST") {
      const approvalId = approveMatch[1]!;
      approvals = approvals.filter((approval) => approval.id !== approvalId);
      return {
        ok: true,
        json: async () => ({
          id: approvalId,
          type: "hire_agent",
          status: "approved",
          requestedByAgentId: null,
          createdAt: "2026-04-05T00:00:00.000Z",
        }),
      };
    }

    const rejectMatch = url.match(/\/api\/approvals\/([^/]+)\/reject$/);
    if (rejectMatch && method === "POST") {
      const approvalId = rejectMatch[1]!;
      approvals = approvals.filter((approval) => approval.id !== approvalId);
      return {
        ok: true,
        json: async () => ({
          id: approvalId,
          type: "hire_agent",
          status: "rejected",
          requestedByAgentId: null,
          createdAt: "2026-04-05T00:00:00.000Z",
        }),
      };
    }

    throw new Error(`Unexpected ${method} ${url}`);
  });

  return { fetchFn, calls };
}

describe("management shortcuts", () => {
  it("invokes the selected agent heartbeat from the sidebar without free-form text", async () => {
    const { fetchFn, calls } = createManagementFetch();

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
    stdin.write("\t");
    await tick(50);
    stdin.write("v");

    const invokeCall = await waitForCall(
      calls,
      (call) =>
        call.url.endsWith("/api/agents/agent-1/heartbeat/invoke")
        && call.method === "POST",
    );
    expect(invokeCall).toEqual({
      url: "http://localhost:3100/api/agents/agent-1/heartbeat/invoke",
      method: "POST",
      body: "{}",
    });

    const frame = await waitForFrame(
      lastFrame,
      (current) => current.includes("Invoked heartbeat for CEO (run 12345678)."),
    );
    expect(frame).toContain("invoke");
    expect(frame).toContain("Invoked heartbeat for CEO (run 12345678).");

    unmount();
  });

  it("queues a wakeup for the selected agent from the sidebar", async () => {
    const { fetchFn, calls } = createManagementFetch();

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
    stdin.write("\t");
    await tick(50);
    stdin.write("w");

    const wakeupCall = await waitForCall(
      calls,
      (call) => call.url.endsWith("/api/agents/agent-1/wakeup") && call.method === "POST",
    );
    expect(wakeupCall).toEqual({
      url: "http://localhost:3100/api/agents/agent-1/wakeup",
      method: "POST",
      body: JSON.stringify({
        source: "on_demand",
        triggerDetail: "manual",
        reason: "tui_shortcut",
      }),
    });

    const frame = await waitForFrame(
      lastFrame,
      (current) => current.includes("Queued wakeup for CEO (run 87654321)."),
    );
    expect(frame).toContain("Queued wakeup for CEO (run 87654321).");

    unmount();
  });

  it("cycles pending approvals and approves the selected approval from the sidebar", async () => {
    const { fetchFn, calls } = createManagementFetch({
      approvals: [
        {
          id: "bbbbbbbb-1111-1111-1111-111111111111",
          type: "hire_agent",
          createdAt: "2026-04-05T00:00:00.000Z",
        },
        {
          id: "cccccccc-2222-2222-2222-222222222222",
          type: "hire_agent",
          createdAt: "2026-04-05T01:00:00.000Z",
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
    stdin.write("\t");
    await tick(50);
    stdin.write("]");
    await tick(50);

    expect(lastFrame()).toContain("cccccccc");

    stdin.write("a");

    const approveCall = await waitForCall(
      calls,
      (call) => call.url.includes("/api/approvals/") && call.method === "POST",
    );
    expect(approveCall).toEqual({
      url: "http://localhost:3100/api/approvals/cccccccc-2222-2222-2222-222222222222/approve",
      method: "POST",
      body: "{}",
    });
    const frame = await waitForFrame(
      lastFrame,
      (current) => current.includes("Approved hire_agent approval cccccccc."),
    );
    expect(frame).toContain("Approved hire_agent approval cccccccc.");

    unmount();
  });

  it("leaves shortcut letters available for normal input when the input bar is focused", async () => {
    const { fetchFn, calls } = createManagementFetch();

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
    stdin.write("a");
    await tick(100);

    expect(
      calls.some((call) => call.url.includes("/api/approvals/") && call.method === "POST"),
    ).toBe(false);
    expect(lastFrame()).toContain("> a");

    unmount();
  });

  it.each([
    ["help", "?"],
    ["settings", "s"],
  ])(
    "does not fire sidebar mutation shortcuts while the %s overlay is open",
    async (_overlayName, openKey) => {
      const { fetchFn, calls } = createManagementFetch({
        approvals: [
          {
            id: "bbbbbbbb-1111-1111-1111-111111111111",
            type: "hire_agent",
            createdAt: "2026-04-05T00:00:00.000Z",
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
      stdin.write("\t");
      await tick(50);
      stdin.write(openKey);
      await tick(50);
      stdin.write("v");
      stdin.write("a");
      await tick(100);

      expect(
        calls.some(
          (call) =>
            call.method === "POST"
            && (
              call.url.endsWith("/api/agents/agent-1/heartbeat/invoke")
              || call.url.includes("/api/approvals/")
            ),
        ),
      ).toBe(false);
      expect(lastFrame()).not.toContain("Invoked heartbeat for CEO");
      expect(lastFrame()).not.toContain("Approved hire_agent approval");

      unmount();
    },
  );

  it("shows an explicit pending approvals polling error instead of an empty approvals message", async () => {
    const { fetchFn } = createManagementFetch({
      approvalsError: "Approval polling failed",
    });

    const { lastFrame, unmount } = render(
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

    expect(lastFrame()).toContain("Pending");
    expect(lastFrame()).toContain("unavailable");
    expect(lastFrame()).toContain("Approval polling");
    expect(lastFrame()).toContain("failed");
    expect(lastFrame()).not.toContain("No pending approvals");

    unmount();
  });
});
