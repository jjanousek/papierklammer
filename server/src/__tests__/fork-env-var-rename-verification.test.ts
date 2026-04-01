import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join, resolve } from "path";

const ROOT = resolve(__dirname, "../../..");

/**
 * Recursively collects files matching given extensions, excluding
 * node_modules, dist, .git, .factory, and patches directories.
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

/** Files excluded from the check (historical docs that preserve the old name) */
const EXCLUDED_FILES = [
  "PAPERCLIP_FORK_SPEC.md",
  "PAPERCLIP_ARCHITECTURE_REPORT.md",
  "fork-env-var-rename-verification.test", // this test file
];

function isExcluded(filePath: string): boolean {
  return EXCLUDED_FILES.some((pattern) => filePath.includes(pattern));
}

describe("fork-env-var-rename-verification: PAPERCLIP_* → PAPIERKLAMMER_*", () => {
  it("no process.env.PAPERCLIP_ references in TypeScript/JavaScript source", () => {
    const srcFiles = collectFiles(ROOT, [".ts", ".tsx", ".js", ".mjs"]);
    const violations: { file: string; line: number; text: string }[] = [];
    for (const f of srcFiles) {
      if (isExcluded(f)) continue;
      const content = readFileSync(f, "utf-8");
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes("process.env.PAPERCLIP_")) {
          violations.push({
            file: f.replace(ROOT + "/", ""),
            line: i + 1,
            text: lines[i].trim(),
          });
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("no PAPERCLIP_ env var assignments in adapter execute files", () => {
    const adapterFiles = collectFiles(
      join(ROOT, "packages/adapters"),
      [".ts"],
    );
    const violations: { file: string; line: number; text: string }[] = [];
    const pattern = /env\.PAPERCLIP_|envConfig\.PAPERCLIP_|"PAPERCLIP_/;
    for (const f of adapterFiles) {
      if (isExcluded(f)) continue;
      const content = readFileSync(f, "utf-8");
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (pattern.test(lines[i])) {
          violations.push({
            file: f.replace(ROOT + "/", ""),
            line: i + 1,
            text: lines[i].trim(),
          });
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("no PAPERCLIP_ env var references in server source files", () => {
    const serverFiles = collectFiles(join(ROOT, "server/src"), [".ts"]);
    const violations: { file: string; line: number; text: string }[] = [];
    for (const f of serverFiles) {
      if (isExcluded(f)) continue;
      const content = readFileSync(f, "utf-8");
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        // Match actual env var references, skip comments that mention old var names
        if (lines[i].includes("PAPERCLIP_") && !lines[i].trim().startsWith("//")) {
          violations.push({
            file: f.replace(ROOT + "/", ""),
            line: i + 1,
            text: lines[i].trim(),
          });
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("no PAPERCLIP_ env var references in CLI source files", () => {
    const cliFiles = collectFiles(join(ROOT, "cli/src"), [".ts"]);
    const violations: { file: string; line: number; text: string }[] = [];
    for (const f of cliFiles) {
      if (isExcluded(f)) continue;
      const content = readFileSync(f, "utf-8");
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes("PAPERCLIP_") && !lines[i].trim().startsWith("//")) {
          violations.push({
            file: f.replace(ROOT + "/", ""),
            line: i + 1,
            text: lines[i].trim(),
          });
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("no PAPERCLIP_ env var references in adapter-utils source", () => {
    const utilFiles = collectFiles(
      join(ROOT, "packages/adapter-utils/src"),
      [".ts"],
    );
    const violations: { file: string; line: number; text: string }[] = [];
    for (const f of utilFiles) {
      if (isExcluded(f)) continue;
      const content = readFileSync(f, "utf-8");
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes("PAPERCLIP_") && !lines[i].trim().startsWith("//")) {
          violations.push({
            file: f.replace(ROOT + "/", ""),
            line: i + 1,
            text: lines[i].trim(),
          });
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("adapter buildEnvironment uses PAPIERKLAMMER_ prefix for env vars", () => {
    const serverUtilsPath = join(ROOT, "packages/adapter-utils/src/server-utils.ts");
    const content = readFileSync(serverUtilsPath, "utf-8");

    // Verify key env vars are using new prefix
    expect(content).toContain("PAPIERKLAMMER_AGENT_ID");
    expect(content).toContain("PAPIERKLAMMER_COMPANY_ID");
    expect(content).toContain("PAPIERKLAMMER_API_URL");
    // Verify no old prefix remains
    expect(content).not.toContain("PAPERCLIP_");
  });

  it("no PAPERCLIP_ references in config/scripts files", () => {
    const configFiles = [
      ...collectFiles(ROOT, [".sh"]),
      ...collectFiles(ROOT, [".yml", ".yaml"]),
      ...collectFiles(join(ROOT, "scripts"), [".ts", ".mjs"]),
    ];
    const violations: { file: string; line: number; text: string }[] = [];
    for (const f of configFiles) {
      if (isExcluded(f)) continue;
      const content = readFileSync(f, "utf-8");
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes("PAPERCLIP_")) {
          violations.push({
            file: f.replace(ROOT + "/", ""),
            line: i + 1,
            text: lines[i].trim(),
          });
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("no PAPERCLIP_ references in Dockerfiles", () => {
    const dockerfiles = [
      join(ROOT, "Dockerfile"),
      join(ROOT, "Dockerfile.onboard-smoke"),
      join(ROOT, "docker/untrusted-review/Dockerfile"),
    ];
    const violations: { file: string; line: number; text: string }[] = [];
    for (const f of dockerfiles) {
      const content = readFileSync(f, "utf-8");
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes("PAPERCLIP_")) {
          violations.push({
            file: f.replace(ROOT + "/", ""),
            line: i + 1,
            text: lines[i].trim(),
          });
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
