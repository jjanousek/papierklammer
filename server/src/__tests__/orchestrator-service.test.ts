import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { agents, companies, createDb, issues, projects } from "@papierklammer/db";
import { sql } from "drizzle-orm";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { orchestratorService } from "../services/orchestrator.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeDB = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping orchestrator service tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeDB("orchestratorService.findAgentAssignedIssue", () => {
  let db!: ReturnType<typeof createDb>;
  let svc!: ReturnType<typeof orchestratorService>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-orchestrator-service-");
    db = createDb(tempDb.connectionString);
    svc = orchestratorService(db);
  }, 20_000);

  afterEach(async () => {
    await db.execute(sql`TRUNCATE TABLE issues, projects, agents, companies CASCADE`);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seedAgentContext() {
    const companyId = randomUUID();
    const agentId = randomUUID();
    const projectId = randomUUID();

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });

    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "Agent Alpha",
      role: "engineer",
      status: "active",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });

    await db.insert(projects).values({
      id: projectId,
      companyId,
      name: "Project Alpha",
      status: "planned",
    });

    return { companyId, agentId, projectId };
  }

  it("prefers in-progress work over blocked, todo, and backlog assignments", async () => {
    const { companyId, agentId, projectId } = await seedAgentContext();
    const backlogIssueId = randomUUID();
    const todoIssueId = randomUUID();
    const blockedIssueId = randomUUID();
    const activeIssueId = randomUUID();

    await db.insert(issues).values([
      {
        id: backlogIssueId,
        companyId,
        projectId,
        title: "Backlog issue",
        status: "backlog",
        priority: "medium",
        assigneeAgentId: agentId,
        updatedAt: new Date("2026-04-05T09:00:00.000Z"),
      },
      {
        id: todoIssueId,
        companyId,
        projectId,
        title: "Todo issue",
        status: "todo",
        priority: "medium",
        assigneeAgentId: agentId,
        updatedAt: new Date("2026-04-05T10:00:00.000Z"),
      },
      {
        id: blockedIssueId,
        companyId,
        projectId,
        title: "Blocked issue",
        status: "blocked",
        priority: "medium",
        assigneeAgentId: agentId,
        updatedAt: new Date("2026-04-05T11:00:00.000Z"),
      },
      {
        id: activeIssueId,
        companyId,
        projectId,
        title: "Active issue",
        status: "in_progress",
        priority: "medium",
        assigneeAgentId: agentId,
        startedAt: new Date("2026-04-05T12:00:00.000Z"),
        updatedAt: new Date("2026-04-05T12:00:00.000Z"),
      },
    ]);

    const issue = await svc.findAgentAssignedIssue(companyId, agentId);

    expect(issue).toEqual({
      id: activeIssueId,
      projectId,
    });
  });

  it("uses a deterministic recency tie-breaker within the same active status bucket", async () => {
    const { companyId, agentId, projectId } = await seedAgentContext();
    const olderTodoIssueId = randomUUID();
    const newerTodoIssueId = randomUUID();

    await db.insert(issues).values([
      {
        id: olderTodoIssueId,
        companyId,
        projectId,
        title: "Older todo",
        status: "todo",
        priority: "medium",
        assigneeAgentId: agentId,
        updatedAt: new Date("2026-04-05T08:00:00.000Z"),
      },
      {
        id: newerTodoIssueId,
        companyId,
        projectId,
        title: "Newer todo",
        status: "todo",
        priority: "medium",
        assigneeAgentId: agentId,
        updatedAt: new Date("2026-04-05T13:00:00.000Z"),
      },
    ]);

    const issue = await svc.findAgentAssignedIssue(companyId, agentId);

    expect(issue).toEqual({
      id: newerTodoIssueId,
      projectId,
    });
  });

  it("returns null when the agent only has backlog assignments", async () => {
    const { companyId, agentId, projectId } = await seedAgentContext();

    await db.insert(issues).values({
      id: randomUUID(),
      companyId,
      projectId,
      title: "Backlog only",
      status: "backlog",
      priority: "medium",
      assigneeAgentId: agentId,
    });

    await expect(svc.findAgentAssignedIssue(companyId, agentId)).resolves.toBeNull();
  });

  it("returns null when active assigned issues do not belong to a project", async () => {
    const { companyId, agentId } = await seedAgentContext();

    await db.insert(issues).values({
      id: randomUUID(),
      companyId,
      title: "Projectless todo",
      status: "todo",
      priority: "medium",
      assigneeAgentId: agentId,
    });

    await expect(svc.findAgentAssignedIssue(companyId, agentId)).resolves.toBeNull();
  });
});
