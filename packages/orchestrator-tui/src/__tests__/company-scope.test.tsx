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

async function waitForRequest<T>(
  requests: unknown[],
  predicate: (request: unknown) => boolean,
  timeoutMs = 1000,
): Promise<T> {
  const start = Date.now();
  let request = requests.find(predicate);

  while (!request) {
    if (Date.now() - start >= timeoutMs) {
      throw new Error(
        `Timed out waiting for request.\nRecorded requests:\n${JSON.stringify(requests, null, 2)}`,
      );
    }
    await tick(20);
    request = requests.find(predicate);
  }

  return request as T;
}

async function waitForCall(
  calls: string[],
  predicate: (call: string) => boolean,
  timeoutMs = 1000,
): Promise<string> {
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

async function submitPrompt(input: {
  stdin: { write: (value: string) => void };
  lastFrame: () => string | undefined;
  text: string;
}) {
  input.stdin.write(input.text);
  await waitForFrame(input.lastFrame, (frame) => frame.includes(input.text));
  input.stdin.write("\r");
}

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

    if (url.includes("/api/companies/") && url.includes("/issues")) {
      return {
        ok: true,
        json: async () => [],
      };
    }

    if (url.includes("/api/companies/") && url.includes("/approvals?status=pending")) {
      return {
        ok: true,
        json: async () => [],
      };
    }

    throw new Error(`Unexpected URL: ${url}`);
  });

  return { fetchFn, calls };
}

