import { existsSync, mkdirSync } from "node:fs";
import { onboard } from "../../cli/src/commands/onboard.ts";
import { readConfig, writeConfig } from "../../cli/src/config/store.ts";
import {
  AUDIT_INSTANCE_KEYS,
  applyAuditInstanceDefaults,
  isAuditInstanceKey,
  resolveAuditInstanceTarget,
} from "./helpers.ts";

function parseInstanceArg(argv: string[]) {
  const instance = argv[2]?.trim() ?? "";
  if (!isAuditInstanceKey(instance)) {
    throw new Error(
      `Expected instance ${AUDIT_INSTANCE_KEYS.join(" | ")}, received ${JSON.stringify(instance || undefined)}`,
    );
  }
  return instance;
}

async function main() {
  const instance = parseInstanceArg(process.argv);
  const target = resolveAuditInstanceTarget(instance);
  const previousEnv = {
    PAPIERKLAMMER_HOME: process.env.PAPIERKLAMMER_HOME,
    PAPIERKLAMMER_INSTANCE_ID: process.env.PAPIERKLAMMER_INSTANCE_ID,
    PAPIERKLAMMER_CONFIG: process.env.PAPIERKLAMMER_CONFIG,
    PORT: process.env.PORT,
  };

  mkdirSync(target.missionHome, { recursive: true });

  process.env.PAPIERKLAMMER_HOME = target.env.PAPIERKLAMMER_HOME;
  process.env.PAPIERKLAMMER_INSTANCE_ID = target.env.PAPIERKLAMMER_INSTANCE_ID;
  process.env.PAPIERKLAMMER_CONFIG = target.configPath;
  process.env.PORT = target.env.PORT;

  try {
    await onboard({
      config: target.configPath,
      yes: true,
      invokedByRun: true,
    });

    const config = readConfig(target.configPath);
    if (!config) {
      throw new Error(`Expected isolated instance config at ${target.configPath}`);
    }
    writeConfig(applyAuditInstanceDefaults(config, instance), target.configPath);
  } finally {
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }

  console.log(
    JSON.stringify(
      {
        action: "bootstrap",
        ...target,
        configExists: existsSync(target.configPath),
        instanceRootExists: existsSync(target.instanceRoot),
      },
      null,
      2,
    ),
  );
}

await main();
