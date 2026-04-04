import React from "react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { render } from "ink-testing-library";
import { EventEmitter, PassThrough } from "node:stream";
import { App } from "../components/App.js";

beforeEach(() => {
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

const tick = (ms = 50) => new Promise((resolve) => setTimeout(resolve, ms));

function createMockProcess() {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const proc = new EventEmitter() as EventEmitter & {
    stdin: PassThrough;
    stdout: PassThrough;
    kill: ReturnType<typeof vi.fn>;
  };
  proc.stdin = stdin;
  proc.stdout = stdout;
  proc.kill = vi.fn();
  return proc;
}

function respond(proc: ReturnType<typeof createMockProcess>, msg: unknown): void {
  proc.stdout.write(`${JSON.stringify(msg)}\n`);
}

function captureRequests(proc: ReturnType<typeof createMockProcess>): unknown[] {
  const requests: unknown[] = [];
  proc.stdin.on("data", (chunk: Buffer) => {
    const lines = chunk.toString().split("\n").filter(Boolean);
    for (const line of lines) {
      requests.push(JSON.parse(line));
    }
  });
  return requests;
}

function createFetchWithCompanies() {
  const calls: string[] = [];
  const fetchFn = vi.fn().mockImplementation(async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);

    if (url.endsWith("/api/companies")) {
      return {
        ok: true,
        json: async () => [
          {
            id: "company-b",
            name: "Beta Company",
            updatedAt: "2026-04-04T12:00:00.000Z",
          },
          {
            id: "company-a",
            name: "Alpha Company",
            updatedAt: "2026-04-03T12:00:00.000Z",
          },
        ],
      };
    }

    if (url.includes("/api/orchestrator/status?companyId=")) {
      return {
        ok: true,
        json: async () => ({
          agents: [],
          totalActiveRuns: 0,
          totalQueuedIntents: 0,
          totalActiveLeases: 0,
        }),
      };
    }

    throw new Error(`Unexpected URL: ${url}`);
  });

  return { fetchFn, calls };
}

