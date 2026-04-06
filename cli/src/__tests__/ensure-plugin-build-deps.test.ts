import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

function writeFileWithMtime(filePath: string, contents: string, mtimeMs: number) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
  const stamp = new Date(mtimeMs);
  fs.utimesSync(filePath, stamp, stamp);
}

function createTarget(rootDir: string, name: string, relativeDir: string, dependencies: string[] = []) {
  return {
    name,
    inputPaths: [
      path.join(rootDir, relativeDir, "src"),
      path.join(rootDir, relativeDir, "package.json"),
      path.join(rootDir, relativeDir, "tsconfig.json"),
    ],
    outputPaths: [
      path.join(rootDir, relativeDir, "dist/index.js"),
      path.join(rootDir, relativeDir, "dist/index.d.ts"),
    ],
    tsconfig: path.join(rootDir, relativeDir, "tsconfig.json"),
    dependencies,
  };
}

describe("ensurePluginBuildDeps", () => {
  it("skips builds when outputs are already fresh", async () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-plugin-build-deps-"));
    const shared = createTarget(rootDir, "@papierklammer/shared", "packages/shared");
    const sdk = createTarget(rootDir, "@papierklammer/plugin-sdk", "packages/plugins/sdk", ["@papierklammer/shared"]);

    writeFileWithMtime(shared.inputPaths[0] + "/index.ts", "export {};\n", 1_000);
    writeFileWithMtime(shared.inputPaths[1], "{\"name\":\"@papierklammer/shared\"}\n", 1_000);
    writeFileWithMtime(shared.inputPaths[2], "{}\n", 1_000);
    writeFileWithMtime(shared.outputPaths[0], "export {};\n", 2_000);
    writeFileWithMtime(shared.outputPaths[1], "export {};\n", 2_000);

    writeFileWithMtime(sdk.inputPaths[0] + "/index.ts", "export {};\n", 1_500);
    writeFileWithMtime(sdk.inputPaths[1], "{\"name\":\"@papierklammer/plugin-sdk\"}\n", 1_500);
    writeFileWithMtime(sdk.inputPaths[2], "{}\n", 1_500);
    writeFileWithMtime(sdk.outputPaths[0], "export {};\n", 3_000);
    writeFileWithMtime(sdk.outputPaths[1], "export {};\n", 3_000);

    // @ts-expect-error test-only import of an untyped ESM helper script
    const { ensurePluginBuildDeps } = await import("../../../scripts/ensure-plugin-build-deps.mjs");
    const rebuilt = ensurePluginBuildDeps({
      rootDir,
      buildTargets: [shared, sdk],
      runBuild: () => {
        throw new Error("should not rebuild fresh targets");
      },
    });

    expect(rebuilt).toEqual([]);
  });

  it("rebuilds a stale target when its source is newer than its outputs", async () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-plugin-build-deps-"));
    const shared = createTarget(rootDir, "@papierklammer/shared", "packages/shared");
    const sdk = createTarget(rootDir, "@papierklammer/plugin-sdk", "packages/plugins/sdk", ["@papierklammer/shared"]);
    let buildTime = 10_000;
    const rebuilt: string[] = [];

    writeFileWithMtime(shared.inputPaths[0] + "/index.ts", "export {};\n", 1_000);
    writeFileWithMtime(shared.inputPaths[1], "{\"name\":\"@papierklammer/shared\"}\n", 1_000);
    writeFileWithMtime(shared.inputPaths[2], "{}\n", 1_000);
    writeFileWithMtime(shared.outputPaths[0], "export {};\n", 2_000);
    writeFileWithMtime(shared.outputPaths[1], "export {};\n", 2_000);

    writeFileWithMtime(sdk.inputPaths[0] + "/index.ts", "export {};\n", 4_000);
    writeFileWithMtime(sdk.inputPaths[1], "{\"name\":\"@papierklammer/plugin-sdk\"}\n", 1_500);
    writeFileWithMtime(sdk.inputPaths[2], "{}\n", 1_500);
    writeFileWithMtime(sdk.outputPaths[0], "export {};\n", 3_000);
    writeFileWithMtime(sdk.outputPaths[1], "export {};\n", 3_000);

    // @ts-expect-error test-only import of an untyped ESM helper script
    const { ensurePluginBuildDeps } = await import("../../../scripts/ensure-plugin-build-deps.mjs");
    ensurePluginBuildDeps({
      rootDir,
      buildTargets: [shared, sdk],
      runBuild: (target: typeof shared) => {
        rebuilt.push(target.name);
        buildTime += 1_000;
        for (const outputPath of target.outputPaths) {
          writeFileWithMtime(outputPath, `built ${target.name}\n`, buildTime);
        }
      },
    });

    expect(rebuilt).toEqual(["@papierklammer/plugin-sdk"]);
  });

  it("rebuilds plugin-sdk after refreshing a stale shared dependency", async () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-plugin-build-deps-"));
    const shared = createTarget(rootDir, "@papierklammer/shared", "packages/shared");
    const sdk = createTarget(rootDir, "@papierklammer/plugin-sdk", "packages/plugins/sdk", ["@papierklammer/shared"]);
    let buildTime = 10_000;
    const rebuilt: string[] = [];

    writeFileWithMtime(shared.inputPaths[0] + "/index.ts", "export {};\n", 4_000);
    writeFileWithMtime(shared.inputPaths[1], "{\"name\":\"@papierklammer/shared\"}\n", 1_000);
    writeFileWithMtime(shared.inputPaths[2], "{}\n", 1_000);
    writeFileWithMtime(shared.outputPaths[0], "export {};\n", 2_000);
    writeFileWithMtime(shared.outputPaths[1], "export {};\n", 2_000);

    writeFileWithMtime(sdk.inputPaths[0] + "/index.ts", "export {};\n", 1_500);
    writeFileWithMtime(sdk.inputPaths[1], "{\"name\":\"@papierklammer/plugin-sdk\"}\n", 1_500);
    writeFileWithMtime(sdk.inputPaths[2], "{}\n", 1_500);
    writeFileWithMtime(sdk.outputPaths[0], "export {};\n", 3_000);
    writeFileWithMtime(sdk.outputPaths[1], "export {};\n", 3_000);

    // @ts-expect-error test-only import of an untyped ESM helper script
    const { ensurePluginBuildDeps } = await import("../../../scripts/ensure-plugin-build-deps.mjs");
    ensurePluginBuildDeps({
      rootDir,
      buildTargets: [shared, sdk],
      runBuild: (target: typeof shared) => {
        rebuilt.push(target.name);
        buildTime += 1_000;
        for (const outputPath of target.outputPaths) {
          writeFileWithMtime(outputPath, `built ${target.name}\n`, buildTime);
        }
      },
    });

    expect(rebuilt).toEqual(["@papierklammer/shared", "@papierklammer/plugin-sdk"]);
  });
});
