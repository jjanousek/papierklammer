/**
 * HTTP client for the Papierklammer Orchestrator API.
 *
 * Wraps fetch for /api/orchestrator/* endpoints.
 * Auth via Bearer token (API key).
 * Base URL configurable via constructor or environment.
 */

export interface OrchestratorClientOptions {
  baseUrl: string;
  apiKey: string;
}

export class AuthenticationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthenticationError";
  }
}

export class ApiError extends Error {
  status: number;
  body?: unknown;

  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

export class OrchestratorClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(options: OrchestratorClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.apiKey = options.apiKey;
  }

  async get<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: "GET" });
  }

  async post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, {
      method: "POST",
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  }

  async patch<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, {
      method: "PATCH",
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  }

  async delete<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: "DELETE" });
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const url = `${this.baseUrl}${path}`;

    const headers: Record<string, string> = {
      accept: "application/json",
      authorization: `Bearer ${this.apiKey}`,
    };

    if (init.body !== undefined) {
      headers["content-type"] = "application/json";
    }

    const response = await fetch(url, {
      ...init,
      headers,
    });

    if (response.status === 401) {
      throw new AuthenticationError(
        "Authentication failed. Check your API key (--api-key or PAPIERKLAMMER_API_KEY).",
      );
    }

    if (!response.ok) {
      const text = await response.text();
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }

      const message =
        typeof body === "object" && body !== null && "error" in body
          ? String((body as Record<string, unknown>).error)
          : `Request failed with status ${response.status}`;

      throw new ApiError(response.status, message, body);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    const text = await response.text();
    if (!text.trim()) {
      return undefined as T;
    }

    return JSON.parse(text) as T;
  }
}
