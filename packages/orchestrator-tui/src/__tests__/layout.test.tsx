import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render } from "ink-testing-library";
import { App } from "../components/App.js";
import { ErrorBoundary } from "../components/ErrorBoundary.js";

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
  it("renders a company picker sorted by recency when no company is preselected", async () => {
    const pickerFetch = vi.fn().mockImplementation(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/api/companies")) {
        return {
          ok: true,
          json: async () => ([
            { id: "older", name: "Older Co", updatedAt: "2026-03-01T00:00:00.000Z" },
            { id: "newer", name: "Newer Co", updatedAt: "2026-04-01T00:00:00.000Z" },
          ]),
        };
      }

      return {
        ok: true,
        json: async () => ({
          agents: [],
          totalActiveRuns: 0,
          totalQueuedIntents: 0,
          totalActiveLeases: 0,
        }),
      };
    });

    const { lastFrame, unmount } = render(
      <App url="http://localhost:3100" apiKey="" companyId="" fetchFn={pickerFetch} pollInterval={60000} />,
    );

    await new Promise((resolve) => setTimeout(resolve, 50));

    const frame = lastFrame()!;
    expect(frame).toContain("Select a company");
    expect(frame.indexOf("Newer Co")).toBeLessThan(frame.indexOf("Older Co"));
    unmount();
  });

  it("renders the HeaderBar with Papierklammer title", () => {
    const { lastFrame, unmount } = render(
      <App url="http://localhost:3100" apiKey="" companyId="test-company" fetchFn={mockFetch} pollInterval={60000} />,
    );
    const frame = lastFrame();
    expect(frame).toContain("Papierklammer");
    unmount();
  });

  it("shows the loaded company label in the header for a preselected company", () => {
    const { lastFrame, unmount } = render(
      <App
        url="http://localhost:3100"
        apiKey=""
        companyId="test-company"
        companyName="Audit Co"
        fetchFn={mockFetch}
        pollInterval={60000}
      />,
    );
    const frame = lastFrame();
    expect(frame).toContain("Papierklammer · Audit Co");
    unmount();
  });

  it("renders the AgentSidebar with Agents text", () => {
    const { lastFrame, unmount } = render(
      <App url="http://localhost:3100" apiKey="" companyId="test-company" fetchFn={mockFetch} pollInterval={60000} />,
    );
    const frame = lastFrame();
    expect(frame).toContain("Agents");
    unmount();
  });

  it("renders the ChatPanel with Chat text", () => {
    const { lastFrame, unmount } = render(
      <App url="http://localhost:3100" apiKey="" companyId="test-company" fetchFn={mockFetch} pollInterval={60000} />,
    );
    const frame = lastFrame();
    expect(frame).toContain("Chat");
    unmount();
  });

  it("renders the InputBar with placeholder text", () => {
    const { lastFrame, unmount } = render(
      <App url="http://localhost:3100" apiKey="" companyId="test-company" fetchFn={mockFetch} pollInterval={60000} />,
    );
    const frame = lastFrame();
    expect(frame).toContain("Type a message");
    unmount();
  });

  it("renders the StatusBar", () => {
    const { lastFrame, unmount } = render(
      <App url="http://localhost:3100" apiKey="" companyId="test-company" fetchFn={mockFetch} pollInterval={60000} />,
    );
    const frame = lastFrame();
    expect(frame).toContain("Codex: disconnected");
    unmount();
  });

  it("renders all 5 regions in one frame", () => {
    const { lastFrame, unmount } = render(
      <App url="http://localhost:3100" apiKey="" companyId="test-company" fetchFn={mockFetch} pollInterval={60000} />,
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

describe("ErrorBoundary (VAL-TUI-CORE-005)", () => {
  function ThrowingComponent(): React.ReactElement {
    throw new Error("Test render explosion");
  }

  it("catches render errors and displays fallback message", () => {
    // Suppress console.error from React error boundary
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { lastFrame, unmount } = render(
      <ErrorBoundary>
        <ThrowingComponent />
      </ErrorBoundary>,
    );

    const frame = lastFrame()!;
    expect(frame).toContain("Something went wrong:");
    expect(frame).toContain("Test render explosion");
    unmount();

    consoleSpy.mockRestore();
  });

  it("renders children normally when no error occurs", () => {
    const { lastFrame, unmount } = render(
      <ErrorBoundary>
        <App url="http://localhost:3100" apiKey="" companyId="test-company" fetchFn={mockFetch} pollInterval={60000} />
      </ErrorBoundary>,
    );

    const frame = lastFrame()!;
    expect(frame).toContain("Papierklammer");
    expect(frame).not.toContain("Something went wrong");
    unmount();
  });
});
