import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import type { RequestHandler } from "express";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { activityLog, companies, createDb } from "@papierklammer/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeDB = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping company lifecycle route tests: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeDB("company lifecycle routes", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("companies-lifecycle-");
    db = createDb(tempDb.connectionString);
  }, 30_000);

  afterEach(async () => {
    await db.execute(sql`TRUNCATE TABLE companies CASCADE`);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  function createActor(overrides: Record<string, unknown> = {}) {
    return {
      type: "board",
      userId: "board-user",
      source: "local_implicit",
      companyIds: [],
      isInstanceAdmin: true,
      ...overrides,
    };
  }

  async function getRouteHandlers(
    method: "get" | "post" | "delete" | "patch",
    path: string,
  ) {
    vi.resetModules();
    const [
      { errorHandler },
      { companyRoutes },
      { companyService },
      { logActivity },
    ] = await Promise.all([
      vi.importActual<typeof import("../middleware/index.js")>("../middleware/index.js"),
      vi.importActual<typeof import("../routes/companies.js")>("../routes/companies.js"),
      vi.importActual<typeof import("../services/companies.js")>("../services/companies.js"),
      vi.importActual<typeof import("../services/activity-log.js")>("../services/activity-log.js"),
    ]);
    const router = companyRoutes(db, undefined, {
      companyService: companyService(db),
      accessService: {
        ensureMembership: async () => undefined,
      } as any,
      budgetService: {
        upsertPolicy: async () => undefined,
      } as any,
      agentService: {
        getById: async () => null,
      } as any,
      companyPortabilityService: {
        exportBundle: async () => {
          throw new Error("not implemented in companies-lifecycle test");
        },
        previewExport: async () => {
          throw new Error("not implemented in companies-lifecycle test");
        },
        previewImport: async () => {
          throw new Error("not implemented in companies-lifecycle test");
        },
        importBundle: async () => {
          throw new Error("not implemented in companies-lifecycle test");
        },
      } as any,
      logActivity,
    });
    const layer = (router as any).stack.find(
      (entry: any) => entry.route?.path === path && entry.route.methods?.[method],
    );
    if (!layer) {
      throw new Error(`Route ${method.toUpperCase()} ${path} not found`);
    }
    return {
      handlers: layer.route.stack.map((entry: any) => entry.handle as RequestHandler),
      errorHandler,
    };
  }

  async function runHandlers(
    handlers: RequestHandler[],
    req: any,
    res: any,
    index = 0,
  ): Promise<void> {
    const handler = handlers[index];
    if (!handler) return;

    await new Promise<void>((resolve, reject) => {
      let nextCalled = false;
      const next = (err?: unknown) => {
        nextCalled = true;
        if (err) {
          reject(err);
          return;
        }
        runHandlers(handlers, req, res, index + 1).then(resolve).catch(reject);
      };

      try {
        const result = handler(req, res, next as any);
        if (result && typeof (result as Promise<unknown>).then === "function") {
          (result as Promise<unknown>).then(
            () => {
              if (!nextCalled) resolve();
            },
            reject,
          );
          return;
        }
        if (!nextCalled) resolve();
      } catch (error) {
        reject(error);
      }
    });
  }

  async function callRoute(options: {
    method: "get" | "post" | "delete" | "patch";
    path: string;
    params?: Record<string, string>;
    actorOverrides?: Record<string, unknown>;
    body?: unknown;
    query?: Record<string, unknown>;
    originalUrl: string;
  }) {
    const req = {
      actor: createActor(options.actorOverrides) as any,
      body: options.body ?? {},
      params: options.params ?? {},
      query: options.query ?? {},
      method: options.method.toUpperCase(),
      originalUrl: options.originalUrl,
    } as any;
    let statusCode = 200;
    let responseBody: unknown;
    const res = {
      status(code: number) {
        statusCode = code;
        return this;
      },
      json(payload: unknown) {
        responseBody = payload;
        return this;
      },
    } as any;

    const { handlers, errorHandler } = await getRouteHandlers(options.method, options.path);

    try {
      await runHandlers(handlers, req, res);
    } catch (error) {
      errorHandler(error, req, res, (() => undefined) as any);
    }

    return { status: statusCode, body: responseBody };
  }

  async function seedCompany(input?: {
    id?: string;
    name?: string;
    status?: "active" | "paused" | "archived";
    pauseReason?: "manual" | "budget" | "system" | null;
    pausedAt?: Date | null;
  }) {
    const company = {
      id: input?.id ?? randomUUID(),
      name: input?.name ?? "Lifecycle Test Co",
      description: null,
      status: input?.status ?? "active",
      pauseReason: input?.pauseReason ?? null,
      pausedAt: input?.pausedAt ?? null,
      issuePrefix: `C${Math.random().toString(36).slice(2, 5).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    } as const;
    await db.insert(companies).values(company);
    return company;
  }

  it("pauses an active company and persists pause metadata", async () => {
    const company = await seedCompany();
    const pauseRes = await callRoute({
      method: "post",
      path: "/:companyId/pause",
      params: { companyId: company.id },
      body: {},
      originalUrl: `/api/companies/${company.id}/pause`,
    });

    expect(pauseRes.status).toBe(200);
    expect((pauseRes.body as any).status).toBe("paused");
    expect((pauseRes.body as any).pauseReason).toBe("manual");
    expect((pauseRes.body as any).pausedAt).toBeInstanceOf(Date);

    const getRes = await callRoute({
      method: "get",
      path: "/:companyId",
      params: { companyId: company.id },
      originalUrl: `/api/companies/${company.id}`,
    });
    expect(getRes.status).toBe(200);
    expect((getRes.body as any).status).toBe("paused");
    expect((getRes.body as any).pauseReason).toBe("manual");
    expect((getRes.body as any).pausedAt).toBeInstanceOf(Date);

    const entries = await db
      .select({ action: activityLog.action })
      .from(activityLog)
      .where(eq(activityLog.companyId, company.id));
    expect(entries.map((entry) => entry.action)).toContain("company.paused");
  });

  it("rejects pausing an archived company", async () => {
    const company = await seedCompany({ status: "archived" });
    const pauseRes = await callRoute({
      method: "post",
      path: "/:companyId/pause",
      params: { companyId: company.id },
      body: {},
      originalUrl: `/api/companies/${company.id}/pause`,
    });

    expect(pauseRes.status).toBe(409);
    expect((pauseRes.body as any).error).toContain("Archived companies");

    const getRes = await callRoute({
      method: "get",
      path: "/:companyId",
      params: { companyId: company.id },
      originalUrl: `/api/companies/${company.id}`,
    });
    expect(getRes.status).toBe(200);
    expect((getRes.body as any).status).toBe("archived");
  });

  it("resumes only paused companies", async () => {
    const company = await seedCompany({
      status: "paused",
      pauseReason: "manual",
      pausedAt: new Date("2026-04-08T10:00:00.000Z"),
    });
    const activeCompany = await seedCompany({ name: "Already Active" });
    const resumeRes = await callRoute({
      method: "post",
      path: "/:companyId/resume",
      params: { companyId: company.id },
      body: {},
      originalUrl: `/api/companies/${company.id}/resume`,
    });

    expect(resumeRes.status).toBe(200);
    expect((resumeRes.body as any).status).toBe("active");
    expect((resumeRes.body as any).pauseReason).toBeNull();
    expect((resumeRes.body as any).pausedAt).toBeNull();

    const invalidResumeRes = await callRoute({
      method: "post",
      path: "/:companyId/resume",
      params: { companyId: activeCompany.id },
      body: {},
      originalUrl: `/api/companies/${activeCompany.id}/resume`,
    });

    expect(invalidResumeRes.status).toBe(409);
    expect((invalidResumeRes.body as any).error).toContain("Only paused companies");
  });

  it("archives a company and keeps repeated archive calls idempotent", async () => {
    const company = await seedCompany({
      status: "paused",
      pauseReason: "manual",
      pausedAt: new Date("2026-04-08T10:00:00.000Z"),
    });
    const firstArchive = await callRoute({
      method: "post",
      path: "/:companyId/archive",
      params: { companyId: company.id },
      body: {},
      originalUrl: `/api/companies/${company.id}/archive`,
    });
    expect(firstArchive.status).toBe(200);
    expect((firstArchive.body as any).status).toBe("archived");
    expect((firstArchive.body as any).pauseReason).toBe("manual");
    expect((firstArchive.body as any).pausedAt).toBeInstanceOf(Date);

    const secondArchive = await callRoute({
      method: "post",
      path: "/:companyId/archive",
      params: { companyId: company.id },
      body: {},
      originalUrl: `/api/companies/${company.id}/archive`,
    });
    expect(secondArchive.status).toBe(200);
    expect((secondArchive.body as any).status).toBe("archived");

    const getRes = await callRoute({
      method: "get",
      path: "/:companyId",
      params: { companyId: company.id },
      originalUrl: `/api/companies/${company.id}`,
    });
    expect(getRes.status).toBe(200);
    expect((getRes.body as any).status).toBe("archived");
  });

  it("rejects delete while active", async () => {
    const company = await seedCompany();
    const deleteRes = await callRoute({
      method: "post",
      path: "/:companyId/delete",
      params: { companyId: company.id },
      body: { confirmationText: company.name },
      originalUrl: `/api/companies/${company.id}/delete`,
    });

    expect(deleteRes.status).toBe(409);

    const getRes = await callRoute({
      method: "get",
      path: "/:companyId",
      params: { companyId: company.id },
      originalUrl: `/api/companies/${company.id}`,
    });
    expect(getRes.status).toBe(200);
    expect((getRes.body as any).status).toBe("active");
  });

  it("requires exact company-name confirmation for canonical delete", async () => {
    const company = await seedCompany({
      name: "Exact Match LLC",
      status: "paused",
      pauseReason: "manual",
      pausedAt: new Date("2026-04-08T10:00:00.000Z"),
    });
    const missingConfirmation = await callRoute({
      method: "post",
      path: "/:companyId/delete",
      params: { companyId: company.id },
      body: {},
      originalUrl: `/api/companies/${company.id}/delete`,
    });
    expect(missingConfirmation.status).toBe(422);

    const mismatchedConfirmation = await callRoute({
      method: "post",
      path: "/:companyId/delete",
      params: { companyId: company.id },
      body: { confirmationText: "exact match llc" },
      originalUrl: `/api/companies/${company.id}/delete`,
    });
    expect(mismatchedConfirmation.status).toBe(422);

    const getRes = await callRoute({
      method: "get",
      path: "/:companyId",
      params: { companyId: company.id },
      originalUrl: `/api/companies/${company.id}`,
    });
    expect(getRes.status).toBe(200);
    expect((getRes.body as any).status).toBe("paused");
  });

  it("deletes a quiesced company only when the confirmation text matches exactly", async () => {
    const company = await seedCompany({
      name: "Delete Me",
      status: "archived",
    });
    const deleteRes = await callRoute({
      method: "post",
      path: "/:companyId/delete",
      params: { companyId: company.id },
      body: { confirmationText: "Delete Me" },
      originalUrl: `/api/companies/${company.id}/delete`,
    });

    expect(deleteRes.status).toBe(200);

    const getRes = await callRoute({
      method: "get",
      path: "/:companyId",
      params: { companyId: company.id },
      originalUrl: `/api/companies/${company.id}`,
    });
    expect(getRes.status).toBe(404);

    const listRes = await callRoute({
      method: "get",
      path: "/",
      originalUrl: "/api/companies",
    });
    expect(listRes.status).toBe(200);
    expect(listRes.body).toEqual([]);
  });

  it("applies the same delete safeguards to the legacy DELETE route", async () => {
    const activeCompany = await seedCompany({ name: "Legacy Active" });
    const pausedCompany = await seedCompany({
      name: "Legacy Paused",
      status: "paused",
      pauseReason: "manual",
      pausedAt: new Date("2026-04-08T10:00:00.000Z"),
    });
    const activeDelete = await callRoute({
      method: "delete",
      path: "/:companyId",
      params: { companyId: activeCompany.id },
      body: { confirmationText: activeCompany.name },
      originalUrl: `/api/companies/${activeCompany.id}`,
    });
    expect(activeDelete.status).toBe(409);

    const missingConfirmation = await callRoute({
      method: "delete",
      path: "/:companyId",
      params: { companyId: pausedCompany.id },
      body: {},
      originalUrl: `/api/companies/${pausedCompany.id}`,
    });
    expect(missingConfirmation.status).toBe(422);

    const matchedDelete = await callRoute({
      method: "delete",
      path: "/:companyId",
      params: { companyId: pausedCompany.id },
      body: { confirmationText: pausedCompany.name },
      originalUrl: `/api/companies/${pausedCompany.id}`,
    });
    expect(matchedDelete.status).toBe(200);

    const getRes = await callRoute({
      method: "get",
      path: "/:companyId",
      params: { companyId: pausedCompany.id },
      originalUrl: `/api/companies/${pausedCompany.id}`,
    });
    expect(getRes.status).toBe(404);
  });

  it("rejects lifecycle mutations from agent and wrong-company callers", async () => {
    const company = await seedCompany({
      status: "paused",
      pauseReason: "manual",
      pausedAt: new Date("2026-04-08T10:00:00.000Z"),
    });
    const agentResponses = await Promise.all([
      callRoute({
        method: "post",
        path: "/:companyId/pause",
        params: { companyId: company.id },
        actorOverrides: {
          type: "agent",
          agentId: "agent-1",
          companyId: company.id,
          source: "agent_key",
        },
        body: {},
        originalUrl: `/api/companies/${company.id}/pause`,
      }),
      callRoute({
        method: "post",
        path: "/:companyId/resume",
        params: { companyId: company.id },
        actorOverrides: {
          type: "agent",
          agentId: "agent-1",
          companyId: company.id,
          source: "agent_key",
        },
        body: {},
        originalUrl: `/api/companies/${company.id}/resume`,
      }),
      callRoute({
        method: "post",
        path: "/:companyId/archive",
        params: { companyId: company.id },
        actorOverrides: {
          type: "agent",
          agentId: "agent-1",
          companyId: company.id,
          source: "agent_key",
        },
        body: {},
        originalUrl: `/api/companies/${company.id}/archive`,
      }),
      callRoute({
        method: "post",
        path: "/:companyId/delete",
        params: { companyId: company.id },
        actorOverrides: {
          type: "agent",
          agentId: "agent-1",
          companyId: company.id,
          source: "agent_key",
        },
        body: { confirmationText: company.name },
        originalUrl: `/api/companies/${company.id}/delete`,
      }),
    ]);
    for (const response of agentResponses) {
      expect(response.status).toBe(403);
    }

    const wrongCompanyResponse = await callRoute({
      method: "post",
      path: "/:companyId/pause",
      params: { companyId: company.id },
      actorOverrides: {
        source: "session",
        isInstanceAdmin: false,
        companyIds: ["another-company"],
      },
      body: {},
      originalUrl: `/api/companies/${company.id}/pause`,
    });
    expect(wrongCompanyResponse.status).toBe(403);
  });

  it("rejects lifecycle status changes through generic company patch", async () => {
    const company = await seedCompany();
    const patchRes = await callRoute({
      method: "patch",
      path: "/:companyId",
      params: { companyId: company.id },
      body: { status: "paused" },
      originalUrl: `/api/companies/${company.id}`,
    });

    expect(patchRes.status).toBe(400);
    expect((patchRes.body as any).error).toBe("Validation error");

    const getRes = await callRoute({
      method: "get",
      path: "/:companyId",
      params: { companyId: company.id },
      originalUrl: `/api/companies/${company.id}`,
    });
    expect(getRes.status).toBe(200);
    expect((getRes.body as any).status).toBe("active");
  });
});
