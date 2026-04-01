import { describe, it, expect } from "vitest";
import { execSync } from "child_process";
import { readFileSync, readdirSync, statSync } from "fs";
import { join, resolve } from "path";

const ROOT = resolve(__dirname, "../../..");

/**
 * Recursively collects files matching a glob pattern, excluding
 * node_modules, dist, .git, .factory directories.
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

describe("fork-rename-verification: @paperclipai → @papierklammer", () => {
  it("no @paperclipai/ references in any package.json file", () => {
    const pkgFiles = collectFiles(ROOT, ["package.json"]);
    const violations: { file: string; line: string }[] = [];
    for (const f of pkgFiles) {
      const content = readFileSync(f, "utf-8");
      const lines = content.split("\n");
      for (const line of lines) {
        if (line.includes("@paperclipai/") || line.includes("@paperclipai\\")) {
          violations.push({ file: f.replace(ROOT + "/", ""), line: line.trim() });
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("no @paperclipai/ imports in TypeScript source files", () => {
    const tsFiles = collectFiles(ROOT, [".ts", ".tsx"]);
    const violations: { file: string; line: string }[] = [];
    for (const f of tsFiles) {
      const content = readFileSync(f, "utf-8");
      const lines = content.split("\n");
      for (const line of lines) {
        if (
          (line.includes("from ") || line.includes("import(") || line.includes("require(")) &&
          line.includes("@paperclipai/")
        ) {
          violations.push({ file: f.replace(ROOT + "/", ""), line: line.trim() });
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("no @paperclipai string literals in source code (excluding docs/reports)", () => {
    const srcFiles = collectFiles(ROOT, [".ts", ".tsx", ".js", ".mjs", ".json"]);
    const violations: { file: string; line: string }[] = [];
    const excludePatterns = [
      "PAPIERKLAMMER_ARCHITECTURE_REPORT",
      "PAPIERKLAMMER_FORK_SPEC",
      "fork-rename-verification", // this test file itself
      "pnpm-lock.yaml",
    ];
    for (const f of srcFiles) {
      if (excludePatterns.some((p) => f.includes(p))) continue;
      const content = readFileSync(f, "utf-8");
      const lines = content.split("\n");
      for (const line of lines) {
        if (line.includes("@paperclipai")) {
          violations.push({ file: f.replace(ROOT + "/", ""), line: line.trim() });
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("all workspace package.json files use @papierklammer/* scope (no @paperclipai/* remains)", () => {
    const pkgFiles = collectFiles(ROOT, ["package.json"]);
    const violations: string[] = [];
    for (const f of pkgFiles) {
      const content = JSON.parse(readFileSync(f, "utf-8"));
      if (content.name && content.name.startsWith("@paperclipai/")) {
        violations.push(`${f.replace(ROOT + "/", "")}: ${content.name}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("no paperclipai GitHub URLs in package.json metadata", () => {
    const pkgFiles = collectFiles(ROOT, ["package.json"]);
    const violations: { file: string; line: string }[] = [];
    for (const f of pkgFiles) {
      const content = readFileSync(f, "utf-8");
      if (content.includes("github.com/paperclipai/")) {
        violations.push({
          file: f.replace(ROOT + "/", ""),
          line: "contains github.com/paperclipai/",
        });
      }
    }
    expect(violations).toEqual([]);
  });
});
