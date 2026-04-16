import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "ink-testing-library";
import type { InputBarProps } from "../components/InputBar.js";

let latestInputBarProps: InputBarProps | null = null;

let mockedUseCodexReturn: {
  connectionState: "disconnected" | "connected" | "thinking";
  isConnected: boolean;
  isThinking: boolean;
  lastError: string | null;
  threadId: string | null;
  sendMessage: (
    text: string,
    baseInstructions?: string,
    modelReasoningEffort?: string,
    serviceTier?: string,
    model?: string,
  ) => Promise<void>;
  interruptTurn: () => Promise<void>;
};

vi.mock("../components/InputBar.js", () => ({
  InputBar: (props: InputBarProps) => {
    latestInputBarProps = props;
    return React.createElement(
      "ink-text",
      null,
      props.disabled ? "MOCK_INPUT_DISABLED" : `MOCK_INPUT:${props.value ?? ""}`,
    );
  },
}));

vi.mock("../hooks/useCodex.js", () => ({
  useCodex: () => mockedUseCodexReturn,
}));

import { App } from "../components/App.js";

const tick = (ms = 50) => new Promise((resolve) => setTimeout(resolve, ms));

function createStatusFetch() {
  return vi.fn().mockImplementation(async (input: string | URL | Request) => {
    const url = String(input);

    if (url.endsWith("/api/companies")) {
      return {
        ok: true,
        json: async () => [
          {
            id: "company-1",
            name: "Retry Co",
            updatedAt: "2026-04-16T00:00:00.000Z",
          },
        ],
      };
    }

    if (url.includes("/approvals?status=pending")) {
      return {
        ok: true,
        json: async () => [],
      };
    }

    if (url.includes("/issues?status=")) {
      return {
        ok: true,
        json: async () => [],
      };
    }

    return {
      ok: true,
      json: async () => ({
        agents: [],
        totalActiveRuns: 0,
        totalQueuedIntents: 0,
        totalActiveLeases: 0,
        activeRuns: [],
        recentRuns: [],
      }),
    };
  });
}

function countOccurrences(frame: string, value: string): number {
  return frame.split(value).length - 1;
}

beforeEach(() => {
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  latestInputBarProps = null;
  mockedUseCodexReturn = {
    connectionState: "connected",
    isConnected: true,
    isThinking: false,
    lastError: null,
    threadId: "thr_send_guard",
    sendMessage: vi.fn().mockResolvedValue(undefined),
    interruptTurn: vi.fn().mockResolvedValue(undefined),
  };
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("message send guards", () => {
  it("ignores whitespace-only submits before they reach Codex or the transcript", async () => {
    const fetchFn = createStatusFetch();
    const { lastFrame, unmount } = render(
      <App
        url="http://localhost:3100"
        apiKey="test-key"
        companyId="company-1"
        companyName="Retry Co"
        fetchFn={fetchFn}
        pollInterval={60000}
        enableCodex={true}
      />,
    );

    await tick();

    latestInputBarProps?.onSubmit?.("   ");
    await tick(100);

    expect(mockedUseCodexReturn.sendMessage).not.toHaveBeenCalled();
    expect(lastFrame()).toContain("No messages yet");
    unmount();
  });

  it("drops duplicate submits while a send is already pending", async () => {
    const fetchFn = createStatusFetch();
    mockedUseCodexReturn = {
      ...mockedUseCodexReturn,
      sendMessage: vi.fn().mockImplementation(
        () => new Promise<void>(() => {}),
      ),
    };

    const { lastFrame, unmount } = render(
      <App
        url="http://localhost:3100"
        apiKey="test-key"
        companyId="company-1"
        companyName="Retry Co"
        fetchFn={fetchFn}
        pollInterval={60000}
        enableCodex={true}
      />,
    );

    await tick();

    latestInputBarProps?.onSubmit?.("  Ship the fix  ");
    latestInputBarProps?.onSubmit?.("  Ship the fix  ");
    await tick(100);

    expect(mockedUseCodexReturn.sendMessage).toHaveBeenCalledTimes(1);
    expect(mockedUseCodexReturn.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining("Ship the fix"),
      expect.any(String),
      expect.any(String),
      expect.anything(),
      expect.any(String),
    );
    const frame = lastFrame() ?? "";
    expect(countOccurrences(frame, "Ship the fix")).toBe(1);
    unmount();
  });

  it("accepts an immediate retry after a send failure clears the pending state", async () => {
    const fetchFn = createStatusFetch();
    const sendMessage = vi
      .fn()
      .mockRejectedValueOnce(new Error("Immediate send failure"))
      .mockResolvedValueOnce(undefined);
    mockedUseCodexReturn = {
      ...mockedUseCodexReturn,
      sendMessage,
    };

    const { lastFrame, unmount } = render(
      <App
        url="http://localhost:3100"
        apiKey="test-key"
        companyId="company-1"
        companyName="Retry Co"
        fetchFn={fetchFn}
        pollInterval={60000}
        enableCodex={true}
      />,
    );

    await tick();

    latestInputBarProps?.onSubmit?.("First attempt");
    await tick(100);

    expect(lastFrame()).toContain("Error: Immediate send failure");

    latestInputBarProps?.onSubmit?.("Retry attempt");
    await tick(100);

    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(sendMessage.mock.calls[1]?.[0]).toContain("Retry attempt");
    unmount();
  });
});
