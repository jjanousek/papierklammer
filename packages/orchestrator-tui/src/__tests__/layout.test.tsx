import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render } from "ink-testing-library";
import { App } from "../components/App.js";

// Suppress alternate screen buffer escape codes during tests
vi.spyOn(process.stdout, "write").mockImplementation(() => true);

afterEach(() => {
  vi.restoreAllMocks();
});

describe("App layout", () => {
  it("renders the HeaderBar with Papierklammer title", () => {
    const { lastFrame, unmount } = render(
      <App url="http://localhost:3100" apiKey="" companyId="" />,
    );
    const frame = lastFrame();
    expect(frame).toContain("Papierklammer");
    unmount();
  });

  it("renders the AgentSidebar with Agents text", () => {
    const { lastFrame, unmount } = render(
      <App url="http://localhost:3100" apiKey="" companyId="" />,
    );
    const frame = lastFrame();
    expect(frame).toContain("Agents");
    unmount();
  });

  it("renders the ChatPanel with Chat text", () => {
    const { lastFrame, unmount } = render(
      <App url="http://localhost:3100" apiKey="" companyId="" />,
    );
    const frame = lastFrame();
    expect(frame).toContain("Chat");
    unmount();
  });

  it("renders the InputBar with placeholder text", () => {
    const { lastFrame, unmount } = render(
      <App url="http://localhost:3100" apiKey="" companyId="" />,
    );
    const frame = lastFrame();
    expect(frame).toContain("Type a message");
    unmount();
  });

  it("renders the StatusBar with Disconnected text", () => {
    const { lastFrame, unmount } = render(
      <App url="http://localhost:3100" apiKey="" companyId="" />,
    );
    const frame = lastFrame();
    expect(frame).toContain("Disconnected");
    unmount();
  });

  it("renders all 5 regions in one frame", () => {
    const { lastFrame, unmount } = render(
      <App url="http://localhost:3100" apiKey="" companyId="" />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain("Papierklammer");
    expect(frame).toContain("Agents");
    expect(frame).toContain("Chat");
    expect(frame).toContain("Type a message");
    expect(frame).toContain("Disconnected");
    unmount();
  });
});
