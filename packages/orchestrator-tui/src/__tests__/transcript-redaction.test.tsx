import React from "react";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render } from "ink-testing-library";
import { EventEmitter, PassThrough } from "node:stream";
import { App } from "../components/App.js";
import { ChatPanel } from "../components/ChatPanel.js";
import type { ChatMessage } from "../hooks/useChat.js";
import type { AgentOverview } from "../hooks/useOrchestratorStatus.js";

beforeEach(() => {
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

const tick = (ms = 50) => new Promise((resolve) => setTimeout(resolve, ms));

const RAW_ENV_SECRET = "sk-live-super-secret-1234567890";
const RAW_BEARER_SECRET =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ0dWktcmVkYWN0aW9uIiwic2NvcGUiOiJkZWJ1ZyJ9.signaturepart";

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

function createMockFetch() {
  const agents: AgentOverview[] = [
    { agentId: "a1", name: "CEO", status: "idle", activeRunCount: 0, queuedIntentCount: 0 },
  ];

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
        agents,
        totalActiveRuns: 0,
        totalQueuedIntents: 0,
        totalActiveLeases: 0,
      }),
    };
  });
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

describe("transcript secret redaction", () => {
  it("redacts secret-like values in finalized transcript command blocks", () => {
    const messages: ChatMessage[] = [
      {
        role: "assistant",
        text: `Captured OPENAI_API_KEY=${RAW_ENV_SECRET}`,
        timestamp: new Date(),
        items: [
          {
            command: `env OPENAI_API_KEY=${RAW_ENV_SECRET} printenv OPENAI_API_KEY`,
            output: `OPENAI_API_KEY=${RAW_ENV_SECRET}\nAuthorization: Bearer ${RAW_BEARER_SECRET}`,
            status: "completed",
            exitCode: 0,
          },
        ],
      },
    ];

    const { lastFrame, unmount } = render(<ChatPanel messages={messages} />);

    const frame = lastFrame() ?? "";
    expect(frame).toContain("OPENAI_API_KEY=");
    expect(frame).toContain("Authorization: Bearer ");
    expect(frame).not.toContain(RAW_ENV_SECRET);
    expect(frame).not.toContain(RAW_BEARER_SECRET);
    expect(frame).toMatch(/redacted len=/i);

    unmount();
  });

  it("keeps live and finalized tool output redacted in the shipped app", async () => {
    const mockProc = createMockProcess();
    const mockSpawn = vi.fn().mockReturnValue(mockProc);
    const mockFetch = createMockFetch();

    const { stdin, lastFrame, unmount } = render(
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

    await tick();
    respond(mockProc, { id: 0, result: { userAgent: "codex/0.117.0" } });
    await tick();

    stdin.write("Inspect env");
    await tick();
    stdin.write("\r");
    await tick(100);

    respond(mockProc, { id: 1, result: { thread: { id: "thr_redact" } } });
    await tick();
    respond(mockProc, {
      id: 2,
      result: {
        turn: { id: "turn_redact", status: "inProgress", items: [], error: null },
      },
    });
    await tick();

    respond(mockProc, {
      method: "item/agentMessage/delta",
      params: {
        threadId: "thr_redact",
        turnId: "turn_redact",
        itemId: "msg_redact",
        delta: `Captured OPENAI_API_KEY=${RAW_ENV_SECRET}`,
      },
    });
    await tick();

    respond(mockProc, {
      method: "item/started",
      params: {
        threadId: "thr_redact",
        turnId: "turn_redact",
        item: {
          type: "commandExecution",
          id: "cmd_redact",
          command: `env OPENAI_API_KEY=${RAW_ENV_SECRET} printenv OPENAI_API_KEY`,
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
        threadId: "thr_redact",
        turnId: "turn_redact",
        itemId: "cmd_redact",
        delta: `OPENAI_API_KEY=${RAW_ENV_SECRET}\nAuthorization: Bearer ${RAW_BEARER_SECRET}`,
      },
    });
    await tick();

    const liveFrame = await waitForFrame(
      lastFrame,
      (frame) => frame.includes("OPENAI_API_KEY=") && frame.includes("Authorization: Bearer "),
    );

    expect(liveFrame).not.toContain(RAW_ENV_SECRET);
    expect(liveFrame).not.toContain(RAW_BEARER_SECRET);
    expect(liveFrame).toMatch(/redacted len=/i);

    respond(mockProc, {
      method: "item/completed",
      params: {
        threadId: "thr_redact",
        turnId: "turn_redact",
        item: {
          type: "commandExecution",
          id: "cmd_redact",
          command: `env OPENAI_API_KEY=${RAW_ENV_SECRET} printenv OPENAI_API_KEY`,
          cwd: "/tmp",
          aggregatedOutput: `OPENAI_API_KEY=${RAW_ENV_SECRET}\nAuthorization: Bearer ${RAW_BEARER_SECRET}`,
          exitCode: 0,
          status: "completed",
        },
      },
    });
    await tick();

    respond(mockProc, {
      method: "turn/completed",
      params: {
        threadId: "thr_redact",
        turn: { id: "turn_redact", status: "completed", items: [], error: null },
      },
    });
    await tick(100);

    const finalizedFrame = await waitForFrame(
      lastFrame,
      (frame) =>
        frame.includes("OPENAI_API_KEY=")
        && frame.includes("Authorization: Bearer ")
        && frame.includes("completed"),
    );

    expect(finalizedFrame).not.toContain(RAW_ENV_SECRET);
    expect(finalizedFrame).not.toContain(RAW_BEARER_SECRET);
    expect(finalizedFrame).toMatch(/redacted len=/i);

    unmount();
  });
});
