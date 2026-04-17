import { readFileSync, rmSync, unlinkSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const ONBOARDING_FIRST_RUN_FIXTURE_NAME = "qa-app-first-run";
export const ONBOARDING_FIRST_RUN_HOME = "/tmp/papierklammer-onboarding-mission";
export const ONBOARDING_FIRST_RUN_INSTANCE_ID = "onboarding-mission";
export const ONBOARDING_FIRST_RUN_PORT = 3100;
export const ONBOARDING_FIRST_RUN_PID_FILE = path.join(ONBOARDING_FIRST_RUN_HOME, "qa-app.pid");
export const ONBOARDING_FIRST_RUN_HEALTHCHECK_URL = "http://127.0.0.1:3100/api/health";
export const ONBOARDING_FIRST_RUN_COMPANIES_URL = "http://127.0.0.1:3100/api/companies";
export const ONBOARDING_FIRST_RUN_RESET_COMMAND =
  "node cli/node_modules/tsx/dist/cli.mjs scripts/onboarding-first-run-fixture.ts reset";
export const ONBOARDING_FIRST_RUN_STOP_COMMAND =
  "node cli/node_modules/tsx/dist/cli.mjs scripts/onboarding-first-run-fixture.ts stop";

export function resolveOnboardingFirstRunFixture() {
  return {
    name: ONBOARDING_FIRST_RUN_FIXTURE_NAME,
    home: ONBOARDING_FIRST_RUN_HOME,
    instanceId: ONBOARDING_FIRST_RUN_INSTANCE_ID,
    port: ONBOARDING_FIRST_RUN_PORT,
    pidFile: ONBOARDING_FIRST_RUN_PID_FILE,
    healthcheckUrl: ONBOARDING_FIRST_RUN_HEALTHCHECK_URL,
    companiesUrl: ONBOARDING_FIRST_RUN_COMPANIES_URL,
    resetCommand: ONBOARDING_FIRST_RUN_RESET_COMMAND,
    stopCommand: ONBOARDING_FIRST_RUN_STOP_COMMAND,
  };
}

function readFixturePid() {
  const raw = readFileSync(ONBOARDING_FIRST_RUN_PID_FILE, "utf8").trim();
  const pid = Number.parseInt(raw, 10);
  if (!Number.isFinite(pid) || pid <= 0) {
    throw new Error(`Invalid PID file at ${ONBOARDING_FIRST_RUN_PID_FILE}: ${JSON.stringify(raw)}`);
  }
  return pid;
}

function isProcessAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForExit(pid: number, timeoutMs = 5_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (!isProcessAlive(pid)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return !isProcessAlive(pid);
}

export async function stopOnboardingFirstRunFixture() {
  let pid: number | null = null;
  let running = false;

  try {
    pid = readFixturePid();
    running = isProcessAlive(pid);
  } catch {
    pid = null;
  }

  if (pid !== null && running) {
    process.kill(pid, "SIGTERM");
    await waitForExit(pid);
  }

  try {
    unlinkSync(ONBOARDING_FIRST_RUN_PID_FILE);
  } catch {
    // ignore missing or already-removed pid file
  }

  return {
    action: "stop",
    ...resolveOnboardingFirstRunFixture(),
    pid,
    wasRunning: running,
  };
}

export async function resetOnboardingFirstRunFixture() {
  const stop = await stopOnboardingFirstRunFixture();
  rmSync(ONBOARDING_FIRST_RUN_HOME, { recursive: true, force: true });

  return {
    action: "reset",
    ...resolveOnboardingFirstRunFixture(),
    stop,
    resetRoot: ONBOARDING_FIRST_RUN_HOME,
  };
}

async function main(argv: string[]) {
  const command = argv[2]?.trim() ?? "describe";

  switch (command) {
    case "describe":
      console.log(JSON.stringify(resolveOnboardingFirstRunFixture(), null, 2));
      return;
    case "stop":
      console.log(JSON.stringify(await stopOnboardingFirstRunFixture(), null, 2));
      return;
    case "reset":
      console.log(JSON.stringify(await resetOnboardingFirstRunFixture(), null, 2));
      return;
    default:
      throw new Error(`Unknown command ${JSON.stringify(command)}. Expected describe, stop, or reset.`);
  }
}

const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  main(process.argv).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
