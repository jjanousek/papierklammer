import { describe, expect, it } from "vitest";
import {
  AUDIT_DEMO_REPO_PATH,
  AUDIT_MISSION_HOME,
  buildDemoArtifact,
  buildDemoProjectFiles,
  resolveAuditInstanceTarget,
} from "../audit-harness.js";

describe("audit harness helpers", () => {
  it("resolves the isolated audit instance target", () => {
    expect(resolveAuditInstanceTarget("audit")).toEqual({
      key: "audit",
      label: "audit-app",
      instanceId: "audit",
      port: 3100,
      missionHome: AUDIT_MISSION_HOME,
      instanceRoot: `${AUDIT_MISSION_HOME}/instances/audit`,
      configPath: `${AUDIT_MISSION_HOME}/instances/audit/config.json`,
      env: {
        PAPIERKLAMMER_HOME: AUDIT_MISSION_HOME,
        PAPIERKLAMMER_INSTANCE_ID: "audit",
        PORT: "3100",
      },
    });
  });

  it("resolves the isolated precompany instance target", () => {
    expect(resolveAuditInstanceTarget("precompany")).toEqual({
      key: "precompany",
      label: "precompany-app",
      instanceId: "precompany",
      port: 3101,
      missionHome: AUDIT_MISSION_HOME,
      instanceRoot: `${AUDIT_MISSION_HOME}/instances/precompany`,
      configPath: `${AUDIT_MISSION_HOME}/instances/precompany/config.json`,
      env: {
        PAPIERKLAMMER_HOME: AUDIT_MISSION_HOME,
        PAPIERKLAMMER_INSTANCE_ID: "precompany",
        PORT: "3101",
      },
    });
  });

  it("renders the deterministic demo repo files", () => {
    const files = buildDemoProjectFiles();

    expect(Object.keys(files).sort()).toEqual([
      ".gitignore",
      "data/tasks.json",
      "package.json",
      "src/cli.mjs",
    ]);

    const packageJson = JSON.parse(files["package.json"]);
    expect(packageJson.name).toBe("papierklammer-audit-demo");
    expect(packageJson.scripts).toEqual({
      smoke: "node ./src/cli.mjs smoke",
      report: "node ./src/cli.mjs report",
    });

    expect(files["src/cli.mjs"]).toContain("AUDIT_DEMO_OK");
    expect(files["src/cli.mjs"]).toContain("artifacts/latest-report.json");
  });

  it("builds a deterministic artifact payload for the fixed demo workspace", () => {
    const first = buildDemoArtifact(AUDIT_DEMO_REPO_PATH);
    const second = buildDemoArtifact(AUDIT_DEMO_REPO_PATH);

    expect(first).toEqual(second);
    expect(first.workspaceRoot).toBe(AUDIT_DEMO_REPO_PATH);
    expect(first.artifactPath).toBe(`${AUDIT_DEMO_REPO_PATH}/artifacts/latest-report.json`);
    expect(first.generatedAt).toBe("2026-04-04T00:00:00.000Z");
    expect(first.tasks).toHaveLength(3);
  });
});
