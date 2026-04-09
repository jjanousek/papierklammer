import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  agentWakeupRequests,
  agents,
  companies,
  createDb,
  heartbeatRuns,
} from "@papierklammer/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { heartbeatService } from "../services/heartbeat.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeDB = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping heartbeat local auth tests: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

async function writeFakeCodexCommand(commandPath: string): Promise<void> {
  const script = `#!/usr/bin/env node
const fs = require("node:fs");

const tracePath = process.env.PAPIERKLAMMER_TEST_TRACE_PATH;
if (tracePath) {
  fs.writeFileSync(tracePath, process.env.PAPIERKLAMMER_RUN_ID || "unknown", "utf8");
}
console.log(JSON.stringify({ type: "thread.started", thread_id: "codex-session-1" }));
console.log(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "hello" } }));
console.log(JSON.stringify({ type: "turn.completed", usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1 } }));
`;
  await fs.writeFile(commandPath, script, "utf8");
  await fs.chmod(commandPath, 0o755);
}

describeDB("heartbeat local adapter auth startup", () => {
  let db!: ReturnType<typeof createDb>;
  let heartbeat!: ReturnType<typeof heartbeatService>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let tempRoot: string;
  let fakeCodexPath: string;
  let previousJwtSecret: string | undefined;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("heartbeat-local-auth-");
    db = createDb(tempDb.connectionString);
    heartbeat = heartbeatService(db);
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "heartbeat-local-auth-"));
    fakeCodexPath = path.join(tempRoot, "codex");
    await writeFakeCodexCommand(fakeCodexPath);
    previousJwtSecret = process.env.PAPIERKLAMMER_AGENT_JWT_SECRET;
  }, 30_000);

  afterEach(async () => {
    if (previousJwtSecret === undefined) {
      delete process.env.PAPIERKLAMMER_AGENT_JWT_SECRET;
    } else {
      process.env.PAPIERKLAMMER_AGENT_JWT_SECRET = previousJwtSecret;
    }
    await db.execute(sql`TRUNCATE TABLE heartbeat_runs, agent_wakeup_requests, agents, companies CASCADE`);
  });

  afterAll(async () => {
    if (previousJwtSecret === undefined) {
      delete process.env.PAPIERKLAMMER_AGENT_JWT_SECRET;
    } else {
      process.env.PAPIERKLAMMER_AGENT_JWT_SECRET = previousJwtSecret;
    }
    await fs.rm(tempRoot, { recursive: true, force: true });
    await tempDb?.cleanup();
  });

  async function waitForRunStatus(runId: string, expectedStatus: "failed" | "succeeded", timeoutMs = 3_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const run = await db
        .select()
        .from(heartbeatRuns)
        .where(eq(heartbeatRuns.id, runId))
        .then((rows) => rows[0] ?? null);
      if (run?.status === expectedStatus) return run;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    return db
      .select()
      .from(heartbeatRuns)
      .where(eq(heartbeatRuns.id, runId))
      .then((rows) => rows[0] ?? null);
  }

  async function seedAgent(adapterConfig: Record<string, unknown> = {}) {
    const companyId = randomUUID();
    const agentId = randomUUID();

    await db.insert(companies).values({
      id: companyId,
      name: "Auth Co",
      issuePrefix: "AUT",
      requireBoardApprovalForNewAgents: false,
    });

    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "CEO",
      role: "ceo",
      status: "active",
      adapterType: "codex_local",
      adapterConfig,
      runtimeConfig: {},
      permissions: {},
    });

    return { companyId, agentId };
  }

  it("fails clearly when local JWT injection is unavailable and no explicit API key is configured", async () => {
    delete process.env.PAPIERKLAMMER_AGENT_JWT_SECRET;
    const tracePath = path.join(tempRoot, `trace-${randomUUID()}.txt`);
    const { agentId } = await seedAgent({
      command: fakeCodexPath,
      env: {
        PAPIERKLAMMER_TEST_TRACE_PATH: tracePath,
      },
    });

    const run = await heartbeat.wakeup(agentId, {
      source: "on_demand",
      triggerDetail: "manual",
      requestedByActorType: "user",
      requestedByActorId: "board",
    });
    expect(run).not.toBeNull();

    const failedRun = await waitForRunStatus(run!.id, "failed");
    expect(failedRun?.error).toContain("PAPIERKLAMMER_AGENT_JWT_SECRET is missing or invalid");

    const wakeup = await db
      .select({
        status: agentWakeupRequests.status,
        error: agentWakeupRequests.error,
      })
      .from(agentWakeupRequests)
      .where(eq(agentWakeupRequests.runId, run!.id))
      .then((rows) => rows[0] ?? null);
    expect(wakeup?.status).toBe("failed");
    expect(wakeup?.error).toContain("PAPIERKLAMMER_AGENT_JWT_SECRET is missing or invalid");

    await expect(fs.readFile(tracePath, "utf8")).rejects.toThrow();
  });

  it("still runs when an explicit PAPIERKLAMMER_API_KEY is configured for the agent", async () => {
    delete process.env.PAPIERKLAMMER_AGENT_JWT_SECRET;
    const tracePath = path.join(tempRoot, `trace-${randomUUID()}.txt`);
    const { agentId } = await seedAgent({
      command: fakeCodexPath,
      env: {
        PAPIERKLAMMER_API_KEY: "explicit-token",
        PAPIERKLAMMER_TEST_TRACE_PATH: tracePath,
      },
    });

    const run = await heartbeat.wakeup(agentId, {
      source: "on_demand",
      triggerDetail: "manual",
      requestedByActorType: "user",
      requestedByActorId: "board",
    });
    expect(run).not.toBeNull();

    const succeededRun = await waitForRunStatus(run!.id, "succeeded");
    expect(succeededRun?.error).toBeNull();
    expect(await fs.readFile(tracePath, "utf8")).toBe(run!.id);
  });
});
