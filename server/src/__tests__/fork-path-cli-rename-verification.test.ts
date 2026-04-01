import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join, resolve } from "path";

const ROOT = resolve(__dirname, "../../..");

/**
 * Recursively collects files matching extensions, excluding
 * node_modules, dist, .git, .factory, patches directories.
 */
function collectFiles(
  dir: string,
  extensions: string[],
  results: string[] = [],
): string[] {
  for (const entry of readdirSync(dir)) {
    if (
      entry === "node_modules" ||
      entry === "dist" ||
      entry === ".git" ||
      entry === ".factory" ||
      entry === "patches"
    )
      continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      collectFiles(full, extensions, results);
    } else if (extensions.some((ext) => full.endsWith(ext))) {
      results.push(full);
    }
  }
  return results;
}

/**
 * Directories and file basenames to exclude from path-rename checks.
 * These are documentation, historical records, or reference files
 * where .paperclip or paperclipai branding is acceptable.
 */
const EXCLUDED_PATH_DIRS = [
  "CHANGELOG.md",
  "PAPIERKLAMMER_ARCHITECTURE_REPORT",
  "PAPIERKLAMMER_FORK_SPEC",
  "releases/",
  "pnpm-lock.yaml",
];

function shouldExcludeForPathCheck(filePath: string): boolean {
  const rel = filePath.replace(ROOT + "/", "");
  return EXCLUDED_PATH_DIRS.some((pattern) => rel.includes(pattern));
}

