import path from "node:path";

export const AUDIT_MISSION_HOME = "/tmp/papierklammer-mission-64c225d0";
export const AUDIT_DEMO_REPO_PATH = "/Users/aischool/work/papierklammer-audit-demo";
export const DEMO_ARTIFACT_RELATIVE_PATH = "artifacts/latest-report.json";
export const DEMO_GENERATED_AT = "2026-04-04T00:00:00.000Z";

export type AuditInstanceKey = "audit" | "precompany";
export const AUDIT_INSTANCE_KEYS = ["audit", "precompany"] as const satisfies readonly AuditInstanceKey[];

const AUDIT_INSTANCE_CONFIG = {
  audit: {
    label: "audit-app",
    instanceId: "audit",
    port: 3100,
    embeddedPostgresPort: 54329,
  },
  precompany: {
    label: "precompany-app",
    instanceId: "precompany",
    port: 3101,
    embeddedPostgresPort: 54330,
  },
} as const satisfies Record<
  AuditInstanceKey,
  {
    label: string;
    instanceId: string;
    port: number;
    embeddedPostgresPort: number;
  }
>;

const DEMO_TASKS = [
  {
    id: "AUD-1",
    title: "Generate a deterministic audit report",
    command: "pnpm smoke",
    output: "artifacts/latest-report.json",
  },
  {
    id: "AUD-2",
    title: "Summarize fixture tasks for review",
    command: "pnpm report",
    output: "stdout",
  },
  {
    id: "AUD-3",
    title: "Confirm the real workspace root used by the CLI",
    command: "pnpm smoke",
    output: AUDIT_DEMO_REPO_PATH,
  },
] as const;

function toPosixPath(value: string): string {
  return value.replaceAll("\\", "/");
}

export function resolveAuditInstanceTarget(key: AuditInstanceKey) {
  const config = AUDIT_INSTANCE_CONFIG[key];
  const instanceRoot = `${AUDIT_MISSION_HOME}/instances/${config.instanceId}`;

  return {
    key,
    label: config.label,
    instanceId: config.instanceId,
    port: config.port,
    embeddedPostgresPort: config.embeddedPostgresPort,
    missionHome: AUDIT_MISSION_HOME,
    instanceRoot,
    configPath: `${instanceRoot}/config.json`,
    env: {
      PAPIERKLAMMER_HOME: AUDIT_MISSION_HOME,
      PAPIERKLAMMER_INSTANCE_ID: config.instanceId,
      PORT: String(config.port),
    },
  };
}

export function isAuditInstanceKey(value: string): value is AuditInstanceKey {
  return (AUDIT_INSTANCE_KEYS as readonly string[]).includes(value);
}

export function applyAuditInstanceDefaults<
  T extends {
    database: Record<string, unknown> & { embeddedPostgresPort?: number };
    server: Record<string, unknown> & { port?: number };
  },
>(
  config: T,
  key: AuditInstanceKey,
): T {
  const target = resolveAuditInstanceTarget(key);

  return {
    ...config,
    database: {
      ...config.database,
      embeddedPostgresPort: target.embeddedPostgresPort,
    },
    server: {
      ...config.server,
      port: target.port,
    },
  };
}

export function buildDemoArtifact(workspaceRoot = AUDIT_DEMO_REPO_PATH) {
  const normalizedWorkspaceRoot = toPosixPath(workspaceRoot);
  const artifactPath = path.posix.join(normalizedWorkspaceRoot, DEMO_ARTIFACT_RELATIVE_PATH);
  const tasks = DEMO_TASKS.map((task) => ({ ...task }));

  return {
    generatedAt: DEMO_GENERATED_AT,
    workspaceRoot: normalizedWorkspaceRoot,
    artifactPath,
    command: "pnpm smoke",
    taskCount: tasks.length,
    tasks,
  };
}

export function buildDemoProjectFiles() {
  return {
    ".gitignore": ["artifacts/", "node_modules/"].join("\n") + "\n",
    "data/tasks.json": JSON.stringify(DEMO_TASKS, null, 2) + "\n",
    "package.json":
      JSON.stringify(
        {
          name: "papierklammer-audit-demo",
          private: true,
          type: "module",
          packageManager: "pnpm@9.15.4",
          scripts: {
            smoke: "node ./src/cli.mjs smoke",
            report: "node ./src/cli.mjs report",
          },
        },
        null,
        2,
      ) + "\n",
    "src/cli.mjs": `#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tasksPath = path.join(workspaceRoot, "data", "tasks.json");
const artifactPath = path.join(workspaceRoot, ${JSON.stringify(DEMO_ARTIFACT_RELATIVE_PATH)});
const generatedAt = ${JSON.stringify(DEMO_GENERATED_AT)};

function loadTasks() {
  const raw = JSON.parse(readFileSync(tasksPath, "utf8"));
  return [...raw].sort((left, right) => String(left.id).localeCompare(String(right.id)));
}

function buildReport() {
  const tasks = loadTasks();
  return {
    generatedAt,
    workspaceRoot,
    artifactPath,
    command: "pnpm smoke",
    taskCount: tasks.length,
    tasks,
  };
}

function writeArtifact(report) {
  mkdirSync(path.dirname(artifactPath), { recursive: true });
  const contents = JSON.stringify(report, null, 2) + "\\n";
  writeFileSync(artifactPath, contents, "utf8");
  return createHash("sha256").update(contents).digest("hex");
}

const command = process.argv[2] ?? "smoke";
const report = buildReport();
const sha256 = writeArtifact(report);

if (command === "report") {
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

if (command === "smoke") {
  console.log("AUDIT_DEMO_OK");
  console.log(\`workspace=\${report.workspaceRoot}\`);
  console.log(\`artifact=\${report.artifactPath}\`);
  console.log(\`sha256=\${sha256}\`);
  console.log(\`tasks=\${report.taskCount}\`);
  process.exit(0);
}

console.error(\`Unknown command: \${command}\`);
console.error("Expected one of: smoke, report");
process.exit(1);
`,
  } satisfies Record<string, string>;
}
