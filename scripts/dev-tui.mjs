#!/usr/bin/env node
import { spawn } from "node:child_process";
import { repoRoot, resolveLaunchConfig } from "./dev-tui-utils.mjs";

const HELP_TEXT = `Usage: pnpm dev:tui [options]

Options:
  --url <url>            Papierklammer base URL
  --api-key <key>        Board API key for authenticated deployments
  --company-id <id>      Company ID to connect to
  --wait-timeout-ms <n>  Health wait timeout in milliseconds (default: 30000)
  --help, -h             Show this help message`;

function parseArgs(argv) {
  const flags = {
    url: "",
    apiKey: "",
    companyId: "",
    waitTimeoutMs: 30_000,
    showHelp: false,
  };

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if ((arg === "--help" || arg === "-h")) {
      flags.showHelp = true;
      continue;
    }
    if (arg === "--url" && index + 1 < argv.length) {
      flags.url = argv[++index];
      continue;
    }
    if (arg === "--api-key" && index + 1 < argv.length) {
      flags.apiKey = argv[++index];
      continue;
    }
    if (arg === "--company-id" && index + 1 < argv.length) {
      flags.companyId = argv[++index];
      continue;
    }
    if (arg === "--wait-timeout-ms" && index + 1 < argv.length) {
      const parsed = Number.parseInt(argv[++index], 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        flags.waitTimeoutMs = parsed;
      }
      continue;
    }
  }

  return flags;
}

const flags = parseArgs(process.argv);

if (flags.showHelp) {
  console.log(HELP_TEXT);
  process.exit(0);
}

const launch = await resolveLaunchConfig(flags);

console.error(
  launch.companyId
    ? `[paperclip] launching orchestrator TUI for company ${launch.companyId} at ${launch.baseUrl}`
    : `[paperclip] launching orchestrator TUI with company picker at ${launch.baseUrl}`,
);

const pnpmBin = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const child = spawn(
  pnpmBin,
  [
    "--filter",
    "@papierklammer/server",
    "exec",
    "tsx",
    "../packages/orchestrator-tui/src/index.tsx",
    "--url",
    launch.baseUrl,
    "--api-key",
    launch.apiKey,
    ...(launch.companyId ? ["--company-id", launch.companyId] : []),
  ],
  {
    cwd: repoRoot,
    env: process.env,
    stdio: "inherit",
  },
);

const forwardSignal = (signal) => {
  if (!child.killed) {
    child.kill(signal);
  }
};

process.on("SIGINT", forwardSignal);
process.on("SIGTERM", forwardSignal);

child.on("exit", (code, signal) => {
  process.off("SIGINT", forwardSignal);
  process.off("SIGTERM", forwardSignal);
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
