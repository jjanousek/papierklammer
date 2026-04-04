#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs";
import {
  appleScriptString,
  repoRoot,
  resolveLaunchConfig,
  shellEscape,
} from "./dev-tui-utils.mjs";

const pnpmBin = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const forwardedArgs = process.argv.slice(2);
const helpRequested = forwardedArgs.includes("--help") || forwardedArgs.includes("-h");

if (helpRequested) {
  console.log(`Usage: pnpm dev [-- <dev-runner-flags>]

Starts the Paperclip dev server in the current terminal and tries to open the
orchestrator TUI in a second terminal once the server is reachable.

Environment:
  PAPIERKLAMMER_DEV_NO_TUI=1        Disable TUI auto-open
  PAPIERKLAMMER_TUI_TERMINAL=<app>  Override terminal app (for example: ghostty)
  PAPIERKLAMMER_TUI_URL=<url>       Override the TUI target base URL
  PAPIERKLAMMER_TUI_API_KEY=<key>   Board API key for authenticated mode
  PAPIERKLAMMER_TUI_COMPANY_ID=<id> Force the company used by the TUI
`);
  process.exit(0);
}

function openTuiTerminal(command) {
  if (process.platform === "darwin") {
    const preferredTerminal = process.env.PAPIERKLAMMER_TUI_TERMINAL?.trim().toLowerCase();
    const ghosttyAppPath = "/Applications/Ghostty.app";

    if (
      preferredTerminal === "ghostty" ||
      process.env.TERM_PROGRAM === "ghostty" ||
      (!preferredTerminal && fs.existsSync(ghosttyAppPath))
    ) {
      const child = spawn(
        "open",
        ["-na", "Ghostty", "--args", "-e", "/bin/zsh", "-lc", command],
        {
          detached: true,
          stdio: "ignore",
        },
      );
      child.unref();
      return true;
    }

    const script = [
      "tell application \"Terminal\"",
      "activate",
      `do script ${appleScriptString(command)}`,
      "end tell",
    ].join("\n");
    const child = spawn("osascript", ["-e", script], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
    return true;
  }

  if (process.platform === "linux") {
    const candidates = [
      ["x-terminal-emulator", ["-e", "bash", "-lc", command]],
      ["gnome-terminal", ["--", "bash", "-lc", command]],
      ["konsole", ["-e", "bash", "-lc", command]],
    ];
    for (const [bin, args] of candidates) {
      try {
        const child = spawn(bin, args, {
          detached: true,
          stdio: "ignore",
        });
        child.unref();
        return true;
      } catch {
        // Try the next terminal candidate.
      }
    }
  }

  if (process.platform === "win32") {
    const child = spawn("cmd.exe", ["/c", "start", "\"\"", "cmd.exe", "/k", command], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
    return true;
  }

  return false;
}

function buildTuiCommand(launch) {
  const parts = [
    `cd ${shellEscape(repoRoot)}`,
    `PAPIERKLAMMER_TUI_URL=${shellEscape(launch.baseUrl)}`,
    `PAPIERKLAMMER_TUI_API_KEY=${shellEscape(launch.apiKey)}`,
    "pnpm dev:tui",
  ];
  if (launch.companyName) {
    parts.splice(3, 0, `PAPIERKLAMMER_TUI_COMPANY_NAME=${shellEscape(launch.companyName)}`);
  }
  if (launch.companyId) {
    parts.splice(launch.companyName ? 4 : 3, 0, `PAPIERKLAMMER_TUI_COMPANY_ID=${shellEscape(launch.companyId)}`);
  }

  const command = parts.join(" && ");
  return [
    `${command}; status=$?`,
    'if [ "$status" -ne 0 ]; then',
    `  printf '\\n[paperclip] orchestrator TUI exited with status %s\\n' \"$status\"`,
    "  printf '[paperclip] rerun manually in this terminal:\\n'",
    `  printf '%s\\n' ${shellEscape(command)}`,
    "  printf 'Press Enter to close... '",
    "  read _",
    "fi",
  ].join("; ");
}

const serverChild = spawn(
  pnpmBin,
  [
    "--filter",
    "@papierklammer/server",
    "exec",
    "tsx",
    "../scripts/dev-runner.ts",
    "watch",
    ...forwardedArgs,
  ],
  {
    cwd: repoRoot,
    env: process.env,
    stdio: "inherit",
  },
);

const forwardSignal = (signal) => {
  if (!serverChild.killed) {
    serverChild.kill(signal);
  }
};

process.on("SIGINT", forwardSignal);
process.on("SIGTERM", forwardSignal);

if (process.stdout.isTTY && process.env.PAPIERKLAMMER_DEV_NO_TUI !== "1") {
  setTimeout(async () => {
    try {
      const launch = await resolveLaunchConfig();
      const command = buildTuiCommand(launch);
      const opened = openTuiTerminal(command);

      if (opened) {
        console.error(
          launch.companyId
            ? `[paperclip] opened orchestrator TUI in a new terminal for company ${launch.companyId}`
            : "[paperclip] opened orchestrator TUI in a new terminal with company picker",
        );
        console.error("[paperclip] if you do not see it, run `pnpm dev:tui` in another terminal.");
        return;
      }

      console.error("[paperclip] could not open a second terminal automatically.");
      console.error("[paperclip] run this command in another terminal:");
      console.error(command);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown error resolving TUI launch";
      console.error(`[paperclip] skipping TUI auto-open: ${message}`);
    }
  }, 0);
}

serverChild.on("exit", (code, signal) => {
  process.off("SIGINT", forwardSignal);
  process.off("SIGTERM", forwardSignal);
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
