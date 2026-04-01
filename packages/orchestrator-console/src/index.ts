#!/usr/bin/env node

import { Command } from "commander";
import { OrchestratorClient, AuthenticationError, ApiError } from "./client.js";
import { statusCommand } from "./commands/status.js";
import { staleCommand } from "./commands/stale.js";
import { createIssueCommand } from "./commands/create-issue.js";
import { reprioritizeCommand } from "./commands/reprioritize.js";
import { unblockCommand } from "./commands/unblock.js";
import { cleanupCommand } from "./commands/cleanup.js";
import { nudgeCommand } from "./commands/nudge.js";

const DEFAULT_URL = "http://localhost:3100";

function resolveClient(opts: { url?: string; apiKey?: string }): OrchestratorClient {
  const baseUrl = opts.url || process.env.PAPIERKLAMMER_API_URL || DEFAULT_URL;
  const apiKey = opts.apiKey || process.env.PAPIERKLAMMER_API_KEY;

  if (!apiKey) {
    console.error(
      "Error: API key required. Provide --api-key or set PAPIERKLAMMER_API_KEY.",
    );
    process.exit(1);
  }

  return new OrchestratorClient({ baseUrl, apiKey });
}

function handleError(err: unknown): never {
  if (err instanceof AuthenticationError) {
    console.error(`Auth error: ${err.message}`);
    process.exit(1);
  }
  if (err instanceof ApiError) {
    console.error(`API error (${err.status}): ${err.message}`);
    process.exit(1);
  }
  if (err instanceof Error) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
  console.error("Unknown error occurred");
  process.exit(1);
}

export function createProgram(): Command {
  const program = new Command();

  program
    .name("papierklammer-orch")
    .description("Papierklammer Orchestrator Console CLI")
    .version("0.1.0")
    .option("--url <url>", "API base URL (default: http://localhost:3100)")
    .option("--api-key <key>", "API key for authentication");

  program
    .command("status")
    .description("Show system status overview")
    .requiredOption("--company-id <id>", "Company ID")
    .action(async (cmdOpts) => {
      try {
        const globalOpts = program.opts();
        const client = resolveClient(globalOpts);
        await statusCommand(client, cmdOpts.companyId);
      } catch (err) {
        handleError(err);
      }
    });

  program
    .command("stale")
    .description("Show stale items (runs, intents, leases)")
    .requiredOption("--company-id <id>", "Company ID")
    .action(async (cmdOpts) => {
      try {
        const globalOpts = program.opts();
        const client = resolveClient(globalOpts);
        await staleCommand(client, cmdOpts.companyId);
      } catch (err) {
        handleError(err);
      }
    });

  program
    .command("create-issue")
    .description("Create a new issue")
    .requiredOption("--company-id <id>", "Company ID")
    .requiredOption("--title <title>", "Issue title")
    .option("--assignee <agentId>", "Assignee agent ID")
    .option("--project <projectId>", "Project ID")
    .option("--priority <priority>", "Issue priority")
    .option("--description <text>", "Issue description")
    .action(async (cmdOpts) => {
      try {
        const globalOpts = program.opts();
        const client = resolveClient(globalOpts);
        await createIssueCommand(client, {
          companyId: cmdOpts.companyId,
          title: cmdOpts.title,
          assignee: cmdOpts.assignee,
          project: cmdOpts.project,
          priority: cmdOpts.priority,
          description: cmdOpts.description,
        });
      } catch (err) {
        handleError(err);
      }
    });

  program
    .command("reprioritize")
    .description("Update issue priority")
    .requiredOption("--id <issueId>", "Issue ID")
    .requiredOption("--priority <priority>", "New priority")
    .action(async (cmdOpts) => {
      try {
        const globalOpts = program.opts();
        const client = resolveClient(globalOpts);
        await reprioritizeCommand(client, cmdOpts.id, cmdOpts.priority);
      } catch (err) {
        handleError(err);
      }
    });

  program
    .command("unblock")
    .description("Force-unblock an issue")
    .requiredOption("--id <issueId>", "Issue ID")
    .action(async (cmdOpts) => {
      try {
        const globalOpts = program.opts();
        const client = resolveClient(globalOpts);
        await unblockCommand(client, cmdOpts.id);
      } catch (err) {
        handleError(err);
      }
    });

  program
    .command("cleanup")
    .description("Clean up stale runs and intents")
    .requiredOption("--company-id <id>", "Company ID")
    .action(async (cmdOpts) => {
      try {
        const globalOpts = program.opts();
        const client = resolveClient(globalOpts);
        await cleanupCommand(client, cmdOpts.companyId);
      } catch (err) {
        handleError(err);
      }
    });

  program
    .command("nudge")
    .description("Nudge an agent (create escalation intent)")
    .requiredOption("--agent-id <id>", "Agent ID")
    .action(async (cmdOpts) => {
      try {
        const globalOpts = program.opts();
        const client = resolveClient(globalOpts);
        await nudgeCommand(client, cmdOpts.agentId);
      } catch (err) {
        handleError(err);
      }
    });

  return program;
}

// Run if executed directly
const isDirectExecution =
  typeof process !== "undefined" &&
  process.argv[1] &&
  (process.argv[1].endsWith("index.js") || process.argv[1].endsWith("index.ts"));

if (isDirectExecution) {
  createProgram().parseAsync(process.argv);
}
