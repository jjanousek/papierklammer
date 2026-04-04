import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "ink-testing-library";

let mockedUseCodexReturn: {
  connectionState: "disconnected" | "connected" | "thinking";
  isConnected: boolean;
  isThinking: boolean;
  lastError: string | null;
  threadId: string | null;
  sendMessage: (text: string) => Promise<void>;
  interruptTurn: () => Promise<void>;
};

vi.mock("../hooks/useCodex.js", () => ({
  useCodex: () => mockedUseCodexReturn,
}));

import { App } from "../components/App.js";

const tick = (ms = 50) => new Promise((resolve) => setTimeout(resolve, ms));

function createStatusFetch() {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      agents: [],
      totalActiveRuns: 0,
      totalQueuedIntents: 0,
      totalActiveLeases: 0,
      activeRuns: [],
      recentRuns: [],
    }),
  });
}

beforeEach(() => {
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  mockedUseCodexReturn = {
    connectionState: "connected",
    isConnected: true,
    isThinking: false,
    lastError: null,
    threadId: "thr_recovery_test",
    sendMessage: vi.fn().mockResolvedValue(undefined),
    interruptTurn: vi.fn().mockResolvedValue(undefined),
  };
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("failed-send recovery", () => {
  it("clears the pending thinking state even when sendMessage rejects before Codex reports an error", async () => {
    mockedUseCodexReturn = {
      ...mockedUseCodexReturn,
      sendMessage: vi
        .fn<(_: string) => Promise<void>>()
        .mockRejectedValue(new Error("Immediate send failure")),
    };

    const { stdin, lastFrame, unmount } = render(
      <App
        url="http://localhost:3100"
        apiKey="test-key"
        companyId="company-1"
        companyName="Recovery Co"
        fetchFn={createStatusFetch()}
        pollInterval={60000}
        enableCodex={true}
      />,
    );

    await tick();

    stdin.write("Retry the failed action");
    await tick();
    stdin.write("\r");
    await tick(100);

    const frame = lastFrame()!;
    expect(frame).toContain("Error: Immediate send failure");
    expect(frame).not.toContain("thinking...");
    expect(frame).not.toContain("Waiting for response...");
    expect(frame).toContain("Type a message...");

    unmount();
  });
});