describe("fork-path-cli-rename-verification: filesystem paths and CLI branding", () => {
  describe("VAL-FORK-004: Filesystem paths use ~/.papierklammer/", () => {
    it("no ~/.paperclip/ path references in source code", () => {
      const sourceFiles = collectFiles(ROOT, [".ts", ".tsx", ".mjs", ".js"]);
      const violations: { file: string; line: string }[] = [];

      for (const f of sourceFiles) {
        if (shouldExcludeForPathCheck(f)) continue;
        if (f.includes("fork-path-cli-rename-verification")) continue;
        const content = readFileSync(f, "utf-8");
        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          // Match .paperclip/ or .paperclip" or .paperclip' as path references
          // but NOT .paperclip.yaml, .paperclip.yml (vendor sidecar filenames)
          if (
            line.includes(".paperclip/") ||
            line.includes('.paperclip"') ||
            line.includes(".paperclip'") ||
            line.includes(".paperclip`") ||
            line.includes(".paperclip-worktrees") ||
            line.includes(".paperclip-sdk") ||
            line.includes(".paperclip-local") ||
            line.includes(".paperclip-review") ||
            line.includes(".paperclip-openclaw")
          ) {
            // Allow .paperclip.yaml / .paperclip.yml references (vendor sidecar)
            const trimmed = line.trim();
            if (
              trimmed.includes(".paperclip.yaml") ||
              trimmed.includes(".paperclip.yml")
            ) {
              // Only skip if the ONLY .paperclip reference is the yaml/yml one
              const withoutYaml = trimmed
                .replace(/\.paperclip\.yaml/g, "")
                .replace(/\.paperclip\.yml/g, "");
              if (
                !withoutYaml.includes(".paperclip/") &&
                !withoutYaml.includes('.paperclip"') &&
                !withoutYaml.includes(".paperclip'") &&
                !withoutYaml.includes(".paperclip`") &&
                !withoutYaml.includes(".paperclip-worktrees") &&
                !withoutYaml.includes(".paperclip-sdk") &&
                !withoutYaml.includes(".paperclip-local") &&
                !withoutYaml.includes(".paperclip-review") &&
                !withoutYaml.includes(".paperclip-openclaw")
              ) {
                continue;
              }
            }
            violations.push({
              file: f.replace(ROOT + "/", ""),
              line: `L${i + 1}: ${trimmed}`,
            });
          }
        }
      }
      expect(violations).toEqual([]);
    });

    it("no ~/.paperclip/ path references in config schema defaults", () => {
      const configSchemaPath = join(
        ROOT,
        "packages/shared/src/config-schema.ts",
      );
      const content = readFileSync(configSchemaPath, "utf-8");
      const matches = content.match(/~\/\.paperclip\//g);
      expect(matches).toBeNull();
    });

    it("worktree home default uses ~/.papierklammer-worktrees", () => {
      const worktreeLib = join(ROOT, "cli/src/commands/worktree-lib.ts");
      const content = readFileSync(worktreeLib, "utf-8");
      expect(content).toContain("~/.papierklammer-worktrees");
      expect(content).not.toContain("~/.paperclip-worktrees");
    });

    it("default home dir resolves to ~/.papierklammer", () => {
      const homeTs = join(ROOT, "cli/src/config/home.ts");
      const content = readFileSync(homeTs, "utf-8");
      expect(content).toContain(".papierklammer");
      expect(content).not.toContain('".paperclip"');
    });
  });

  describe("VAL-FORK-005: CLI binary renamed", () => {
    it("CLI package.json bin field uses papierklammer key", () => {
      const cliPkg = JSON.parse(
        readFileSync(join(ROOT, "cli/package.json"), "utf-8"),
      );
      expect(cliPkg.bin).toHaveProperty("papierklammer");
      expect(cliPkg.bin).not.toHaveProperty("paperclipai");
    });

    it("CLI package.json name is papierklammer", () => {
      const cliPkg = JSON.parse(
        readFileSync(join(ROOT, "cli/package.json"), "utf-8"),
      );
      expect(cliPkg.name).toBe("papierklammer");
    });

    it("CLI program name is papierklammer", () => {
      const indexTs = readFileSync(join(ROOT, "cli/src/index.ts"), "utf-8");
      expect(indexTs).toContain('.name("papierklammer")');
      expect(indexTs).not.toContain('.name("paperclipai")');
    });

    it("CLI description says Papierklammer", () => {
      const indexTs = readFileSync(join(ROOT, "cli/src/index.ts"), "utf-8");
      expect(indexTs).toContain("Papierklammer");
    });
  });

  describe("create-paperclip-plugin → create-papierklammer-plugin", () => {
    it("package name is @papierklammer/create-papierklammer-plugin", () => {
      const pkg = JSON.parse(
        readFileSync(
          join(
            ROOT,
            "packages/plugins/create-papierklammer-plugin/package.json",
          ),
          "utf-8",
        ),
      );
      expect(pkg.name).toBe("@papierklammer/create-papierklammer-plugin");
    });

    it("bin field uses create-papierklammer-plugin", () => {
      const pkg = JSON.parse(
        readFileSync(
          join(
            ROOT,
            "packages/plugins/create-papierklammer-plugin/package.json",
          ),
          "utf-8",
        ),
      );
      expect(pkg.bin).toHaveProperty("create-papierklammer-plugin");
      expect(pkg.bin).not.toHaveProperty("create-paperclip-plugin");
    });
  });

  describe("branding strings updated", () => {
    it("UI window title uses Papierklammer", () => {
      const indexHtml = readFileSync(
        join(ROOT, "ui/index.html"),
        "utf-8",
      );
      expect(indexHtml).toContain("Papierklammer");
      expect(indexHtml).not.toMatch(/<title>Paperclip<\/title>/);
    });

    it("web manifest uses Papierklammer", () => {
      const manifest = JSON.parse(
        readFileSync(
          join(ROOT, "ui/public/site.webmanifest"),
          "utf-8",
        ),
      );
      expect(manifest.name).toBe("Papierklammer");
      expect(manifest.short_name).toBe("Papierklammer");
    });

    it("service worker cache name uses papierklammer", () => {
      const sw = readFileSync(
        join(ROOT, "ui/public/sw.js"),
        "utf-8",
      );
      expect(sw).toContain("papierklammer");
      expect(sw).not.toContain("paperclip-v");
    });
  });
});
