import os from "node:os";
import path from "node:path";

const DEFAULT_INSTANCE_ID = "default";
const INSTANCE_ID_RE = /^[a-zA-Z0-9_-]+$/;
const PATH_SEGMENT_RE = /^[a-zA-Z0-9_-]+$/;
const FRIENDLY_PATH_SEGMENT_RE = /[^a-zA-Z0-9._-]+/g;

function expandHomePrefix(value: string): string {
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.resolve(os.homedir(), value.slice(2));
  return value;
}

export function resolvePapierklammerHomeDir(): string {
  const envHome = process.env.PAPIERKLAMMER_HOME?.trim();
  if (envHome) return path.resolve(expandHomePrefix(envHome));
  return path.resolve(os.homedir(), ".papierklammer");
}

export function resolvePapierklammerInstanceId(): string {
  const raw = process.env.PAPIERKLAMMER_INSTANCE_ID?.trim() || DEFAULT_INSTANCE_ID;
  if (!INSTANCE_ID_RE.test(raw)) {
    throw new Error(`Invalid PAPIERKLAMMER_INSTANCE_ID '${raw}'.`);
  }
  return raw;
}

export function resolvePapierklammerInstanceRoot(): string {
  return path.resolve(resolvePapierklammerHomeDir(), "instances", resolvePapierklammerInstanceId());
}

export function resolveDefaultConfigPath(): string {
  return path.resolve(resolvePapierklammerInstanceRoot(), "config.json");
}

export function resolveDefaultEmbeddedPostgresDir(): string {
  return path.resolve(resolvePapierklammerInstanceRoot(), "db");
}

export function resolveDefaultLogsDir(): string {
  return path.resolve(resolvePapierklammerInstanceRoot(), "logs");
}

export function resolveDefaultSecretsKeyFilePath(): string {
  return path.resolve(resolvePapierklammerInstanceRoot(), "secrets", "master.key");
}

export function resolveDefaultStorageDir(): string {
  return path.resolve(resolvePapierklammerInstanceRoot(), "data", "storage");
}

export function resolveDefaultBackupDir(): string {
  return path.resolve(resolvePapierklammerInstanceRoot(), "data", "backups");
}

export function resolveDefaultAgentWorkspaceDir(agentId: string): string {
  const trimmed = agentId.trim();
  if (!PATH_SEGMENT_RE.test(trimmed)) {
    throw new Error(`Invalid agent id for workspace path '${agentId}'.`);
  }
  return path.resolve(resolvePapierklammerInstanceRoot(), "workspaces", trimmed);
}

function sanitizeFriendlyPathSegment(value: string | null | undefined, fallback = "_default"): string {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return fallback;
  const sanitized = trimmed
    .replace(FRIENDLY_PATH_SEGMENT_RE, "-")
    .replace(/^-+|-+$/g, "");
  return sanitized || fallback;
}

export function resolveManagedProjectWorkspaceDir(input: {
  companyId: string;
  projectId: string;
  repoName?: string | null;
}): string {
  const companyId = input.companyId.trim();
  const projectId = input.projectId.trim();
  if (!companyId || !projectId) {
    throw new Error("Managed project workspace path requires companyId and projectId.");
  }
  return path.resolve(
    resolvePapierklammerInstanceRoot(),
    "projects",
    sanitizeFriendlyPathSegment(companyId, "company"),
    sanitizeFriendlyPathSegment(projectId, "project"),
    sanitizeFriendlyPathSegment(input.repoName, "_default"),
  );
}

export function resolveHomeAwarePath(value: string): string {
  return path.resolve(expandHomePrefix(value));
}
