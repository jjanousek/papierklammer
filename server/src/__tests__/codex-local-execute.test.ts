import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execute } from "@papierklammer/adapter-codex-local/server";

async function writeFakeCodexCommand(commandPath: string): Promise<void> {
  const script = `#!/usr/bin/env node
const fs = require("node:fs");

const capturePath = process.env.PAPIERKLAMMER_TEST_CAPTURE_PATH;
const payload = {
  argv: process.argv.slice(2),
  prompt: fs.readFileSync(0, "utf8"),
  codexHome: process.env.CODEX_HOME || null,
  paperclipEnvKeys: Object.keys(process.env)
    .filter((key) => key.startsWith("PAPIERKLAMMER_"))
    .sort(),
};
if (capturePath) {
  fs.writeFileSync(capturePath, JSON.stringify(payload), "utf8");
}
console.log(JSON.stringify({ type: "thread.started", thread_id: "codex-session-1" }));
console.log(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "hello" } }));
console.log(JSON.stringify({ type: "turn.completed", usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1 } }));
`;
  await fs.writeFile(commandPath, script, "utf8");
  await fs.chmod(commandPath, 0o755);
}

type CapturePayload = {
  argv: string[];
  prompt: string;
  codexHome: string | null;
  paperclipEnvKeys: string[];
};

type LogEntry = {
  stream: "stdout" | "stderr";
  chunk: string;
};

