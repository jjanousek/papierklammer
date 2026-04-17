import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function readFixtureDescription() {
  const stdout = execFileSync(
    "node",
    ["cli/node_modules/tsx/dist/cli.mjs", "scripts/onboarding-first-run-fixture.ts", "describe"],
    {
      cwd: repoRoot,
      encoding: "utf8",
    },
  );
  return JSON.parse(stdout);
}

describe("onboarding first-run fixture", () => {
  it("uses the mission-owned instance on port 3100", () => {
    expect(readFixtureDescription()).toEqual({
      name: "qa-app-first-run",
      home: "/tmp/papierklammer-onboarding-mission",
      instanceId: "onboarding-mission",
      port: 3100,
      pidFile: "/tmp/papierklammer-onboarding-mission/qa-app.pid",
      healthcheckUrl: "http://127.0.0.1:3100/api/health",
      companiesUrl: "http://127.0.0.1:3100/api/companies",
      resetCommand: "node cli/node_modules/tsx/dist/cli.mjs scripts/onboarding-first-run-fixture.ts reset",
      stopCommand: "node cli/node_modules/tsx/dist/cli.mjs scripts/onboarding-first-run-fixture.ts stop",
    });
  });

  it("documents reset and first-run service commands in the manifest", () => {
    const servicesYaml = readFileSync(path.join(repoRoot, ".factory/services.yaml"), "utf8");

    expect(servicesYaml).toContain("first-run-fixture-reset:");
    expect(servicesYaml).toContain("first-run-fixture-describe:");
    expect(servicesYaml).toContain("qa-app-first-run:");
    expect(servicesYaml).toContain("node cli/node_modules/tsx/dist/cli.mjs scripts/onboarding-first-run-fixture.ts reset");
    expect(servicesYaml).toContain("node cli/node_modules/tsx/dist/cli.mjs scripts/onboarding-first-run-fixture.ts stop");
  });

  it("tells validators to reset and verify the empty first-run fixture before entry checks", () => {
    const userTesting = readFileSync(path.join(repoRoot, ".factory/library/user-testing.md"), "utf8");

    expect(userTesting).toContain("first-run-fixture-reset");
    expect(userTesting).toContain("qa-app-first-run");
    expect(userTesting).toContain("GET /api/companies");
    expect(userTesting).toContain("returns `[]`");
    expect(userTesting).toContain("without browser-side API mocking");
  });
});