describe("company-scoped orchestrator behavior", () => {
  it("uses the company selected in the picker for status polling and codex issue-creation context", async () => {
    const mockProc = createMockProcess();
    const requests = captureRequests(mockProc);
    const mockSpawn = vi.fn().mockReturnValue(mockProc);
    const { fetchFn, calls } = createFetchWithCompanies();

    const { stdin, unmount } = render(
      <App
        url="http://localhost:3100"
        apiKey="board-key"
        companyId=""
        companyName=""
        fetchFn={fetchFn}
        pollInterval={60000}
        spawnFn={mockSpawn}
        enableCodex={true}
      />,
    );

    await tick(100);

    stdin.write("\r");
    await tick(50);

    expect(calls).toContain(
      "http://localhost:3100/api/orchestrator/status?companyId=company-b",
    );
    expect(mockSpawn).toHaveBeenCalledTimes(1);

    respond(mockProc, { id: 0, result: { userAgent: "codex/0.117.0" } });
    await tick(50);

    stdin.write("Please sort out our onboarding confusion");
    await tick(50);
    stdin.write("\r");
    await tick(100);

    const threadStart = requests.find(
      (request: any) => request.method === "thread/start",
    ) as { params: { baseInstructions?: string } } | undefined;

    expect(threadStart).toBeDefined();
    expect(threadStart?.params.baseInstructions).toContain("Currently selected company:");
    expect(threadStart?.params.baseInstructions).toContain("company-b");
    expect(threadStart?.params.baseInstructions).toContain("Beta Company");
    expect(threadStart?.params.baseInstructions).toContain(
      "create a normal issue in the selected company",
    );

    respond(mockProc, { id: 1, result: { thread: { id: "thr_company_b" } } });
    await tick(100);

    const turnStart = requests.find(
      (request: any) => request.method === "turn/start",
    ) as { params: { input: Array<{ text: string }> } } | undefined;

    expect(turnStart).toBeDefined();
    expect(turnStart?.params.input[0]?.text).toContain("Selected company ID: company-b");
    expect(turnStart?.params.input[0]?.text).toContain("Selected company name: Beta Company");
    expect(turnStart?.params.input[0]?.text).toContain(
      "Please sort out our onboarding confusion",
    );

    unmount();
  });

  it("switching to a different launch company resets transcript and thread context", async () => {
    const procA = createMockProcess();
    const procB = createMockProcess();
    const requestsA = captureRequests(procA);
    const requestsB = captureRequests(procB);
    const mockSpawn = vi.fn().mockReturnValueOnce(procA).mockReturnValueOnce(procB);
    const { fetchFn } = createFetchWithCompanies();

    const { stdin, lastFrame, rerender, unmount } = render(
      <App
        url="http://localhost:3100"
        apiKey="board-key"
        companyId="company-a"
        companyName="Alpha Company"
        fetchFn={fetchFn}
        pollInterval={60000}
        spawnFn={mockSpawn}
        enableCodex={true}
      />,
    );

    await tick(50);
    respond(procA, { id: 0, result: { userAgent: "codex/0.117.0" } });
    await tick(50);

    stdin.write("Review Alpha progress");
    await tick(50);
    stdin.write("\r");
    await tick(100);

    respond(procA, { id: 1, result: { thread: { id: "thr_alpha" } } });
    await tick(50);
    respond(procA, {
      id: 2,
      result: { turn: { id: "turn_alpha", status: "inProgress", items: [], error: null } },
    });
    await tick(50);
    respond(procA, {
      method: "item/agentMessage/delta",
      params: {
        threadId: "thr_alpha",
        turnId: "turn_alpha",
        itemId: "item_alpha",
        delta: "Alpha update ready.",
      },
    });
    await tick(50);
    respond(procA, {
      method: "turn/completed",
      params: {
        threadId: "thr_alpha",
        turn: { id: "turn_alpha", status: "completed", items: [], error: null },
      },
    });
    await tick(100);

    expect(lastFrame()).toContain("Alpha Company");
    expect(lastFrame()).toContain("Review Alpha progress");
    expect(lastFrame()).toContain("Alpha update ready.");
    expect(lastFrame()).toContain("thr_alpha");

    rerender(
      <App
        url="http://localhost:3100"
        apiKey="board-key"
        companyId="company-b"
        companyName="Beta Company"
        fetchFn={fetchFn}
        pollInterval={60000}
        spawnFn={mockSpawn}
        enableCodex={true}
      />,
    );

    await tick(100);

    expect(mockSpawn).toHaveBeenCalledTimes(2);

    respond(procB, { id: 0, result: { userAgent: "codex/0.117.0" } });
    await tick(100);

    const switchedFrame = lastFrame()!;
    expect(switchedFrame).toContain("Beta Company");
    expect(switchedFrame).not.toContain("Alpha Company");
    expect(switchedFrame).not.toContain("Review Alpha progress");
    expect(switchedFrame).not.toContain("Alpha update ready.");
    expect(switchedFrame).not.toContain("thr_alpha");

    stdin.write("Create work for Beta");
    await tick(50);
    stdin.write("\r");
    await tick(100);

    const threadStartB = requestsB.find(
      (request: any) => request.method === "thread/start",
    ) as { params: { baseInstructions?: string } } | undefined;
    expect(threadStartB?.params.baseInstructions).toContain("company-b");

    respond(procB, { id: 1, result: { thread: { id: "thr_beta" } } });
    await tick(100);

    const turnStartB = requestsB.find(
      (request: any) => request.method === "turn/start",
    ) as { params: { threadId: string; input: Array<{ text: string }> } } | undefined;

    expect(turnStartB).toBeDefined();
    expect(turnStartB?.params.threadId).toBe("thr_beta");
    expect(turnStartB?.params.input[0]?.text).toContain("Selected company ID: company-b");
    expect(turnStartB?.params.input[0]?.text).toContain("Create work for Beta");
    expect(requestsA.filter((request: any) => request.method === "turn/start")).toHaveLength(1);

    unmount();
  });
});
