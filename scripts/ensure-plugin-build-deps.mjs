#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const defaultRootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function collectFileMtimes(targetPath) {
  if (!fs.existsSync(targetPath)) {
    return [];
  }

  const stats = fs.statSync(targetPath);
  if (stats.isFile()) {
    return [stats.mtimeMs];
  }

  if (!stats.isDirectory()) {
    return [];
  }

  const mtimes = [];
  for (const entry of fs.readdirSync(targetPath, { withFileTypes: true })) {
    mtimes.push(...collectFileMtimes(path.join(targetPath, entry.name)));
  }
  return mtimes;
}

function getNewestInputMtime(inputPaths) {
  let newest = 0;
  for (const inputPath of inputPaths) {
    for (const mtime of collectFileMtimes(inputPath)) {
      newest = Math.max(newest, mtime);
    }
  }
  return newest;
}

function getOutputInfo(outputPaths) {
  let oldest = Number.POSITIVE_INFINITY;
  let newest = 0;

  for (const outputPath of outputPaths) {
    if (!fs.existsSync(outputPath)) {
      return null;
    }

    const stats = fs.statSync(outputPath);
    if (!stats.isFile()) {
      return null;
    }

    oldest = Math.min(oldest, stats.mtimeMs);
    newest = Math.max(newest, stats.mtimeMs);
  }

  if (!Number.isFinite(oldest)) {
    return null;
  }

  return { oldest, newest };
}

export function getDefaultTscCliPath(rootDir = defaultRootDir) {
  return path.join(rootDir, "node_modules", "typescript", "bin", "tsc");
}

export function createDefaultBuildTargets(rootDir = defaultRootDir) {
  return [
    {
      name: "@papierklammer/shared",
      inputPaths: [
        path.join(rootDir, "packages/shared/src"),
        path.join(rootDir, "packages/shared/package.json"),
        path.join(rootDir, "packages/shared/tsconfig.json"),
      ],
      outputPaths: [
        path.join(rootDir, "packages/shared/dist/index.js"),
        path.join(rootDir, "packages/shared/dist/index.d.ts"),
      ],
      tsconfig: path.join(rootDir, "packages/shared/tsconfig.json"),
      dependencies: [],
    },
    {
      name: "@papierklammer/plugin-sdk",
      inputPaths: [
        path.join(rootDir, "packages/plugins/sdk/src"),
        path.join(rootDir, "packages/plugins/sdk/package.json"),
        path.join(rootDir, "packages/plugins/sdk/tsconfig.json"),
      ],
      outputPaths: [
        path.join(rootDir, "packages/plugins/sdk/dist/index.js"),
        path.join(rootDir, "packages/plugins/sdk/dist/index.d.ts"),
      ],
      tsconfig: path.join(rootDir, "packages/plugins/sdk/tsconfig.json"),
      dependencies: ["@papierklammer/shared"],
    },
  ];
}

export function createDefaultBuildRunner({
  rootDir = defaultRootDir,
  tscCliPath = getDefaultTscCliPath(rootDir),
} = {}) {
  if (!fs.existsSync(tscCliPath)) {
    throw new Error(`TypeScript CLI not found at ${tscCliPath}`);
  }

  return (target) => {
    const result = spawnSync(process.execPath, [tscCliPath, "-p", target.tsconfig], {
      cwd: rootDir,
      stdio: "inherit",
    });

    if (result.error) {
      throw result.error;
    }

    if (result.status !== 0) {
      throw new Error(`${target.name} build exited with status ${result.status ?? 1}`);
    }
  };
}

export function ensurePluginBuildDeps({
  rootDir = defaultRootDir,
  buildTargets = createDefaultBuildTargets(rootDir),
  runBuild = createDefaultBuildRunner({ rootDir }),
} = {}) {
  const targetByName = new Map(buildTargets.map((target) => [target.name, target]));
  const outputInfoByName = new Map();
  const rebuiltTargets = [];

  for (const target of buildTargets) {
    const outputInfo = getOutputInfo(target.outputPaths);
    const newestInput = getNewestInputMtime(target.inputPaths);
    const newestDependencyOutput = Math.max(
      0,
      ...target.dependencies.map((dependencyName) => {
        const dependencyTarget = targetByName.get(dependencyName);
        const dependencyOutputInfo =
          outputInfoByName.get(dependencyName) ??
          (dependencyTarget ? getOutputInfo(dependencyTarget.outputPaths) : null);

        if (!dependencyTarget || !dependencyOutputInfo) {
          throw new Error(`Missing plugin build dependency output for ${dependencyName}`);
        }

        return dependencyOutputInfo.newest;
      }),
    );
    const isStale =
      outputInfo === null ||
      newestInput > outputInfo.oldest ||
      newestDependencyOutput > outputInfo.oldest;

    if (isStale) {
      runBuild(target);
      rebuiltTargets.push(target.name);
    }

    const refreshedOutputInfo = getOutputInfo(target.outputPaths);
    if (!refreshedOutputInfo) {
      throw new Error(`Expected ${target.name} outputs to exist after build freshness check`);
    }
    outputInfoByName.set(target.name, refreshedOutputInfo);
  }

  return rebuiltTargets;
}

export async function main() {
  ensurePluginBuildDeps();
  return 0;
}

const entryScript = process.argv[1] ? path.resolve(process.argv[1]) : "";
const currentScript = fileURLToPath(import.meta.url);

if (entryScript === currentScript) {
  try {
    process.exitCode = await main();
  } catch (error) {
    if (error instanceof Error) {
      console.error(error.message);
    } else {
      console.error(error);
    }
    process.exitCode = 1;
  }
}
