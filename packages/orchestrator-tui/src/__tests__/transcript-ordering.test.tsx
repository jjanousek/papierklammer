import React from "react";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render } from "ink-testing-library";
import { EventEmitter, PassThrough } from "node:stream";
import { App } from "../components/App.js";
import type { AgentOverview } from "../hooks/useOrchestratorStatus.js";

vi.mock("../components/AnimatedGlyph.js", () => ({
  AnimatedGlyph: () => React.createElement("ink-text", null, "SPINNER"),
}));

beforeEach(() => {
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

const tick = (ms = 50) => new Promise((r) => setTimeout(r, ms));

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

function stabilizeTerminal(stdout: NodeJS.WriteStream | EventEmitter): void {
  const stream = stdout as NodeJS.WriteStream & EventEmitter;
  Object.defineProperty(stream, "columns", {
    value: 140,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(stream, "rows", {
    value: 36,
    writable: true,
    configurable: true,
  });
  stream.emit("resize");
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

const MOCK_AGENTS: AgentOverview[] = [
  { agentId: "a1", name: "CEO", status: "idle", activeRunCount: 0, queuedIntentCount: 0 },
];

function createMockFetch() {
  return vi.fn().mockImplementation(async (input: string | URL | Request) => {
    const url = String(input);

    if (url.includes("/approvals?status=pending")) {
      return {
        ok: true,
        json: async () => [],
      };
    }

    if (url.includes("/api/companies/") && url.includes("/issues")) {
      return {
        ok: true,
        json: async () => [],
      };
    }

    return {
      ok: true,
      json: async () => ({
        agents: MOCK_AGENTS,
        totalActiveRuns: 0,
        totalQueuedIntents: 0,
        totalActiveLeases: 0,
      }),
    };
  });
}

async function setupApp() {
  const mockProc = createMockProcess();
  const mockSpawn = vi.fn().mockReturnValue(mockProc);
  const mockFetch = createMockFetch();

  const result = render(
    <App
      url="http://localhost:3100"
      apiKey="test-key"
      companyId="test-company"
      fetchFn={mockFetch}
      pollInterval={60000}
      spawnFn={mockSpawn}
      enableCodex={true}
    />,
  );

  stabilizeTerminal(result.stdout as unknown as NodeJS.WriteStream | EventEmitter);
  await tick();

  respond(mockProc, { id: 0, result: { userAgent: "codex/0.117.0" } });
  await tick();

  result.stdin.write("\t");
  await tick();
  result.stdin.write("\t");
  await tick();

  return { ...result, mockProc };
}

describe("live transcript ordering and terminal states", () => {
  it("preserves observed narration and tool chronology in the finalized transcript", async () => {
    const { stdin, lastFrame, unmount, mockProc } = await setupApp();

    stdin.write("Show me the live order");
    await tick();
    stdin.write("\r");
    await tick(100);

    respond(mockProc, { id: 1, result: { thread: { id: "thr_ordering" } } });
    await tick();
    respond(mockProc, {
      id: 2,
      result: {
        turn: { id: "turn_ordering", status: "inProgress", items: [], error: null },
      },
    });
    await tick();

    respond(mockProc, {
      method: "item/agentMessage/delta",
      params: {
        threadId: "thr_ordering",
        turnId: "turn_ordering",
        itemId: "msg_before_tool",
        delta: "Before the tool.",
      },
    });
    await tick();

    respond(mockProc, {
      method: "item/started",
      params: {
        threadId: "thr_ordering",
        turnId: "turn_ordering",
        item: {
          type: "commandExecution",
          id: "cmd_1",
          command: "npm test",
          cwd: "/tmp",
          aggregatedOutput: "",
          exitCode: null,
          status: "running",
        },
      },
    });
    await tick();
    respond(mockProc, {
      method: "item/commandExecution/outputDelta",
      params: {
        threadId: "thr_ordering",
        turnId: "turn_ordering",
        itemId: "cmd_1",
        delta: "tests passed",
      },
    });
    await tick();
    respond(mockProc, {
      method: "item/completed",
      params: {
        threadId: "thr_ordering",
        turnId: "turn_ordering",
        item: {
          type: "commandExecution",
          id: "cmd_1",
          command: "npm test",
          cwd: "/tmp",
          aggregatedOutput: "tests passed",
          exitCode: 0,
          status: "completed",
        },
      },
    });
    await tick();

    respond(mockProc, {
      method: "item/agentMessage/delta",
      params: {
        threadId: "thr_ordering",
        turnId: "turn_ordering",
        itemId: "msg_after_tool",
        delta: "After the tool.",
      },
    });
    await tick();

    respond(mockProc, {
      method: "turn/completed",
      params: {
        threadId: "thr_ordering",
        turn: { id: "turn_ordering", status: "completed", items: [], error: null },
      },
    });
    await tick(100);

    const frame = await waitForFrame(
      lastFrame,
      (current) =>
        current.includes("Before the tool.")
        && current.includes("$ npm test")
        && current.includes("After the tool."),
    );

    const beforeIndex = frame.indexOf("Before the tool.");
    const commandIndex = frame.indexOf("$ npm test");
    const afterIndex = frame.indexOf("After the tool.");

    expect(beforeIndex).toBeGreaterThanOrEqual(0);
    expect(commandIndex).toBeGreaterThan(beforeIndex);
    expect(afterIndex).toBeGreaterThan(commandIndex);

    unmount();
  });

  it("keeps reasoning transient and clears it after a completed turn", async () => {
    const { stdin, lastFrame, unmount, mockProc } = await setupApp();

    stdin.write("Use some reasoning");
    await tick();
    stdin.write("\r");
    await tick(100);

    respond(mockProc, { id: 1, result: { thread: { id: "thr_reasoning" } } });
    await tick();
    respond(mockProc, {
      id: 2,
      result: {
        turn: { id: "turn_reasoning", status: "inProgress", items: [], error: null },
      },
    });
    await tick();

    respond(mockProc, {
      method: "item/reasoning/textDelta",
      params: {
        threadId: "thr_reasoning",
        turnId: "turn_reasoning",
        itemId: "reasoning_1",
        delta: "Thinking through the answer",
      },
    });
    await tick();

    await waitForFrame(
      lastFrame,
      (current) =>
        current.includes("Reasoning")
        && current.includes("Thinking through the answer"),
    );

    respond(mockProc, {
      method: "item/agentMessage/delta",
      params: {
        threadId: "thr_reasoning",
        turnId: "turn_reasoning",
        itemId: "msg_reasoning_done",
        delta: "Here is the final answer.",
      },
    });
    await tick();
    respond(mockProc, {
      method: "turn/completed",
      params: {
        threadId: "thr_reasoning",
        turn: { id: "turn_reasoning", status: "completed", items: [], error: null },
      },
    });
    await tick(100);

    const frame = await waitForFrame(
      lastFrame,
      (current) =>
        current.includes("Here is the final answer.")
        && !current.includes("Thinking through the answer"),
    );

    expect(frame).not.toContain("Reasoning");

    unmount();
  });

  it("finalizes interrupted turns into a retryable idle shell without lingering reasoning", async () => {
    const { stdin, lastFrame, unmount, mockProc } = await setupApp();

    stdin.write("Interrupt this turn");
    await tick();
    stdin.write("\r");
    await tick(100);

    respond(mockProc, { id: 1, result: { thread: { id: "thr_interrupted" } } });
    await tick();
    respond(mockProc, {
      id: 2,
      result: {
        turn: { id: "turn_interrupted", status: "inProgress", items: [], error: null },
      },
    });
    await tick();

    respond(mockProc, {
      method: "item/reasoning/textDelta",
      params: {
        threadId: "thr_interrupted",
        turnId: "turn_interrupted",
        itemId: "reasoning_interrupt",
        delta: "Inspecting the workspace",
      },
    });
    await tick();
    respond(mockProc, {
      method: "item/agentMessage/delta",
      params: {
        threadId: "thr_interrupted",
        turnId: "turn_interrupted",
        itemId: "msg_interrupt",
        delta: "Started running checks.",
      },
    });
    await tick();
    respond(mockProc, {
      method: "item/started",
      params: {
        threadId: "thr_interrupted",
        turnId: "turn_interrupted",
        item: {
          type: "commandExecution",
          id: "cmd_interrupt",
          command: "npm run check",
          cwd: "/tmp",
          aggregatedOutput: "",
          exitCode: null,
          status: "running",
        },
      },
    });
    await tick();
    respond(mockProc, {
      method: "item/commandExecution/outputDelta",
      params: {
        threadId: "thr_interrupted",
        turnId: "turn_interrupted",
        itemId: "cmd_interrupt",
        delta: "checking...",
      },
    });
    await tick();

    respond(mockProc, {
      method: "turn/completed",
      params: {
        threadId: "thr_interrupted",
        turn: { id: "turn_interrupted", status: "interrupted", items: [], error: null },
      },
    });
    await tick(100);

    const interruptedFrame = await waitForFrame(
      lastFrame,
      (current) =>
        current.includes("Started running checks.")
        && current.includes("$ npm run check")
        && !current.includes("Inspecting the workspace")
        && !current.includes("Waiting for response..."),
    );

    expect(interruptedFrame).toContain("interrupted");

    stdin.write("Retry after interrupt");
    await tick();
    await waitForFrame(lastFrame, (current) => current.includes("Retry after interrupt"));

    unmount();
  });

  it("preserves already-seen output when a turn fails and ends with a visible error", async () => {
    const { stdin, lastFrame, unmount, mockProc } = await setupApp();

    stdin.write("Create the issue");
    await tick();
    stdin.write("\r");
    await tick(100);

    respond(mockProc, { id: 1, result: { thread: { id: "thr_failed_output" } } });
    await tick();
    respond(mockProc, {
      id: 2,
      result: {
        turn: { id: "turn_failed_output", status: "inProgress", items: [], error: null },
      },
    });
    await tick();

    respond(mockProc, {
      method: "item/reasoning/textDelta",
      params: {
        threadId: "thr_failed_output",
        turnId: "turn_failed_output",
        itemId: "reasoning_failed",
        delta: "Preparing the request",
      },
    });
    await tick();
    respond(mockProc, {
      method: "item/agentMessage/delta",
      params: {
        threadId: "thr_failed_output",
        turnId: "turn_failed_output",
        itemId: "msg_failed",
        delta: "Attempting issue creation.",
      },
    });
    await tick();
    respond(mockProc, {
      method: "item/started",
      params: {
        threadId: "thr_failed_output",
        turnId: "turn_failed_output",
        item: {
          type: "commandExecution",
          id: "cmd_failed",
          command: "curl -X POST /api/issues",
          cwd: "/tmp",
          aggregatedOutput: "",
          exitCode: null,
          status: "running",
        },
      },
    });
    await tick();
    respond(mockProc, {
      method: "item/commandExecution/outputDelta",
      params: {
        threadId: "thr_failed_output",
        turnId: "turn_failed_output",
        itemId: "cmd_failed",
        delta: "HTTP 500",
      },
    });
    await tick();

    respond(mockProc, {
      method: "turn/completed",
      params: {
        threadId: "thr_failed_output",
        turn: {
          id: "turn_failed_output",
          status: "failed",
          items: [],
          error: {
            message: "Issue creation failed",
            additionalDetails: "POST /api/issues returned HTTP 500",
          },
        },
      },
    });
    await tick(100);

    const frame = await waitForFrame(
      lastFrame,
      (current) =>
        current.includes("Attempting issue creation.")
        && current.includes("$ curl -X POST /api/issues")
        && current.includes("HTTP 500")
        && current.includes("Error: Issue creation failed")
        && !current.includes("Preparing the request"),
    );

    expect(frame).not.toContain("Waiting for response...");

    unmount();
  });
});
