#!/usr/bin/env -S node --import tsx
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { loadConfig } from "../server/src/config.ts";
import {
  isPidAlive,
  listLocalServiceRegistryRecords,
  readLocalServicePortOwner,
  removeLocalServiceRegistryRecord,
  terminateLocalService,
} from "../server/src/services/local-service-supervisor.ts";
import { repoRoot } from "./dev-service-profile.ts";

function toDisplayLines(records: Awaited<ReturnType<typeof listLocalServiceRegistryRecords>>) {
  return records.map((record) => {
    const childPid = typeof record.metadata?.childPid === "number" ? ` child=${record.metadata.childPid}` : "";
    const groupPid = typeof record.processGroupId === "number" ? ` group=${record.processGroupId}` : "";
    const url = typeof record.metadata?.url === "string" ? ` url=${record.metadata.url}` : "";
    return `${record.serviceName} pid=${record.pid}${groupPid}${childPid} cwd=${record.cwd}${url}`;
  });
}

function listRepoDevProcessGroups() {
  if (process.platform === "win32") return [];
  try {
    const stdout = execFileSync("ps", ["-axo", "pid=,pgid=,command="], { encoding: "utf8" });
    const groups = new Map<number, { pid: number; processGroupId: number; label: string }>();

    for (const rawLine of stdout.split("\n")) {
      const line = rawLine.trim();
      if (!line || !line.includes(repoRoot)) continue;
      if (line.includes("dev-service.ts")) continue;
      if (
        !line.includes("scripts/dev-watch.ts") &&
        !line.includes("scripts/dev-runner.ts") &&
        !line.includes("src/index.ts")
      ) {
        continue;
      }

      const match = rawLine.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/);
      if (!match) continue;
      const pid = Number.parseInt(match[1], 10);
      const processGroupId = Number.parseInt(match[2], 10);
      if (!Number.isInteger(pid) || pid <= 0 || !Number.isInteger(processGroupId) || processGroupId <= 0) {
        continue;
      }

      const command = match[3] ?? "";
      const label = command.includes("dev-runner.ts")
        ? "papierklammer-dev-runner"
        : command.includes("scripts/dev-watch.ts")
          ? "papierklammer-dev-watch"
          : "papierklammer-server";

      const existing = groups.get(processGroupId);
      if (!existing || pid < existing.pid) {
        groups.set(processGroupId, { pid, processGroupId, label });
      }
    }

    return [...groups.values()];
  } catch {
    return [];
  }
}

async function findUnmanagedDevProcesses() {
  const config = loadConfig();
  const found: Array<{ label: string; pid: number; processGroupId: number | null; url?: string }> = [];

  const serverPid = await readLocalServicePortOwner(config.port);
  if (serverPid && isPidAlive(serverPid)) {
    found.push({
      label: "papierklammer-server",
      pid: serverPid,
      processGroupId: null,
      url: `http://127.0.0.1:${config.port}`,
    });
  }

  if (config.databaseMode === "embedded-postgres") {
    const pidFile = `${config.embeddedPostgresDataDir}/postmaster.pid`;
    if (existsSync(pidFile)) {
      const pid = Number.parseInt(readFileSync(pidFile, "utf8").split("\n")[0]?.trim() ?? "", 10);
      if (Number.isInteger(pid) && pid > 0 && isPidAlive(pid) && !found.some((entry) => entry.pid === pid)) {
        found.push({ label: "embedded-postgres", pid, processGroupId: null });
      } else if (!Number.isInteger(pid) || pid <= 0 || !isPidAlive(pid)) {
        rmSync(pidFile, { force: true });
      }
    }
  }

  for (const processGroup of listRepoDevProcessGroups()) {
    if (found.some((entry) => entry.pid === processGroup.pid || entry.processGroupId === processGroup.processGroupId)) {
      continue;
    }
    found.push(processGroup);
  }

  return found;
}

const command = process.argv[2] ?? "list";
const records = await listLocalServiceRegistryRecords({
  profileKind: "papierklammer-dev",
  metadata: { repoRoot },
});
const unmanaged = records.length === 0 ? await findUnmanagedDevProcesses() : [];

if (command === "list") {
  if (records.length === 0 && unmanaged.length === 0) {
    console.log("No Papierklammer dev services registered for this repo.");
    process.exit(0);
  }
  for (const line of toDisplayLines(records)) {
    console.log(line);
  }
  for (const item of unmanaged) {
    console.log(
      `${item.label} pid=${item.pid}${item.processGroupId ? ` group=${item.processGroupId}` : ""}${item.url ? ` url=${item.url}` : ""} unmanaged=true`,
    );
  }
  process.exit(0);
}

if (command === "stop") {
  if (records.length === 0 && unmanaged.length === 0) {
    console.log("No Papierklammer dev services registered for this repo.");
    process.exit(0);
  }
  for (const record of records) {
    await terminateLocalService(record);
    await removeLocalServiceRegistryRecord(record.serviceKey);
    console.log(`Stopped ${record.serviceName} (pid ${record.pid})`);
  }
  for (const item of unmanaged) {
    await terminateLocalService({ pid: item.pid, processGroupId: item.processGroupId });
    console.log(`Stopped ${item.label} (pid ${item.pid})`);
  }
  process.exit(0);
}

console.error(`Unknown dev-service command: ${command}`);
process.exit(1);
