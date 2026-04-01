import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

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
