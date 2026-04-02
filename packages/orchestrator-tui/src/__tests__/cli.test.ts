import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, HELP_TEXT } from "../cli.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("CLI configuration", () => {
  it("declares papierklammer-tui as a bin entry in package.json", () => {
    const pkgPath = resolve(__dirname, "..", "..", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    expect(pkg.bin).toBeDefined();
    expect(pkg.bin["papierklammer-tui"]).toBe("dist/index.js");
  });

  it("has type module in package.json", () => {
    const pkgPath = resolve(__dirname, "..", "..", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    expect(pkg.type).toBe("module");
  });

  it("has correct package name", () => {
    const pkgPath = resolve(__dirname, "..", "..", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    expect(pkg.name).toBe("@papierklammer/orchestrator-tui");
  });
});

describe("CLI --help flag", () => {
  it("shows --url flag documentation in help text", () => {
    expect(HELP_TEXT).toContain("--url");
  });

  it("shows --api-key flag documentation in help text", () => {
    expect(HELP_TEXT).toContain("--api-key");
  });

  it("sets showHelp to true when --help is passed", () => {
    const result = parseArgs(["node", "papierklammer-tui", "--help"]);
    expect(result.showHelp).toBe(true);
  });

  it("sets showHelp to true when -h is passed", () => {
    const result = parseArgs(["node", "papierklammer-tui", "-h"]);
    expect(result.showHelp).toBe(true);
  });

  it("does not set showHelp when no help flag is passed", () => {
    const result = parseArgs(["node", "papierklammer-tui"]);
    expect(result.showHelp).toBe(false);
  });

  it("parses --url flag correctly", () => {
    const result = parseArgs([
      "node",
      "papierklammer-tui",
      "--url",
      "http://example.com:4000",
    ]);
    expect(result.flags.url).toBe("http://example.com:4000");
    expect(result.showHelp).toBe(false);
  });

  it("parses --api-key flag correctly", () => {
    const result = parseArgs([
      "node",
      "papierklammer-tui",
      "--api-key",
      "my-secret-key",
    ]);
    expect(result.flags.apiKey).toBe("my-secret-key");
  });

  it("uses default url when --url is not provided", () => {
    const result = parseArgs(["node", "papierklammer-tui"]);
    expect(result.flags.url).toBe("http://localhost:3100");
  });

  it("parses --company-id flag correctly", () => {
    const result = parseArgs([
      "node",
      "papierklammer-tui",
      "--company-id",
      "company-123",
    ]);
    expect(result.flags.companyId).toBe("company-123");
  });
});
