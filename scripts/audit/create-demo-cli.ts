import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { AUDIT_DEMO_REPO_PATH, buildDemoProjectFiles } from "./helpers.ts";

function runGitInit(repoPath: string): boolean {
  if (existsSync(path.join(repoPath, ".git"))) {
    return false;
  }

  const result = spawnSync("git", ["init", "-q"], {
    cwd: repoPath,
    stdio: "inherit",
  });

  if ((result.status ?? 1) !== 0) {
    throw new Error(`git init failed for ${repoPath}`);
  }

  return true;
}

function writeProjectFiles(repoPath: string) {
  const files = buildDemoProjectFiles();
  const writtenFiles: string[] = [];

  for (const [relativePath, contents] of Object.entries(files)) {
    const absolutePath = path.join(repoPath, relativePath);
    mkdirSync(path.dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, contents, "utf8");
    writtenFiles.push(absolutePath);
  }

  return writtenFiles;
}

function main() {
  mkdirSync(AUDIT_DEMO_REPO_PATH, { recursive: true });
  const writtenFiles = writeProjectFiles(AUDIT_DEMO_REPO_PATH);
  const initializedGit = runGitInit(AUDIT_DEMO_REPO_PATH);

  console.log(
    JSON.stringify(
      {
        repoPath: AUDIT_DEMO_REPO_PATH,
        initializedGit,
        writtenFiles,
      },
      null,
      2,
    ),
  );
}

main();
