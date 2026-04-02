import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "ink-testing-library";
import { App } from "../components/App.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let stdoutWriteMock: any;

const mockFetch = vi.fn().mockResolvedValue({
  ok: true,
  json: async () => ({
    agents: [],
    totalActiveRuns: 0,
    totalQueuedIntents: 0,
    totalActiveLeases: 0,
  }),
});

beforeEach(() => {
  // Suppress alternate screen buffer escape codes during tests
  stdoutWriteMock = vi
    .spyOn(process.stdout, "write")
    .mockImplementation(() => true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Ctrl+C exit", () => {
  it("exits the app when Ctrl+C is pressed", async () => {
    const { stdin, unmount, lastFrame } = render(
      <App url="http://localhost:3100" apiKey="" companyId="" fetchFn={mockFetch} pollInterval={60000} />,
    );

    // Verify app is rendered
    expect(lastFrame()).toContain("Papierklammer");

    // Simulate Ctrl+C (ASCII code 3)
    stdin.write("\x03");

    // Wait for the app to process the input
    await new Promise((resolve) => setTimeout(resolve, 100));

    // After Ctrl+C the app should have processed the exit
    // The unmount call should work without error
    unmount();
  });

  it("restores terminal by disabling alternate screen buffer on exit", async () => {
    const { stdin, unmount } = render(
      <App url="http://localhost:3100" apiKey="" companyId="" fetchFn={mockFetch} pollInterval={60000} />,
    );

    // Simulate Ctrl+C to trigger exit and cleanup
    stdin.write("\x03");

    // Wait for the app to process the exit
    await new Promise((resolve) => setTimeout(resolve, 100));

    unmount();

    // Verify that process.stdout.write was called with the alternate screen
    // buffer disable sequence '\x1b[?1049l' (terminal restoration)
    const calls = stdoutWriteMock.mock.calls.map((call: unknown[]) => call[0]);
    expect(calls).toContain("\x1b[?1049l");
  });
});
