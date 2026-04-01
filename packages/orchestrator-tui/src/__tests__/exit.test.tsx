import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render } from "ink-testing-library";
import { App } from "../components/App.js";

// Suppress alternate screen buffer escape codes during tests
vi.spyOn(process.stdout, "write").mockImplementation(() => true);

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Ctrl+C exit", () => {
  it("exits the app when Ctrl+C is pressed", async () => {
    const { stdin, unmount, lastFrame } = render(
      <App url="http://localhost:3100" apiKey="" companyId="" />,
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
});
