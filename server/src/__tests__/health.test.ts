import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Db } from "@papierklammer/db";
import { healthRoutes } from "../routes/health.js";
import * as devServerStatus from "../dev-server-status.js";
import { serverVersion } from "../version.js";

function getHealthHandler(db?: Db) {
  const router = healthRoutes(db) as unknown as {
    stack?: Array<{
      route?: {
        path?: string;
        stack?: Array<{ handle: (req: unknown, res: unknown) => Promise<void> | void }>;
      };
    }>;
  };
  const layer = router.stack?.find((entry) => entry.route?.path === "/");
  const handler = layer?.route?.stack?.[0]?.handle;
  if (!handler) {
    throw new Error("Expected GET / health handler to be registered");
  }
  return handler;
}

function createResponseCapture() {
  return {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
}

describe("GET /health", () => {
  beforeEach(() => {
    vi.spyOn(devServerStatus, "readPersistedDevServerStatus").mockReturnValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 200 with status ok", async () => {
    const handler = getHealthHandler();
    const res = createResponseCapture();

    await handler({}, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ status: "ok", version: serverVersion });
  });

  it("returns 200 when the database probe succeeds", async () => {
    const db = {
      execute: vi.fn().mockResolvedValue([{ "?column?": 1 }]),
    } as unknown as Db;
    const handler = getHealthHandler(db);
    const res = createResponseCapture();

    await handler({}, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ status: "ok", version: serverVersion });
  });

  it("returns 503 when the database probe fails", async () => {
    const db = {
      execute: vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED")),
    } as unknown as Db;
    const handler = getHealthHandler(db);
    const res = createResponseCapture();

    await handler({}, res);

    expect(res.statusCode).toBe(503);
    expect(res.body).toEqual({
      status: "unhealthy",
      version: serverVersion,
      error: "database_unreachable",
    });
  });
});
