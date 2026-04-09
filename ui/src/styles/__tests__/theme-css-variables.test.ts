// @vitest-environment node

import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";

/**
 * Tests that index.css defines the correct theme CSS variable blocks
 * for all 3 themes (papierklammer, violet-indigo, earth) with all
 * 14 design-system variables and shadcn bridge mappings.
 */

const cssContent = readFileSync(
  resolve(__dirname, "../../index.css"),
  "utf-8",
);

/** Extract a CSS block by its selector (handles multi-selector rules like `:root,\n[data-theme="papierklammer"]`) */
function extractBlock(selector: string): string {
  // Escape special regex chars in selector
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Match the selector possibly preceded by other selectors (comma-separated)
  // and capture the block content
  const regex = new RegExp(
    `(?:^|[},])\\s*(?:[^{}]*,\\s*)?${escaped}\\s*\\{([^}]+(?:\\{[^}]*\\}[^}]*)*)\\}`,
    "m",
  );
  const match = cssContent.match(regex);
  if (!match) {
    // Try simpler approach: find the selector and grab until matching brace
    const idx = cssContent.indexOf(selector);
    if (idx === -1) return "";
    const braceStart = cssContent.indexOf("{", idx);
    if (braceStart === -1) return "";
    let depth = 0;
    let braceEnd = braceStart;
    for (let i = braceStart; i < cssContent.length; i++) {
      if (cssContent[i] === "{") depth++;
      if (cssContent[i] === "}") depth--;
      if (depth === 0) {
        braceEnd = i;
        break;
      }
    }
    return cssContent.slice(braceStart + 1, braceEnd);
  }
  return match[1];
}

/** Extract a CSS variable value from a block string */
function getVar(block: string, varName: string): string | null {
  // Match --varName: value; (with possible multi-line)
  const escaped = varName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`${escaped}:\\s*([^;]+);`);
  const match = block.match(regex);
  return match ? match[1].trim() : null;
}

const DESIGN_SYSTEM_VARS = [
  "--bg",
  "--bg-dark",
  "--bg-darker",
  "--bg-deep",
  "--bg-light",
  "--bg-lighter",
  "--fg",
  "--fg-muted",
  "--fg-dim",
  "--border",
  "--border-strong",
  "--alive",
  "--warn",
  "--dead",
] as const;

const SHADCN_BRIDGE_VARS = [
  "--background",
  "--foreground",
  "--card",
  "--card-foreground",
  "--popover",
  "--popover-foreground",
  "--primary",
  "--primary-foreground",
  "--secondary",
  "--secondary-foreground",
  "--muted",
  "--muted-foreground",
  "--accent",
  "--accent-foreground",
  "--destructive",
  "--destructive-foreground",
  "--input",
  "--ring",
  "--sidebar",
  "--sidebar-foreground",
  "--sidebar-primary",
  "--sidebar-primary-foreground",
  "--sidebar-accent",
  "--sidebar-accent-foreground",
  "--sidebar-border",
  "--sidebar-ring",
] as const;