describe("codex execute", () => {
  it("uses a Paperclip-managed CODEX_HOME outside worktree mode while preserving shared auth and config", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-codex-execute-default-"));
    const workspace = path.join(root, "workspace");
    const commandPath = path.join(root, "codex");
    const capturePath = path.join(root, "capture.json");
    const sharedCodexHome = path.join(root, "shared-codex-home");
    const paperclipHome = path.join(root, "paperclip-home");
    const managedCodexHome = path.join(
      paperclipHome,
      "instances",
      "default",
      "companies",
      "company-1",
      "codex-home",
    );
    await fs.mkdir(workspace, { recursive: true });
    await fs.mkdir(sharedCodexHome, { recursive: true });
    await fs.writeFile(path.join(sharedCodexHome, "auth.json"), '{"token":"shared"}\n', "utf8");
    await fs.writeFile(path.join(sharedCodexHome, "config.toml"), 'model = "codex-mini-latest"\n', "utf8");
    await writeFakeCodexCommand(commandPath);

    const previousHome = process.env.HOME;
    const previousPaperclipHome = process.env.PAPIERKLAMMER_HOME;
    const previousPaperclipInstanceId = process.env.PAPIERKLAMMER_INSTANCE_ID;
    const previousPaperclipInWorktree = process.env.PAPIERKLAMMER_IN_WORKTREE;
    const previousCodexHome = process.env.CODEX_HOME;
    process.env.HOME = root;
    process.env.PAPIERKLAMMER_HOME = paperclipHome;
    delete process.env.PAPIERKLAMMER_INSTANCE_ID;
    delete process.env.PAPIERKLAMMER_IN_WORKTREE;
    process.env.CODEX_HOME = sharedCodexHome;

    try {
      const logs: LogEntry[] = [];
      const result = await execute({
        runId: "run-default",
        agent: {
          id: "agent-1",
          companyId: "company-1",
          name: "Codex Coder",
          adapterType: "codex_local",
          adapterConfig: {},
        },
        runtime: {
          sessionId: null,
          sessionParams: null,
          sessionDisplayId: null,
          taskKey: null,
        },
        config: {
          command: commandPath,
          cwd: workspace,
          env: {
            PAPIERKLAMMER_TEST_CAPTURE_PATH: capturePath,
          },
          promptTemplate: "Follow the paperclip heartbeat.",
        },
        context: {},
        authToken: "run-jwt-token",
        onLog: async (stream, chunk) => {
          logs.push({ stream, chunk });
        },
      });

      expect(result.exitCode).toBe(0);
      expect(result.errorMessage).toBeNull();

      const capture = JSON.parse(await fs.readFile(capturePath, "utf8")) as CapturePayload;
      expect(capture.codexHome).toBe(managedCodexHome);

      const managedAuth = path.join(managedCodexHome, "auth.json");
      const managedConfig = path.join(managedCodexHome, "config.toml");
      expect((await fs.lstat(managedAuth)).isSymbolicLink()).toBe(true);
      expect(await fs.realpath(managedAuth)).toBe(await fs.realpath(path.join(sharedCodexHome, "auth.json")));
      expect((await fs.lstat(managedConfig)).isFile()).toBe(true);
      expect(await fs.readFile(managedConfig, "utf8")).toBe('model = "codex-mini-latest"\n');
      await expect(fs.lstat(path.join(sharedCodexHome, "companies", "company-1"))).rejects.toThrow();
      expect(logs).toContainEqual(
        expect.objectContaining({
          stream: "stdout",
          chunk: expect.stringContaining("Using Paperclip-managed Codex home"),
        }),
      );
    } finally {
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
      if (previousPaperclipHome === undefined) delete process.env.PAPIERKLAMMER_HOME;
      else process.env.PAPIERKLAMMER_HOME = previousPaperclipHome;
      if (previousPaperclipInstanceId === undefined) delete process.env.PAPIERKLAMMER_INSTANCE_ID;
      else process.env.PAPIERKLAMMER_INSTANCE_ID = previousPaperclipInstanceId;
      if (previousPaperclipInWorktree === undefined) delete process.env.PAPIERKLAMMER_IN_WORKTREE;
      else process.env.PAPIERKLAMMER_IN_WORKTREE = previousPaperclipInWorktree;
      if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = previousCodexHome;
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("sanitizes shared Codex plugin config when seeding a managed CODEX_HOME", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-codex-execute-config-"));
    const workspace = path.join(root, "workspace");
    const commandPath = path.join(root, "codex");
    const capturePath = path.join(root, "capture.json");
    const sharedCodexHome = path.join(root, "shared-codex-home");
    const paperclipHome = path.join(root, "paperclip-home");
    const managedCodexHome = path.join(
      paperclipHome,
      "instances",
      "default",
      "companies",
      "company-1",
      "codex-home",
    );
    await fs.mkdir(workspace, { recursive: true });
    await fs.mkdir(sharedCodexHome, { recursive: true });
    await fs.writeFile(path.join(sharedCodexHome, "auth.json"), '{"token":"shared"}\n', "utf8");
    await fs.writeFile(
      path.join(sharedCodexHome, "config.toml"),
      [
        'model = "gpt-5.4"',
        "",
        '[plugins."canva@openai-curated"]',
        "enabled = true",
        "",
        "[features]",
        "js_repl = true",
        "",
      ].join("\n"),
      "utf8",
    );
    await writeFakeCodexCommand(commandPath);

    const previousHome = process.env.HOME;
    const previousPaperclipHome = process.env.PAPIERKLAMMER_HOME;
    const previousCodexHome = process.env.CODEX_HOME;
    process.env.HOME = root;
    process.env.PAPIERKLAMMER_HOME = paperclipHome;
    process.env.CODEX_HOME = sharedCodexHome;

    try {
      const result = await execute({
        runId: "run-config",
        agent: {
          id: "agent-1",
          companyId: "company-1",
          name: "Codex Coder",
          adapterType: "codex_local",
          adapterConfig: {},
        },
        runtime: {
          sessionId: null,
          sessionParams: null,
          sessionDisplayId: null,
          taskKey: null,
        },
        config: {
          command: commandPath,
          cwd: workspace,
          env: {
            PAPIERKLAMMER_TEST_CAPTURE_PATH: capturePath,
          },
          promptTemplate: "Follow the paperclip heartbeat.",
        },
        context: {},
        authToken: "run-jwt-token",
        onLog: async () => {},
      });

      expect(result.exitCode).toBe(0);
      const managedConfig = await fs.readFile(path.join(managedCodexHome, "config.toml"), "utf8");
      expect(managedConfig).toContain('model = "gpt-5.4"');
      expect(managedConfig).toContain("[features]");
      expect(managedConfig).not.toContain('[plugins."canva@openai-curated"]');
      expect(managedConfig).not.toContain("enabled = true");
    } finally {
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
      if (previousPaperclipHome === undefined) delete process.env.PAPIERKLAMMER_HOME;
      else process.env.PAPIERKLAMMER_HOME = previousPaperclipHome;
      if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = previousCodexHome;
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("emits a command note that Codex auto-applies repo-scoped AGENTS.md files", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-codex-execute-notes-"));
    const workspace = path.join(root, "workspace");
    const commandPath = path.join(root, "codex");
    const capturePath = path.join(root, "capture.json");
    await fs.mkdir(workspace, { recursive: true });
    await writeFakeCodexCommand(commandPath);

    const previousHome = process.env.HOME;
    process.env.HOME = root;

    let commandNotes: string[] = [];
    try {
      const result = await execute({
        runId: "run-notes",
        agent: {
          id: "agent-1",
          companyId: "company-1",
          name: "Codex Coder",
          adapterType: "codex_local",
          adapterConfig: {},
        },
        runtime: {
          sessionId: null,
          sessionParams: null,
          sessionDisplayId: null,
          taskKey: null,
        },
        config: {
          command: commandPath,
          cwd: workspace,
          env: {
            PAPIERKLAMMER_TEST_CAPTURE_PATH: capturePath,
          },
          promptTemplate: "Follow the paperclip heartbeat.",
        },
        context: {},
        authToken: "run-jwt-token",
        onLog: async () => {},
        onMeta: async (meta) => {
          commandNotes = Array.isArray(meta.commandNotes) ? meta.commandNotes : [];
        },
      });

      expect(result.exitCode).toBe(0);
      expect(result.errorMessage).toBeNull();
      expect(commandNotes).toContain(
        "Codex exec automatically applies repo-scoped AGENTS.md instructions from the current workspace; Paperclip does not currently suppress that discovery.",
      );
    } finally {
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("logs HOME and the resolved executable path in invocation metadata", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-codex-execute-meta-"));
    const workspace = path.join(root, "workspace");
    const binDir = path.join(root, "bin");
    const commandPath = path.join(binDir, "codex");
    const capturePath = path.join(root, "capture.json");
    await fs.mkdir(workspace, { recursive: true });
    await fs.mkdir(binDir, { recursive: true });
    await writeFakeCodexCommand(commandPath);

    const previousHome = process.env.HOME;
    const previousPath = process.env.PATH;
    process.env.HOME = root;
    process.env.PATH = `${binDir}${path.delimiter}${process.env.PATH ?? ""}`;

    let loggedCommand: string | null = null;
    let loggedEnv: Record<string, string> = {};
    try {
      const result = await execute({
        runId: "run-meta",
        agent: {
          id: "agent-1",
          companyId: "company-1",
          name: "Codex Coder",
          adapterType: "codex_local",
          adapterConfig: {},
        },
        runtime: {
          sessionId: null,
          sessionParams: null,
          sessionDisplayId: null,
          taskKey: null,
        },
        config: {
          command: "codex",
          cwd: workspace,
          env: {
            PAPIERKLAMMER_TEST_CAPTURE_PATH: capturePath,
          },
          promptTemplate: "Follow the paperclip heartbeat.",
        },
        context: {},
        authToken: "run-jwt-token",
        onLog: async () => {},
        onMeta: async (meta) => {
          loggedCommand = meta.command;
          loggedEnv = meta.env ?? {};
        },
      });

      expect(result.exitCode).toBe(0);
      expect(result.errorMessage).toBeNull();
      expect(loggedCommand).toBe(commandPath);
      expect(loggedEnv.HOME).toBe(root);
      expect(loggedEnv.PAPIERKLAMMER_RESOLVED_COMMAND).toBe(commandPath);
    } finally {
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("uses a worktree-isolated CODEX_HOME while preserving shared auth and config", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-codex-execute-"));
    const workspace = path.join(root, "workspace");
    const commandPath = path.join(root, "codex");
    const capturePath = path.join(root, "capture.json");
    const sharedCodexHome = path.join(root, "shared-codex-home");
    const paperclipHome = path.join(root, "paperclip-home");
    const isolatedCodexHome = path.join(
      paperclipHome,
      "instances",
      "worktree-1",
      "companies",
      "company-1",
      "codex-home",
    );
    const homeSkill = path.join(isolatedCodexHome, "skills", "paperclip");
    await fs.mkdir(workspace, { recursive: true });
    await fs.mkdir(sharedCodexHome, { recursive: true });
    await fs.writeFile(path.join(sharedCodexHome, "auth.json"), '{"token":"shared"}\n', "utf8");
    await fs.writeFile(path.join(sharedCodexHome, "config.toml"), 'model = "codex-mini-latest"\n', "utf8");
    await writeFakeCodexCommand(commandPath);

    const previousHome = process.env.HOME;
    const previousPaperclipHome = process.env.PAPIERKLAMMER_HOME;
    const previousPaperclipInstanceId = process.env.PAPIERKLAMMER_INSTANCE_ID;
    const previousPaperclipInWorktree = process.env.PAPIERKLAMMER_IN_WORKTREE;
    const previousCodexHome = process.env.CODEX_HOME;
    process.env.HOME = root;
    process.env.PAPIERKLAMMER_HOME = paperclipHome;
    process.env.PAPIERKLAMMER_INSTANCE_ID = "worktree-1";
    process.env.PAPIERKLAMMER_IN_WORKTREE = "true";
    process.env.CODEX_HOME = sharedCodexHome;

    try {
      const logs: LogEntry[] = [];
      const result = await execute({
        runId: "run-1",
        agent: {
          id: "agent-1",
          companyId: "company-1",
          name: "Codex Coder",
          adapterType: "codex_local",
          adapterConfig: {},
        },
        runtime: {
          sessionId: null,
          sessionParams: null,
          sessionDisplayId: null,
          taskKey: null,
        },
        config: {
          command: commandPath,
          cwd: workspace,
          env: {
            PAPIERKLAMMER_TEST_CAPTURE_PATH: capturePath,
          },
          promptTemplate: "Follow the paperclip heartbeat.",
        },
        context: {},
        authToken: "run-jwt-token",
        onLog: async (stream, chunk) => {
          logs.push({ stream, chunk });
        },
      });

      expect(result.exitCode).toBe(0);
      expect(result.errorMessage).toBeNull();

      const capture = JSON.parse(await fs.readFile(capturePath, "utf8")) as CapturePayload;
      expect(capture.codexHome).toBe(isolatedCodexHome);
      expect(capture.argv).toEqual(expect.arrayContaining(["exec", "--json", "-"]));
      expect(capture.prompt).toContain("Follow the paperclip heartbeat.");
      expect(capture.paperclipEnvKeys).toEqual(
        expect.arrayContaining([
          "PAPIERKLAMMER_AGENT_ID",
          "PAPIERKLAMMER_API_KEY",
          "PAPIERKLAMMER_API_URL",
          "PAPIERKLAMMER_COMPANY_ID",
          "PAPIERKLAMMER_RUN_ID",
        ]),
      );

      const isolatedAuth = path.join(isolatedCodexHome, "auth.json");
      const isolatedConfig = path.join(isolatedCodexHome, "config.toml");

      expect((await fs.lstat(isolatedAuth)).isSymbolicLink()).toBe(true);
      expect(await fs.realpath(isolatedAuth)).toBe(await fs.realpath(path.join(sharedCodexHome, "auth.json")));
      expect((await fs.lstat(isolatedConfig)).isFile()).toBe(true);
      expect(await fs.readFile(isolatedConfig, "utf8")).toBe('model = "codex-mini-latest"\n');
      expect((await fs.lstat(homeSkill)).isSymbolicLink()).toBe(true);
      expect(logs).toContainEqual(
        expect.objectContaining({
          stream: "stdout",
          chunk: expect.stringContaining("Using worktree-isolated Codex home"),
        }),
      );
      expect(logs).toContainEqual(
        expect.objectContaining({
          stream: "stdout",
          chunk: expect.stringContaining('Injected Codex skill "paperclip"'),
        }),
      );
    } finally {
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
      if (previousPaperclipHome === undefined) delete process.env.PAPIERKLAMMER_HOME;
      else process.env.PAPIERKLAMMER_HOME = previousPaperclipHome;
      if (previousPaperclipInstanceId === undefined) delete process.env.PAPIERKLAMMER_INSTANCE_ID;
      else process.env.PAPIERKLAMMER_INSTANCE_ID = previousPaperclipInstanceId;
      if (previousPaperclipInWorktree === undefined) delete process.env.PAPIERKLAMMER_IN_WORKTREE;
      else process.env.PAPIERKLAMMER_IN_WORKTREE = previousPaperclipInWorktree;
      if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = previousCodexHome;
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("respects an explicit CODEX_HOME config override even in worktree mode", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-codex-execute-explicit-"));
    const workspace = path.join(root, "workspace");
    const commandPath = path.join(root, "codex");
    const capturePath = path.join(root, "capture.json");
    const sharedCodexHome = path.join(root, "shared-codex-home");
    const explicitCodexHome = path.join(root, "explicit-codex-home");
    const paperclipHome = path.join(root, "paperclip-home");
    await fs.mkdir(workspace, { recursive: true });
    await fs.mkdir(sharedCodexHome, { recursive: true });
    await fs.writeFile(path.join(sharedCodexHome, "auth.json"), '{"token":"shared"}\n', "utf8");
    await writeFakeCodexCommand(commandPath);

    const previousHome = process.env.HOME;
    const previousPaperclipHome = process.env.PAPIERKLAMMER_HOME;
    const previousPaperclipInstanceId = process.env.PAPIERKLAMMER_INSTANCE_ID;
    const previousPaperclipInWorktree = process.env.PAPIERKLAMMER_IN_WORKTREE;
    const previousCodexHome = process.env.CODEX_HOME;
    process.env.HOME = root;
    process.env.PAPIERKLAMMER_HOME = paperclipHome;
    process.env.PAPIERKLAMMER_INSTANCE_ID = "worktree-1";
    process.env.PAPIERKLAMMER_IN_WORKTREE = "true";
    process.env.CODEX_HOME = sharedCodexHome;

    try {
      const result = await execute({
        runId: "run-2",
        agent: {
          id: "agent-1",
          companyId: "company-1",
          name: "Codex Coder",
          adapterType: "codex_local",
          adapterConfig: {},
        },
        runtime: {
          sessionId: null,
          sessionParams: null,
          sessionDisplayId: null,
          taskKey: null,
        },
        config: {
          command: commandPath,
          cwd: workspace,
          env: {
            PAPIERKLAMMER_TEST_CAPTURE_PATH: capturePath,
            CODEX_HOME: explicitCodexHome,
          },
          promptTemplate: "Follow the paperclip heartbeat.",
        },
        context: {},
        authToken: "run-jwt-token",
        onLog: async () => {},
      });

      expect(result.exitCode).toBe(0);
      expect(result.errorMessage).toBeNull();

      const capture = JSON.parse(await fs.readFile(capturePath, "utf8")) as CapturePayload;
      expect(capture.codexHome).toBe(explicitCodexHome);
      expect((await fs.lstat(path.join(explicitCodexHome, "skills", "paperclip"))).isSymbolicLink()).toBe(true);
      await expect(fs.lstat(path.join(paperclipHome, "instances", "worktree-1", "codex-home"))).rejects.toThrow();
    } finally {
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
      if (previousPaperclipHome === undefined) delete process.env.PAPIERKLAMMER_HOME;
      else process.env.PAPIERKLAMMER_HOME = previousPaperclipHome;
      if (previousPaperclipInstanceId === undefined) delete process.env.PAPIERKLAMMER_INSTANCE_ID;
      else process.env.PAPIERKLAMMER_INSTANCE_ID = previousPaperclipInstanceId;
      if (previousPaperclipInWorktree === undefined) delete process.env.PAPIERKLAMMER_IN_WORKTREE;
      else process.env.PAPIERKLAMMER_IN_WORKTREE = previousPaperclipInWorktree;
      if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = previousCodexHome;
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("drops known Codex startup noise from stderr logs and result payloads", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-codex-execute-noise-"));
    const workspace = path.join(root, "workspace");
    const commandPath = path.join(root, "codex");
    await fs.mkdir(workspace, { recursive: true });
const noisyScript = `#!/usr/bin/env node
console.error('2026-04-09T14:20:45.537513Z  WARN codex_core::plugins::manager: failed to load plugin: plugin is not installed plugin="github@openai-curated" path=/tmp/plugin');
console.error('2026-04-09T14:20:46.307376Z  WARN codex_core::plugins::startup_sync: startup remote plugin sync failed; will retry on next app-server start error=remote plugin sync request to https://chatgpt.com/backend-api/plugins/list failed with status 403 Forbidden: <html>\\n</html>');
console.error('2026-04-09T14:20:47.653644Z  WARN codex_core::shell_snapshot: Failed to delete shell snapshot at "/tmp/x": Os { code: 2, kind: NotFound, message: "No such file or directory" }');
console.error('2026-04-09T14:20:48.653644Z  WARN codex_analytics::analytics_client: events failed with status 403 Forbidden: <html>\\n</html>');
console.error('useful stderr');
console.log(JSON.stringify({ type: "thread.started", thread_id: "codex-session-1" }));
console.log(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "hello" } }));
console.log(JSON.stringify({ type: "turn.completed", usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1 } }));
`;
    await fs.writeFile(commandPath, noisyScript, "utf8");
    await fs.chmod(commandPath, 0o755);

    const previousHome = process.env.HOME;
    process.env.HOME = root;

    const logs: LogEntry[] = [];
    try {
      const result = await execute({
        runId: "run-noise",
        agent: {
          id: "agent-1",
          companyId: "company-1",
          name: "Codex Coder",
          adapterType: "codex_local",
          adapterConfig: {},
        },
        runtime: {
          sessionId: null,
          sessionParams: null,
          sessionDisplayId: null,
          taskKey: null,
        },
        config: {
          command: commandPath,
          cwd: workspace,
          promptTemplate: "Follow the paperclip heartbeat.",
        },
        context: {},
        authToken: "run-jwt-token",
        onLog: async (stream, chunk) => {
          logs.push({ stream, chunk });
        },
      });

      expect(result.exitCode).toBe(0);
      expect(result.resultJson).toMatchObject({
        stderr: "useful stderr\n",
      });
      expect(logs.some((entry) => entry.chunk.includes("useful stderr"))).toBe(true);
      expect(logs.some((entry) => entry.chunk.includes("startup remote plugin sync failed"))).toBe(false);
      expect(logs.some((entry) => entry.chunk.includes("failed to load plugin"))).toBe(false);
      expect(logs.some((entry) => entry.chunk.includes("analytics_client"))).toBe(false);
    } finally {
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("serializes concurrent runs that share the same AGENT_HOME", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-codex-execute-lock-"));
    const workspace = path.join(root, "workspace");
    const commandPath = path.join(root, "codex");
    const tracePath = path.join(root, "trace.log");
    const agentHome = path.join(root, "agent-home");
    await fs.mkdir(workspace, { recursive: true });
    await fs.mkdir(agentHome, { recursive: true });
    const tracingScript = `#!/usr/bin/env node
const fs = require("node:fs");

const tracePath = process.env.PAPIERKLAMMER_TEST_TRACE_PATH;
const runId = process.env.PAPIERKLAMMER_RUN_ID;

async function main() {
  fs.appendFileSync(tracePath, "start:" + runId + "\\n", "utf8");
  await new Promise((resolve) => setTimeout(resolve, 150));
  fs.appendFileSync(tracePath, "end:" + runId + "\\n", "utf8");
  console.log(JSON.stringify({ type: "thread.started", thread_id: "codex-session-" + runId }));
  console.log(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: runId } }));
  console.log(JSON.stringify({ type: "turn.completed", usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1 } }));
}

main().catch((error) => {
  console.error(String(error?.stack || error));
  process.exit(1);
});
`;
    await fs.writeFile(commandPath, tracingScript, "utf8");
    await fs.chmod(commandPath, 0o755);

    const previousHome = process.env.HOME;
    process.env.HOME = root;

    try {
      const common = {
        agent: {
          id: "agent-1",
          companyId: "company-1",
          name: "Codex Coder",
          adapterType: "codex_local",
          adapterConfig: {},
        },
        runtime: {
          sessionId: null,
          sessionParams: null,
          sessionDisplayId: null,
          taskKey: null,
        },
        config: {
          command: commandPath,
          cwd: workspace,
          env: {
            PAPIERKLAMMER_TEST_TRACE_PATH: tracePath,
          },
          promptTemplate: "Follow the paperclip heartbeat.",
        },
        context: {
          paperclipWorkspace: {
            agentHome,
          },
        },
        authToken: "run-jwt-token",
        onLog: async () => {},
      } as const;

      const [first, second] = await Promise.all([
        execute({
          ...common,
          runId: "run-1",
        }),
        execute({
          ...common,
          runId: "run-2",
        }),
      ]);

      expect(first.exitCode).toBe(0);
      expect(second.exitCode).toBe(0);

      const traceLines = (await fs.readFile(tracePath, "utf8"))
        .trim()
        .split("\n")
        .filter(Boolean);
      expect(traceLines).toHaveLength(4);
      expect(traceLines[0]?.startsWith("start:")).toBe(true);
      expect(traceLines[1]?.startsWith("end:")).toBe(true);
      expect(traceLines[2]?.startsWith("start:")).toBe(true);
      expect(traceLines[3]?.startsWith("end:")).toBe(true);
      expect(traceLines[0]?.slice("start:".length)).toBe(traceLines[1]?.slice("end:".length));
      expect(traceLines[2]?.slice("start:".length)).toBe(traceLines[3]?.slice("end:".length));
      expect(traceLines[0]?.slice("start:".length)).not.toBe(traceLines[2]?.slice("start:".length));
    } finally {
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
