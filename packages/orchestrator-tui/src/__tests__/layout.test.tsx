import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render } from "ink-testing-library";
import { App } from "../components/App.js";

// Suppress alternate screen buffer escape codes during tests
vi.spyOn(process.stdout, "write").mockImplementation(() => true);

// Provide a mock fetch that returns empty status so polling doesn't error
const mockFetch = vi.fn().mockResolvedValue({
  ok: true,
  json: async () => ({
    agents: [],
    totalActiveRuns: 0,
    totalQueuedIntents: 0,
    totalActiveLeases: 0,
  }),
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("App layout", () => {
  it("renders the HeaderBar with Papierklammer title", () => {
    const { lastFrame, unmount } = render(
      <App url="http://localhost:3100" apiKey="" companyId="" fetchFn={mockFetch} pollInterval={60000} />,
    );
    const frame = lastFrame();
    expect(frame).toContain("Papierklammer");
    unmount();
  });

  it("renders the AgentSidebar with Agents text", () => {
    const { lastFrame, unmount } = render(
      <App url="http://localhost:3100" apiKey="" companyId="" fetchFn={mockFetch} pollInterval={60000} />,
    );
    const frame = lastFrame();
    expect(frame).toContain("Agents");
    unmount();
  });

  it("renders the ChatPanel with Chat text", () => {
    const { lastFrame, unmount } = render(
      <App url="http://localhost:3100" apiKey="" companyId="" fetchFn={mockFetch} pollInterval={60000} />,
    );
    const frame = lastFrame();
    expect(frame).toContain("Chat");
    unmount();
  });

  it("renders the InputBar with placeholder text", () => {
    const { lastFrame, unmount } = render(
      <App url="http://localhost:3100" apiKey="" companyId="" fetchFn={mockFetch} pollInterval={60000} />,
    );
    const frame = lastFrame();
    expect(frame).toContain("Type a message");
    unmount();
  });

  it("renders the StatusBar", () => {
    const { lastFrame, unmount } = render(
      <App url="http://localhost:3100" apiKey="" companyId="" fetchFn={mockFetch} pollInterval={60000} />,
    );
    const frame = lastFrame();
    expect(frame).toContain("Codex: disconnected");
    unmount();
  });

  it("renders all 5 regions in one frame", () => {
    const { lastFrame, unmount } = render(
      <App url="http://localhost:3100" apiKey="" companyId="" fetchFn={mockFetch} pollInterval={60000} />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain("Papierklammer");
    expect(frame).toContain("Agents");
    expect(frame).toContain("Chat");
    expect(frame).toContain("Type a message");
    expect(frame).toContain("Codex:");
    unmount();
  });
});