describe("Theme CSS variables", () => {
  describe("[data-theme='papierklammer'] (default rose theme)", () => {
    const block = extractBlock('[data-theme="papierklammer"]');

    it("defines all 14 design system variables", () => {
      for (const varName of DESIGN_SYSTEM_VARS) {
        expect(getVar(block, varName)).not.toBeNull();
      }
    });

    it("has correct rose background values", () => {
      expect(getVar(block, "--bg")).toBe("#C4878E");
      expect(getVar(block, "--bg-dark")).toBe("#B07078");
      expect(getVar(block, "--bg-darker")).toBe("#8E5A64");
      expect(getVar(block, "--bg-deep")).toBe("#6B3F48");
      expect(getVar(block, "--bg-light")).toBe("#D4A0A6");
      expect(getVar(block, "--bg-lighter")).toBe("#E2BCC0");
    });

    it("has white foreground", () => {
      expect(getVar(block, "--fg")).toBe("#FFFFFF");
    });

    it("has correct semantic status colors", () => {
      expect(getVar(block, "--alive")).toBe("#78C498");
      expect(getVar(block, "--warn")).toBe("#C8A85A");
      expect(getVar(block, "--dead")).toBe("#D47272");
    });

    it("maps all shadcn bridge variables", () => {
      for (const varName of SHADCN_BRIDGE_VARS) {
        expect(getVar(block, varName)).not.toBeNull();
      }
    });

    it("shadcn --background maps to var(--bg)", () => {
      expect(getVar(block, "--background")).toBe("var(--bg)");
    });

    it("shadcn --foreground maps to var(--fg)", () => {
      expect(getVar(block, "--foreground")).toBe("var(--fg)");
    });

    it("shadcn --destructive maps to var(--dead)", () => {
      expect(getVar(block, "--destructive")).toBe("var(--dead)");
    });
  });

  describe("[data-theme='violet-indigo']", () => {
    const block = extractBlock('[data-theme="violet-indigo"]');

    it("defines all 14 design system variables", () => {
      for (const varName of DESIGN_SYSTEM_VARS) {
        expect(getVar(block, varName)).not.toBeNull();
      }
    });

    it("has correct violet-indigo background values", () => {
      expect(getVar(block, "--bg")).toBe("#3A28B0");
      expect(getVar(block, "--bg-dark")).toBe("#2C1E8A");
      expect(getVar(block, "--bg-darker")).toBe("#1F1566");
      expect(getVar(block, "--bg-deep")).toBe("#150E45");
      expect(getVar(block, "--bg-light")).toBe("#5040C8");
      expect(getVar(block, "--bg-lighter")).toBe("#6A5CD8");
    });

    it("has white foreground", () => {
      expect(getVar(block, "--fg")).toBe("#FFFFFF");
    });

    it("has correct fg-muted with 0.70 opacity", () => {
      expect(getVar(block, "--fg-muted")).toBe("rgba(255, 255, 255, 0.70)");
    });

    it("has correct border with 0.16 opacity", () => {
      expect(getVar(block, "--border")).toBe("rgba(255, 255, 255, 0.16)");
    });

    it("has correct border-strong with 0.30 opacity", () => {
      expect(getVar(block, "--border-strong")).toBe(
        "rgba(255, 255, 255, 0.30)",
      );
    });

    it("has correct semantic status colors", () => {
      expect(getVar(block, "--alive")).toBe("#5AE87A");
      expect(getVar(block, "--warn")).toBe("#E8D560");
      expect(getVar(block, "--dead")).toBe("#FF5555");
    });

    it("maps all shadcn bridge variables", () => {
      for (const varName of SHADCN_BRIDGE_VARS) {
        expect(getVar(block, varName)).not.toBeNull();
      }
    });

    it("shadcn --background maps to var(--bg)", () => {
      expect(getVar(block, "--background")).toBe("var(--bg)");
    });

    it("shadcn --foreground maps to var(--fg)", () => {
      expect(getVar(block, "--foreground")).toBe("var(--fg)");
    });

    it("shadcn --destructive maps to var(--dead)", () => {
      expect(getVar(block, "--destructive")).toBe("var(--dead)");
    });
  });

  describe("[data-theme='earth']", () => {
    const block = extractBlock('[data-theme="earth"]');

    it("defines all 14 design system variables", () => {
      for (const varName of DESIGN_SYSTEM_VARS) {
        expect(getVar(block, varName)).not.toBeNull();
      }
    });

    it("has correct earth background values", () => {
      expect(getVar(block, "--bg")).toBe("#2D1610");
      expect(getVar(block, "--bg-dark")).toBe("#231210");
      expect(getVar(block, "--bg-darker")).toBe("#1A0D0A");
      expect(getVar(block, "--bg-deep")).toBe("#120806");
      expect(getVar(block, "--bg-light")).toBe("#4A3428");
      expect(getVar(block, "--bg-lighter")).toBe("#5E4438");
    });

    it("has bone ivory foreground (#E8E0D0), not white", () => {
      expect(getVar(block, "--fg")).toBe("#E8E0D0");
    });

    it("has correct fg-muted with ivory base", () => {
      expect(getVar(block, "--fg-muted")).toBe("rgba(232, 224, 208, 0.68)");
    });

    it("has correct fg-dim with ivory base", () => {
      expect(getVar(block, "--fg-dim")).toBe("rgba(232, 224, 208, 0.40)");
    });

    it("has correct border with ivory base and 0.14 opacity", () => {
      expect(getVar(block, "--border")).toBe("rgba(232, 224, 208, 0.14)");
    });

    it("has correct border-strong with ivory base and 0.26 opacity", () => {
      expect(getVar(block, "--border-strong")).toBe(
        "rgba(232, 224, 208, 0.26)",
      );
    });

    it("has correct earthy semantic status colors", () => {
      expect(getVar(block, "--alive")).toBe("#6B7450");
      expect(getVar(block, "--warn")).toBe("#8B7435");
      expect(getVar(block, "--dead")).toBe("#B5634B");
    });

    it("maps all shadcn bridge variables", () => {
      for (const varName of SHADCN_BRIDGE_VARS) {
        expect(getVar(block, varName)).not.toBeNull();
      }
    });

    it("shadcn --background maps to var(--bg)", () => {
      expect(getVar(block, "--background")).toBe("var(--bg)");
    });

    it("shadcn --foreground maps to var(--fg)", () => {
      expect(getVar(block, "--foreground")).toBe("var(--fg)");
    });

    it("shadcn --destructive maps to var(--dead)", () => {
      expect(getVar(block, "--destructive")).toBe("var(--dead)");
    });
  });

  describe("Scrollbar theme-awareness", () => {
    it("scrollbar track uses var(--bg-dark)", () => {
      expect(cssContent).toContain(
        "*::-webkit-scrollbar-track {\n  background: var(--bg-dark);",
      );
    });

    it("scrollbar thumb uses var(--border-strong)", () => {
      expect(cssContent).toContain(
        "*::-webkit-scrollbar-thumb {\n  background: var(--border-strong);",
      );
    });

    it("scrollbar thumb hover uses var(--fg-dim)", () => {
      expect(cssContent).toContain(
        "*::-webkit-scrollbar-thumb:hover {\n  background: var(--fg-dim);",
      );
    });

    it("no hardcoded rgba(255,255,255) in scrollbar section", () => {
      // Find scrollbar section
      const scrollbarStart = cssContent.indexOf("/* Scrollbars");
      const scrollbarEnd = cssContent.indexOf(
        "/* Expandable dialog",
        scrollbarStart,
      );
      const scrollbarSection = cssContent.slice(scrollbarStart, scrollbarEnd);
      expect(scrollbarSection).not.toContain("rgba(255, 255, 255");
    });
  });

  describe(":root defaults", () => {
    it(":root includes [data-theme='papierklammer'] in same rule", () => {
      // Verify :root and [data-theme="papierklammer"] share the same rule
      const rootLine = cssContent.indexOf(":root,");
      const themeLine = cssContent.indexOf(
        '[data-theme="papierklammer"]',
        rootLine,
      );
      // They should be within a few lines of each other
      expect(rootLine).toBeGreaterThan(-1);
      expect(themeLine).toBeGreaterThan(-1);
      expect(themeLine - rootLine).toBeLessThan(50);
    });
  });
});