describe("company-scoped orchestrator behavior", () => {
  it("uses the selected company context for status polling and codex issue-creation context", async () => {
    const mockProc = createMockProcess();
    const requests = captureRequests(mockProc);
    const mockSpawn = vi.fn().mockReturnValue(mockProc);
    const { fetchFn, calls } = createFetchWithCompanies();

    const { stdin, lastFrame, unmount } = render(
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

    await waitForCall(
      calls,
      (call) => call === "http://localhost:3100/api/orchestrator/status?companyId=company-b",
    );
    expect(calls).toContain(
      "http://localhost:3100/api/orchestrator/status?companyId=company-b",
    );
    expect(mockSpawn).toHaveBeenCalledTimes(1);

    await waitForRequest(requests, (request: any) => request.method === "initialize");

    respond(mockProc, { id: 0, result: { userAgent: "codex/0.117.0" } });

    stdin.write("\t");
    await tick();
    stdin.write("\t");
    await tick();

    await submitPrompt({
      stdin,
      lastFrame,
      text: "Please sort out our onboarding confusion",
    });

    const threadStart = await waitForRequest<{ params: { baseInstructions?: string } }>(
      requests,
      (request: any) => request.method === "thread/start",
    );
    expect(threadStart.params.baseInstructions).toContain("Currently selected company:");
    expect(threadStart.params.baseInstructions).toContain("company-b");
    expect(threadStart.params.baseInstructions).toContain("Beta Company");
    expect(threadStart.params.baseInstructions).toContain(
      "create a normal issue in the selected company",
    );

    respond(mockProc, { id: 1, result: { thread: { id: "thr_company_b" } } });

    const turnStart = await waitForRequest<{ params: { input: Array<{ text: string }> } }>(
      requests,
      (request: any) => request.method === "turn/start",
    );
    expect(turnStart.params.input[0]?.text).toContain("Selected company ID: company-b");
    expect(turnStart.params.input[0]?.text).toContain("Selected company name: Beta Company");
    expect(turnStart.params.input[0]?.text).toContain(
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

    await waitForRequest(requestsA, (request: any) => request.method === "initialize");
    respond(procA, { id: 0, result: { userAgent: "codex/0.117.0" } });

    await submitPrompt({
      stdin,
      lastFrame,
      text: "Review Alpha progress",
    });

    await waitForRequest(requestsA, (request: any) => request.method === "thread/start");
    respond(procA, { id: 1, result: { thread: { id: "thr_alpha" } } });
    await waitForRequest(requestsA, (request: any) => request.method === "turn/start");
    respond(procA, {
      id: 2,
      result: { turn: { id: "turn_alpha", status: "inProgress", items: [], error: null } },
    });
    respond(procA, {
      method: "item/agentMessage/delta",
      params: {
        threadId: "thr_alpha",
        turnId: "turn_alpha",
        itemId: "item_alpha",
        delta: "Alpha update ready.",
      },
    });
    respond(procA, {
      method: "turn/completed",
      params: {
        threadId: "thr_alpha",
        turn: { id: "turn_alpha", status: "completed", items: [], error: null },
      },
    });

    const alphaFrame = await waitForFrame(
      lastFrame,
      (frame) =>
        frame.includes("Alpha Company") &&
        frame.includes("Review Alpha progress") &&
        frame.includes("Alpha update ready.") &&
        frame.includes("thr_alpha"),
    );
    expect(alphaFrame).toContain("Alpha Company");
    expect(alphaFrame).toContain("Review Alpha progress");
    expect(alphaFrame).toContain("Alpha update ready.");
    expect(alphaFrame).toContain("thr_alpha");

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

    await waitForRequest(requestsB, (request: any) => request.method === "initialize");
    expect(mockSpawn).toHaveBeenCalledTimes(2);

    respond(procB, { id: 0, result: { userAgent: "codex/0.117.0" } });

    const switchedFrame = await waitForFrame(
      lastFrame,
      (frame) =>
        frame.includes("Beta Company") &&
        !frame.includes("Alpha Company") &&
        !frame.includes("Review Alpha progress") &&
        !frame.includes("Alpha update ready.") &&
        !frame.includes("thr_alpha"),
    );
    expect(switchedFrame).toContain("Beta Company");
    expect(switchedFrame).not.toContain("Alpha Company");
    expect(switchedFrame).not.toContain("Review Alpha progress");
    expect(switchedFrame).not.toContain("Alpha update ready.");
    expect(switchedFrame).not.toContain("thr_alpha");

    await submitPrompt({
      stdin,
      lastFrame,
      text: "Create work for Beta",
    });

    const threadStartB = await waitForRequest<{ params: { baseInstructions?: string } }>(
      requestsB,
      (request: any) => request.method === "thread/start",
    );
    expect(threadStartB.params.baseInstructions).toContain("company-b");

    respond(procB, { id: 1, result: { thread: { id: "thr_beta" } } });

    const turnStartB = await waitForRequest<
      { params: { threadId: string; input: Array<{ text: string }> } }
    >(
      requestsB,
      (request: any) => request.method === "turn/start",
    );
    expect(turnStartB.params.threadId).toBe("thr_beta");
    expect(turnStartB.params.input[0]?.text).toContain("Selected company ID: company-b");
    expect(turnStartB.params.input[0]?.text).toContain("Create work for Beta");
    expect(requestsA.filter((request: any) => request.method === "turn/start")).toHaveLength(1);

    unmount();
  });

  it("switches companies from the running TUI and resets the active session", async () => {
    const procA = createMockProcess();
    const procB = createMockProcess();
    const requestsA = captureRequests(procA);
    const requestsB = captureRequests(procB);
    const mockSpawn = vi.fn().mockReturnValueOnce(procA).mockReturnValueOnce(procB);
    const { fetchFn, calls } = createFetchWithCompanies();

    const { stdin, lastFrame, unmount } = render(
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

    await waitForRequest(requestsA, (request: any) => request.method === "initialize");
    respond(procA, { id: 0, result: { userAgent: "codex/0.117.0" } });

    await submitPrompt({
      stdin,
      lastFrame,
      text: "Alpha backlog review",
    });

    await waitForRequest(requestsA, (request: any) => request.method === "thread/start");
    respond(procA, { id: 1, result: { thread: { id: "thr_alpha_live" } } });
    await waitForRequest(requestsA, (request: any) => request.method === "turn/start");
    respond(procA, {
      id: 2,
      result: { turn: { id: "turn_alpha_live", status: "inProgress", items: [], error: null } },
    });
    respond(procA, {
      method: "item/agentMessage/delta",
      params: {
        threadId: "thr_alpha_live",
        turnId: "turn_alpha_live",
        itemId: "item_alpha_live",
        delta: "Alpha live note.",
      },
    });
    respond(procA, {
      method: "turn/completed",
      params: {
        threadId: "thr_alpha_live",
        turn: { id: "turn_alpha_live", status: "completed", items: [], error: null },
      },
    });

    await waitForFrame(
      lastFrame,
      (frame) => frame.includes("Alpha Company") && frame.includes("Alpha live note."),
    );

    stdin.write("\t");
    await tick();
    stdin.write("c");
    await tick();

    const switcherFrame = await waitForFrame(
      lastFrame,
      (frame) =>
        frame.includes("Switch Company")
        && frame.includes("Alpha Company")
        && frame.includes("Beta Company"),
    );
    expect(switcherFrame).toContain("Switch Company");

    stdin.write("\u001B[A");
    await tick();
    stdin.write("\r");
    await tick();

    await waitForCall(
      calls,
      (call) => call === "http://localhost:3100/api/orchestrator/status?companyId=company-b",
    );
    await waitForRequest(requestsB, (request: any) => request.method === "initialize");
    respond(procB, { id: 0, result: { userAgent: "codex/0.117.0" } });

    const switchedFrame = await waitForFrame(
      lastFrame,
      (frame) =>
        frame.includes("Beta Company")
        && !frame.includes("Alpha live note.")
        && !frame.includes("thr_alpha_live"),
    );
    expect(switchedFrame).toContain("Beta Company");
    expect(switchedFrame).not.toContain("Alpha live note.");
    expect(switchedFrame).not.toContain("thr_alpha_live");

    unmount();
  });
});
