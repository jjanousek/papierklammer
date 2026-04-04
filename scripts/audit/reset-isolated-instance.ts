import { mkdirSync, rmSync } from "node:fs";
import {
  AUDIT_INSTANCE_KEYS,
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

function main() {
  const instance = parseInstanceArg(process.argv);
  const target = resolveAuditInstanceTarget(instance);

  mkdirSync(target.missionHome, { recursive: true });
  rmSync(target.instanceRoot, { recursive: true, force: true });

  console.log(
    JSON.stringify(
      {
        action: "reset",
        ...target,
      },
      null,
      2,
    ),
  );
}

main();
