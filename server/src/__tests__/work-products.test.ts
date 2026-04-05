import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  activityLog,
  agents,
  companies,
  createDb,
  heartbeatRuns,
  issueComments,
  issueWorkProducts,
  issues,
} from "@papierklammer/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { deriveIssueWorkProductsFromComments, workProductService } from "../services/work-products.ts";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres work product tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

function createWorkProductRow(overrides: Partial<Record<string, unknown>> = {}) {
  const now = new Date("2026-03-17T00:00:00.000Z");
  return {
    id: "work-product-1",
    companyId: "company-1",
    projectId: "project-1",
    issueId: "issue-1",
    executionWorkspaceId: null,
    runtimeServiceId: null,
    type: "pull_request",
    provider: "github",
    externalId: null,
    title: "PR 1",
    url: "https://example.com/pr/1",
    status: "open",
    reviewState: "draft",
    isPrimary: true,
    healthStatus: "unknown",
    summary: null,
    metadata: null,
    createdByRunId: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("workProductService", () => {
  it("uses a transaction when creating a new primary work product", async () => {
    const updatedWhere = vi.fn(async () => undefined);
    const updateSet = vi.fn(() => ({ where: updatedWhere }));
    const txUpdate = vi.fn(() => ({ set: updateSet }));

    const insertedRow = createWorkProductRow();
    const insertReturning = vi.fn(async () => [insertedRow]);
    const insertValues = vi.fn(() => ({ returning: insertReturning }));
    const txInsert = vi.fn(() => ({ values: insertValues }));

    const tx = {
      update: txUpdate,
      insert: txInsert,
    };
    const transaction = vi.fn(async (callback: (input: typeof tx) => Promise<unknown>) => await callback(tx));

    const svc = workProductService({ transaction } as any);
    const result = await svc.createForIssue("issue-1", "company-1", {
      type: "pull_request",
      provider: "github",
      title: "PR 1",
      status: "open",
      reviewState: "draft",
      isPrimary: true,
    });

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(txUpdate).toHaveBeenCalledTimes(1);
    expect(txInsert).toHaveBeenCalledTimes(1);
    expect(result?.id).toBe("work-product-1");
  });

  it("uses a transaction when promoting an existing work product to primary", async () => {
    const existingRow = createWorkProductRow({ isPrimary: false });

    const selectWhere = vi.fn(async () => [existingRow]);
    const selectFrom = vi.fn(() => ({ where: selectWhere }));
    const txSelect = vi.fn(() => ({ from: selectFrom }));

    const updateReturning = vi
      .fn()
      .mockResolvedValue([createWorkProductRow({ reviewState: "ready_for_review" })]);
    const updateWhere = vi.fn(() => ({ returning: updateReturning }));
    const updateSet = vi.fn(() => ({ where: updateWhere }));
    const txUpdate = vi.fn(() => ({ set: updateSet }));

    const tx = {
      select: txSelect,
      update: txUpdate,
    };
    const transaction = vi.fn(async (callback: (input: typeof tx) => Promise<unknown>) => await callback(tx));

    const svc = workProductService({ transaction } as any);
    const result = await svc.update("work-product-1", {
      isPrimary: true,
      reviewState: "ready_for_review",
    });

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(txSelect).toHaveBeenCalledTimes(1);
    expect(txUpdate).toHaveBeenCalledTimes(2);
    expect(result?.reviewState).toBe("ready_for_review");
  });
});

describe("deriveIssueWorkProductsFromComments", () => {
  it("derives artifact work products from completed run comments", () => {
    const products = deriveIssueWorkProductsFromComments([
      {
        commentId: "comment-1",
        companyId: "company-1",
        issueId: "issue-1",
        projectId: "project-1",
        body: [
          "Validation Complete",
          "",
          "- workspace root `/Users/aischool/work/papierklammer-audit-demo`",
          "- command `pnpm smoke`",
          "- result `AUDIT_DEMO_OK`",
          "- artifact path `/Users/aischool/work/papierklammer-audit-demo/artifacts/latest-report.json`",
          "- SHA256 `0dab1df3b910f9f31547df45a5838907dd10468aab4a9315da361b6c75190aa2`",
          "- tasks `3`",
        ].join("\n"),
        createdAt: new Date("2026-04-05T09:02:00.000Z"),
        runId: "run-1",
        runStatus: "succeeded",
        runFinishedAt: new Date("2026-04-05T09:01:00.000Z"),
      },
    ]);

    expect(products).toHaveLength(1);
    expect(products[0]).toEqual(
      expect.objectContaining({
        companyId: "company-1",
        issueId: "issue-1",
        projectId: "project-1",
        createdByRunId: "run-1",
        type: "artifact",
        provider: "paperclip",
        status: "ready_for_review",
        reviewState: "needs_board_review",
        isPrimary: true,
        healthStatus: "healthy",
        title: "latest-report.json",
        summary:
          "AUDIT_DEMO_OK · /Users/aischool/work/papierklammer-audit-demo/artifacts/latest-report.json",
        metadata: expect.objectContaining({
          path: "/Users/aischool/work/papierklammer-audit-demo/artifacts/latest-report.json",
          workspace: "/Users/aischool/work/papierklammer-audit-demo",
          command: "pnpm smoke",
          tasks: 3,
          sha256: "0dab1df3b910f9f31547df45a5838907dd10468aab4a9315da361b6c75190aa2",
          sourceCommentId: "comment-1",
          derivedFrom: "issue_comment",
        }),
      }),
    );
  });
});

describeEmbeddedPostgres("workProductService.listForIssue derived comment artifacts", () => {
  let db!: ReturnType<typeof createDb>;
  let svc!: ReturnType<typeof workProductService>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-work-products-");
    db = createDb(tempDb.connectionString);
    svc = workProductService(db);
  }, 20_000);

  afterEach(async () => {
    await db.delete(activityLog);
    await db.delete(issueComments);
    await db.delete(issueWorkProducts);
    await db.delete(heartbeatRuns);
    await db.delete(issues);
    await db.delete(agents);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seedCompletedIssueWithArtifactComment() {
    const companyId = randomUUID();
    const agentId = randomUUID();
    const issueId = randomUUID();
    const runId = randomUUID();
    const commentId = randomUUID();

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });

    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "Audit CTO",
      role: "engineer",
      status: "active",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });

    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Run the demo audit smoke task",
      status: "done",
      priority: "medium",
      assigneeAgentId: agentId,
      completedAt: new Date("2026-04-05T09:03:00.000Z"),
    });

    await db.insert(heartbeatRuns).values({
      id: runId,
      companyId,
      agentId,
      status: "succeeded",
      invocationSource: "manual",
      startedAt: new Date("2026-04-05T09:00:00.000Z"),
      finishedAt: new Date("2026-04-05T09:01:00.000Z"),
    });

    await db.insert(issueComments).values({
      id: commentId,
      companyId,
      issueId,
      authorAgentId: agentId,
      body: [
        "Validation Complete",
        "",
        "- workspace root `/Users/aischool/work/papierklammer-audit-demo`",
        "- command `pnpm smoke`",
        "- result `AUDIT_DEMO_OK`",
        "- artifact path `/Users/aischool/work/papierklammer-audit-demo/artifacts/latest-report.json`",
        "- SHA256 `0dab1df3b910f9f31547df45a5838907dd10468aab4a9315da361b6c75190aa2`",
      ].join("\n"),
    });

    await db.insert(activityLog).values({
      companyId,
      actorType: "agent",
      actorId: agentId,
      action: "issue.comment_added",
      entityType: "issue",
      entityId: issueId,
      agentId,
      runId,
      details: {
        commentId,
      },
    });

    return { companyId, issueId, runId };
  }

  it("returns derived artifact work products for completed demo comments", async () => {
    const { companyId, issueId, runId } = await seedCompletedIssueWithArtifactComment();

    const products = await svc.listForIssue({
      id: issueId,
      companyId,
      projectId: null,
    });

    expect(products).toHaveLength(1);
    expect(products[0]).toEqual(
      expect.objectContaining({
        issueId,
        companyId,
        createdByRunId: runId,
        type: "artifact",
        title: "latest-report.json",
        reviewState: "needs_board_review",
        metadata: expect.objectContaining({
          path: "/Users/aischool/work/papierklammer-audit-demo/artifacts/latest-report.json",
          workspace: "/Users/aischool/work/papierklammer-audit-demo",
          sha256: "0dab1df3b910f9f31547df45a5838907dd10468aab4a9315da361b6c75190aa2",
        }),
      }),
    );
  });

  it("does not duplicate a persisted artifact that already matches the completion comment", async () => {
    const { companyId, issueId, runId } = await seedCompletedIssueWithArtifactComment();
    const persistedId = randomUUID();

    await db.insert(issueWorkProducts).values({
      id: persistedId,
      companyId,
      issueId,
      type: "artifact",
      provider: "paperclip",
      title: "latest-report.json",
      status: "ready_for_review",
      reviewState: "needs_board_review",
      isPrimary: true,
      healthStatus: "healthy",
      summary:
        "AUDIT_DEMO_OK · /Users/aischool/work/papierklammer-audit-demo/artifacts/latest-report.json",
      metadata: {
        path: "/Users/aischool/work/papierklammer-audit-demo/artifacts/latest-report.json",
      },
      createdByRunId: runId,
    });

    const products = await svc.listForIssue({
      id: issueId,
      companyId,
      projectId: null,
    });

    expect(products).toHaveLength(1);
    expect(products[0]?.id).toBe(persistedId);
  });
});
