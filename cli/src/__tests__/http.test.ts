import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiConnectionError, ApiRequestError, PapierklammerApiClient } from "../client/http.js";

describe("PapierklammerApiClient", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("adds authorization, run-id, and trace headers", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new PapierklammerApiClient({
      apiBase: "http://localhost:3100",
      apiKey: "token-123",
      runId: "run-abc",
    });

    await client.post("/api/test", { hello: "world" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(call[0]).toContain("/api/test");

    const headers = call[1].headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer token-123");
    expect(headers["x-papierklammer-run-id"]).toBe("run-abc");
    expect(headers["x-papierklammer-trace-id"]).toBe("run-abc");
    expect(headers["content-type"]).toBe("application/json");
  });

  it("adds a generated trace header even when no run id is present", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new PapierklammerApiClient({
      apiBase: "http://localhost:3100",
    });

    await client.post("/api/test", { hello: "world" });

    const call = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = call[1].headers as Record<string, string>;

    expect(headers["x-papierklammer-run-id"]).toBeUndefined();
    expect(headers["x-papierklammer-trace-id"]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it("returns null on ignoreNotFound", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "Not found" }), { status: 404 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new PapierklammerApiClient({ apiBase: "http://localhost:3100" });
    const result = await client.get("/api/missing", { ignoreNotFound: true });
    expect(result).toBeNull();
  });

  it("throws ApiRequestError with details", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ error: "Issue checkout conflict", details: { issueId: "1" } }),
        { status: 409 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new PapierklammerApiClient({ apiBase: "http://localhost:3100" });

    await expect(client.post("/api/issues/1/checkout", {})).rejects.toMatchObject({
      status: 409,
      message: "Issue checkout conflict",
      details: { issueId: "1" },
    } satisfies Partial<ApiRequestError>);
  });

  it("throws ApiConnectionError with recovery guidance when fetch fails", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    vi.stubGlobal("fetch", fetchMock);

    const client = new PapierklammerApiClient({ apiBase: "http://localhost:3100" });

    await expect(client.post("/api/companies/import/preview", {})).rejects.toBeInstanceOf(ApiConnectionError);
    await expect(client.post("/api/companies/import/preview", {})).rejects.toMatchObject({
      url: "http://localhost:3100/api/companies/import/preview",
      method: "POST",
      causeMessage: "fetch failed",
    } satisfies Partial<ApiConnectionError>);
    await expect(client.post("/api/companies/import/preview", {})).rejects.toThrow(
      /Could not reach the Papierklammer API\./,
    );
    await expect(client.post("/api/companies/import/preview", {})).rejects.toThrow(
      /curl http:\/\/localhost:3100\/api\/health/,
    );
    await expect(client.post("/api/companies/import/preview", {})).rejects.toThrow(
      /pnpm dev|pnpm papierklammer run/,
    );
  });

  it("retries once after interactive auth recovery", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "Board access required" }), { status: 403 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const recoverAuth = vi.fn().mockResolvedValue("board-token-123");
    const client = new PapierklammerApiClient({
      apiBase: "http://localhost:3100",
      recoverAuth,
    });

    const result = await client.post<{ ok: boolean }>("/api/test", { hello: "world" });

    expect(result).toEqual({ ok: true });
    expect(recoverAuth).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const retryHeaders = fetchMock.mock.calls[1]?.[1]?.headers as Record<string, string>;
    expect(retryHeaders.authorization).toBe("Bearer board-token-123");
  });
});
