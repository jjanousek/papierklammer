// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { StatusIcon } from "../StatusIcon";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("StatusIcon", () => {
  it("renders a square indicator (no rounded-full)", () => {
    act(() => {
      root.render(<StatusIcon status="done" />);
    });
    const indicator = container.querySelector("[data-testid='status-indicator']") as HTMLElement;
    expect(indicator).toBeTruthy();
    // Must be a square: 6x6
    expect(indicator.style.width).toBe("6px");
    expect(indicator.style.height).toBe("6px");
    // Must NOT have rounded-full class
    expect(indicator.className).not.toContain("rounded-full");
    // Must NOT be an SVG or img
    expect(indicator.tagName.toLowerCase()).toBe("span");
    expect(indicator.querySelector("svg")).toBeNull();
    expect(indicator.querySelector("img")).toBeNull();
  });

  it("renders alive color for done status", () => {
    act(() => {
      root.render(<StatusIcon status="done" />);
    });
    const indicator = container.querySelector("[data-testid='status-indicator']") as HTMLElement;
    expect(indicator.style.backgroundColor).toBe("var(--alive)");
  });

  it("renders dead color for blocked status", () => {
    act(() => {
      root.render(<StatusIcon status="blocked" />);
    });
    const indicator = container.querySelector("[data-testid='status-indicator']") as HTMLElement;
    expect(indicator.style.backgroundColor).toBe("var(--dead)");
  });

  it("renders warn color for in_progress status", () => {
    act(() => {
      root.render(<StatusIcon status="in_progress" />);
    });
    const indicator = container.querySelector("[data-testid='status-indicator']") as HTMLElement;
    expect(indicator.style.backgroundColor).toBe("var(--warn)");
  });

  it("renders transparent with border for backlog status (idle)", () => {
    act(() => {
      root.render(<StatusIcon status="backlog" />);
    });
    const indicator = container.querySelector("[data-testid='status-indicator']") as HTMLElement;
    expect(indicator.style.backgroundColor).toBe("transparent");
    expect(indicator.style.border).toBe("1px solid var(--fg-muted)");
  });

  it("renders label when showLabel is true", () => {
    act(() => {
      root.render(<StatusIcon status="in_progress" showLabel />);
    });
    const text = container.textContent;
    expect(text).toContain("In Progress");
  });

  it("does not contain any SVG icons or emoji for status", () => {
    const statuses = ["backlog", "todo", "in_progress", "in_review", "done", "cancelled", "blocked"];
    for (const status of statuses) {
      act(() => {
        root.render(<StatusIcon status={status} />);
      });
      const indicator = container.querySelector("[data-testid='status-indicator']") as HTMLElement;
      expect(indicator.querySelector("svg")).toBeNull();
      expect(indicator.querySelector("img")).toBeNull();
      // Should be a span element only
      expect(indicator.tagName.toLowerCase()).toBe("span");
    }
  });
});
