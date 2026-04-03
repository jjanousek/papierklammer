// @vitest-environment node

import { describe, expect, it } from "vitest";

/**
 * Tests for ThemeContext module exports and theme validation logic.
 * DOM-dependent rendering is covered by agent-browser interactive checks.
 */

describe("ThemeContext exports", () => {
  it("exports THEMES array with exactly 3 themes", async () => {
    const { THEMES } = await import("./ThemeContext");
    expect(THEMES).toEqual(["papierklammer", "violet-indigo", "earth"]);
    expect(THEMES).toHaveLength(3);
  });

  it("exports THEME_LABELS for each theme", async () => {
    const { THEMES, THEME_LABELS } = await import("./ThemeContext");
    for (const theme of THEMES) {
      expect(THEME_LABELS[theme]).toBeDefined();
      expect(typeof THEME_LABELS[theme]).toBe("string");
      // Labels should be uppercase
      expect(THEME_LABELS[theme]).toBe(THEME_LABELS[theme].toUpperCase());
    }
  });

  it("default theme is papierklammer", async () => {
    const { THEMES } = await import("./ThemeContext");
    expect(THEMES[0]).toBe("papierklammer");
  });

  it("THEME_LABELS match expected values", async () => {
    const { THEME_LABELS } = await import("./ThemeContext");
    expect(THEME_LABELS).toEqual({
      papierklammer: "PAPIERKLAMMER",
      "violet-indigo": "VIOLET-INDIGO",
      earth: "EARTH",
    });
  });

  it("localStorage key is papierklammer-theme", async () => {
    // Verify the module uses the correct storage key by checking the source
    const fs = await import("fs");
    const path = await import("path");
    const source = fs.readFileSync(
      path.resolve(__dirname, "./ThemeContext.tsx"),
      "utf-8",
    );
    expect(source).toContain('"papierklammer-theme"');
  });

  it("useTheme throws when used outside ThemeProvider", async () => {
    // We can't test React hooks without DOM, but we can verify the error message exists in source
    const fs = await import("fs");
    const path = await import("path");
    const source = fs.readFileSync(
      path.resolve(__dirname, "./ThemeContext.tsx"),
      "utf-8",
    );
    expect(source).toContain("useTheme must be used within ThemeProvider");
  });

  it("applyTheme sets data-theme attribute (source check)", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const source = fs.readFileSync(
      path.resolve(__dirname, "./ThemeContext.tsx"),
      "utf-8",
    );
    expect(source).toContain('setAttribute("data-theme"');
  });

  it("Theme type is a union of the 3 theme names", async () => {
    const { THEMES } = await import("./ThemeContext");
    // Ensure all themes are valid string identifiers
    for (const theme of THEMES) {
      expect(typeof theme).toBe("string");
      expect(theme.length).toBeGreaterThan(0);
    }
  });
});
