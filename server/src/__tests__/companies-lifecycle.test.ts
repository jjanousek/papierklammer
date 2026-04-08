import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { activityLog, companies, createDb } from "@papierklammer/db";
import { errorHandler } from "../middleware/index.js";
import { companyRoutes } from "../routes/companies.js";
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

  function createApp(actorOverrides: Record<string, unknown> = {}) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.actor = createActor(actorOverrides) as typeof req.actor;
      next();
    });
    app.use("/api/companies", companyRoutes(db));
    app.use(errorHandler);
    return app;
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
    const app = createApp();

    const pauseRes = await request(app)
      .post(`/api/companies/${company.id}/pause`)
      .send({});

    expect(pauseRes.status).toBe(200);
    expect(pauseRes.body.status).toBe("paused");
    expect(pauseRes.body.pauseReason).toBe("manual");
    expect(pauseRes.body.pausedAt).toEqual(expect.any(String));

    const getRes = await request(app).get(`/api/companies/${company.id}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.status).toBe("paused");
    expect(getRes.body.pauseReason).toBe("manual");
    expect(getRes.body.pausedAt).toEqual(expect.any(String));

    const entries = await db
      .select({ action: activityLog.action })
      .from(activityLog)
      .where(eq(activityLog.companyId, company.id));
    expect(entries.map((entry) => entry.action)).toContain("company.paused");
  });

  it("rejects pausing an archived company", async () => {
    const company = await seedCompany({ status: "archived" });
    const app = createApp();

    const pauseRes = await request(app)
      .post(`/api/companies/${company.id}/pause`)
      .send({});

    expect(pauseRes.status).toBe(409);
    expect(pauseRes.body.error).toContain("Archived companies");

    const getRes = await request(app).get(`/api/companies/${company.id}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.status).toBe("archived");
  });

  it("resumes only paused companies", async () => {
    const company = await seedCompany({
      status: "paused",
      pauseReason: "manual",
      pausedAt: new Date("2026-04-08T10:00:00.000Z"),
    });
    const activeCompany = await seedCompany({ name: "Already Active" });
    const app = createApp();

    const resumeRes = await request(app)
      .post(`/api/companies/${company.id}/resume`)
      .send({});

    expect(resumeRes.status).toBe(200);
    expect(resumeRes.body.status).toBe("active");
    expect(resumeRes.body.pauseReason).toBeNull();
    expect(resumeRes.body.pausedAt).toBeNull();

    const invalidResumeRes = await request(app)
      .post(`/api/companies/${activeCompany.id}/resume`)
      .send({});

    expect(invalidResumeRes.status).toBe(409);
    expect(invalidResumeRes.body.error).toContain("Only paused companies");
  });

  it("archives a company and keeps repeated archive calls idempotent", async () => {
    const company = await seedCompany({
      status: "paused",
      pauseReason: "manual",
      pausedAt: new Date("2026-04-08T10:00:00.000Z"),
    });
    const app = createApp();

    const firstArchive = await request(app)
      .post(`/api/companies/${company.id}/archive`)
      .send({});
    expect(firstArchive.status).toBe(200);
    expect(firstArchive.body.status).toBe("archived");
    expect(firstArchive.body.pauseReason).toBeNull();
    expect(firstArchive.body.pausedAt).toBeNull();

    const secondArchive = await request(app)
      .post(`/api/companies/${company.id}/archive`)
      .send({});
    expect(secondArchive.status).toBe(200);
    expect(secondArchive.body.status).toBe("archived");

    const getRes = await request(app).get(`/api/companies/${company.id}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.status).toBe("archived");
  });

  it("rejects delete while active", async () => {
    const company = await seedCompany();
    const app = createApp();

    const deleteRes = await request(app)
      .post(`/api/companies/${company.id}/delete`)
      .send({ confirmationText: company.name });

    expect(deleteRes.status).toBe(409);

    const getRes = await request(app).get(`/api/companies/${company.id}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.status).toBe("active");
  });

  it("requires exact company-name confirmation for canonical delete", async () => {
    const company = await seedCompany({
      name: "Exact Match LLC",
      status: "paused",
      pauseReason: "manual",
      pausedAt: new Date("2026-04-08T10:00:00.000Z"),
    });
    const app = createApp();

    const missingConfirmation = await request(app)
      .post(`/api/companies/${company.id}/delete`)
      .send({});
    expect(missingConfirmation.status).toBe(422);

    const mismatchedConfirmation = await request(app)
      .post(`/api/companies/${company.id}/delete`)
      .send({ confirmationText: "exact match llc" });
    expect(mismatchedConfirmation.status).toBe(422);

    const getRes = await request(app).get(`/api/companies/${company.id}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.status).toBe("paused");
  });

  it("deletes a quiesced company only when the confirmation text matches exactly", async () => {
    const company = await seedCompany({
      name: "Delete Me",
      status: "archived",
    });
    const app = createApp();

    const deleteRes = await request(app)
      .post(`/api/companies/${company.id}/delete`)
      .send({ confirmationText: "Delete Me" });

    expect(deleteRes.status).toBe(200);

    const getRes = await request(app).get(`/api/companies/${company.id}`);
    expect(getRes.status).toBe(404);

    const listRes = await request(app).get("/api/companies");
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
    const app = createApp();

    const activeDelete = await request(app)
      .delete(`/api/companies/${activeCompany.id}`)
      .send({ confirmationText: activeCompany.name });
    expect(activeDelete.status).toBe(409);

    const missingConfirmation = await request(app)
      .delete(`/api/companies/${pausedCompany.id}`)
      .send({});
    expect(missingConfirmation.status).toBe(422);

    const matchedDelete = await request(app)
      .delete(`/api/companies/${pausedCompany.id}`)
      .send({ confirmationText: pausedCompany.name });
    expect(matchedDelete.status).toBe(200);

    const getRes = await request(app).get(`/api/companies/${pausedCompany.id}`);
    expect(getRes.status).toBe(404);
  });

  it("rejects lifecycle mutations from agent and wrong-company callers", async () => {
    const company = await seedCompany({
      status: "paused",
      pauseReason: "manual",
      pausedAt: new Date("2026-04-08T10:00:00.000Z"),
    });
    const agentApp = createApp({
      type: "agent",
      agentId: "agent-1",
      companyId: company.id,
      source: "agent_key",
    });
    const wrongCompanyBoardApp = createApp({
      source: "session",
      isInstanceAdmin: false,
      companyIds: ["another-company"],
    });

    const agentResponses = await Promise.all([
      request(agentApp).post(`/api/companies/${company.id}/pause`).send({}),
      request(agentApp).post(`/api/companies/${company.id}/resume`).send({}),
      request(agentApp).post(`/api/companies/${company.id}/archive`).send({}),
      request(agentApp).post(`/api/companies/${company.id}/delete`).send({ confirmationText: company.name }),
    ]);
    for (const response of agentResponses) {
      expect(response.status).toBe(403);
    }

    const wrongCompanyResponse = await request(wrongCompanyBoardApp)
      .post(`/api/companies/${company.id}/pause`)
      .send({});
    expect(wrongCompanyResponse.status).toBe(403);
  });

  it("rejects lifecycle status changes through generic company patch", async () => {
    const company = await seedCompany();
    const app = createApp();

    const patchRes = await request(app)
      .patch(`/api/companies/${company.id}`)
      .send({ status: "paused" });

    expect(patchRes.status).toBe(400);
    expect(patchRes.body.error).toBe("Validation error");

    const getRes = await request(app).get(`/api/companies/${company.id}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.status).toBe("active");
  });
});
