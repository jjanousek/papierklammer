import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  OrchestratorClient,
  AuthenticationError,
  ApiError,
} from "../client.js";

describe("OrchestratorClient", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function mockFetch(response: {
    ok: boolean;
    status: number;
    body?: unknown;
    text?: string;
  }) {
    const fn = vi.fn().mockResolvedValue({
      ok: response.ok,
      status: response.status,
      text: () =>
        Promise.resolve(
          response.text ?? JSON.stringify(response.body ?? ""),
        ),
    });
    globalThis.fetch = fn;
    return fn;
  }

  it("sends GET request with auth header", async () => {
    const fetchMock = mockFetch({
      ok: true,
      status: 200,
      body: { data: "test" },
    });

    const client = new OrchestratorClient({
      baseUrl: "http://localhost:3100",
      apiKey: "test-key",
    });

    const result = await client.get("/api/orchestrator/status");

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:3100/api/orchestrator/status");
    expect(init.method).toBe("GET");
    expect(init.headers.authorization).toBe("Bearer test-key");
    expect(result).toEqual({ data: "test" });
  });

  it("sends POST request with JSON body", async () => {
    const fetchMock = mockFetch({
      ok: true,
      status: 201,
      body: { id: "abc" },
    });

    const client = new OrchestratorClient({
      baseUrl: "http://localhost:3100",
      apiKey: "test-key",
    });

    const result = await client.post("/api/orchestrator/issues", {
      title: "test",
    });

    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe("POST");
    expect(init.headers["content-type"]).toBe("application/json");
    expect(init.body).toBe(JSON.stringify({ title: "test" }));
    expect(result).toEqual({ id: "abc" });
  });

  it("sends PATCH request", async () => {
    const fetchMock = mockFetch({
      ok: true,
      status: 200,
      body: { id: "abc", priority: "high" },
    });

    const client = new OrchestratorClient({
      baseUrl: "http://localhost:3100",
      apiKey: "test-key",
    });

    await client.patch("/api/orchestrator/issues/abc/priority", {
      priority: "high",
    });

    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe("PATCH");
  });

  it("sends DELETE request", async () => {
    const fetchMock = mockFetch({
      ok: true,
      status: 200,
      body: { cancelled: 3 },
    });

    const client = new OrchestratorClient({
      baseUrl: "http://localhost:3100",
      apiKey: "test-key",
    });

    const result = await client.delete("/api/orchestrator/stale/runs");

    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe("DELETE");
    expect(result).toEqual({ cancelled: 3 });
  });

  it("throws AuthenticationError on 401", async () => {
    mockFetch({
      ok: false,
      status: 401,
      body: { error: "Unauthorized" },
    });

    const client = new OrchestratorClient({
      baseUrl: "http://localhost:3100",
      apiKey: "bad-key",
    });

    await expect(client.get("/api/orchestrator/status")).rejects.toThrow(
      AuthenticationError,
    );
  });

  it("throws ApiError on non-ok response", async () => {
    mockFetch({
      ok: false,
      status: 404,
      body: { error: "Not found" },
    });

    const client = new OrchestratorClient({
      baseUrl: "http://localhost:3100",
      apiKey: "test-key",
    });

    await expect(client.get("/api/orchestrator/issues/bad")).rejects.toThrow(
      ApiError,
    );

    try {
      await client.get("/api/orchestrator/issues/bad");
    } catch (err) {
      expect((err as ApiError).status).toBe(404);
      expect((err as ApiError).message).toBe("Not found");
    }
  });

  it("strips trailing slashes from base URL", async () => {
    const fetchMock = mockFetch({
      ok: true,
      status: 200,
      body: {},
    });

    const client = new OrchestratorClient({
      baseUrl: "http://localhost:3100///",
      apiKey: "test-key",
    });

    await client.get("/api/test");
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:3100/api/test");
  });

  it("handles 204 no-content response", async () => {
    mockFetch({ ok: true, status: 204, text: "" });

    const client = new OrchestratorClient({
      baseUrl: "http://localhost:3100",
      apiKey: "test-key",
    });

    const result = await client.delete("/api/test");
    expect(result).toBeUndefined();
  });
});
