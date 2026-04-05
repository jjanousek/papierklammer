import { describe, expect, it, vi } from "vitest";
import { boardMutationGuard } from "../middleware/board-mutation-guard.js";

function runGuard(options: {
  method?: string;
  actor?: Record<string, unknown>;
  headers?: Record<string, string | undefined>;
}) {
  const middleware = boardMutationGuard();
  const headerMap = new Map<string, string>();
  for (const [key, value] of Object.entries(options.headers ?? {})) {
    if (value !== undefined) {
      headerMap.set(key.toLowerCase(), value);
    }
  }
  const req = {
    method: options.method ?? "POST",
    actor: options.actor ?? { type: "board", userId: "board", source: "session" },
    header(name: string) {
      return headerMap.get(name.toLowerCase());
    },
  } as any;
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
  } as any;
  const next = vi.fn();

  middleware(req, res, next);
  return { req, res, next };
}

describe("boardMutationGuard", () => {
  it("allows safe methods for board actor", () => {
    const { res, next } = runGuard({ method: "GET" });
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("blocks board mutations without trusted origin", () => {
    const { res, next } = runGuard({});
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      error: "Board mutation requires trusted browser origin",
    });
  });

  it("allows local implicit board mutations without origin", () => {
    const { res, next } = runGuard({
      actor: { type: "board", userId: "board", source: "local_implicit" },
    });
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("allows board bearer-key mutations without origin", () => {
    const { res, next } = runGuard({
      actor: { type: "board", userId: "board", source: "board_key" },
    });
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("allows board mutations from trusted origin", () => {
    const { res, next } = runGuard({
      headers: { origin: "http://localhost:3100" },
    });
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("allows board mutations from trusted referer origin", () => {
    const { res, next } = runGuard({
      headers: { referer: "http://localhost:3100/issues/abc" },
    });
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("allows board mutations when x-forwarded-host matches origin", () => {
    const { res, next } = runGuard({
      headers: {
        host: "127.0.0.1",
        "x-forwarded-host": "10.90.10.20:3443",
        origin: "https://10.90.10.20:3443",
      },
    });
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("blocks board mutations when x-forwarded-host does not match origin", () => {
    const { res, next } = runGuard({
      headers: {
        host: "127.0.0.1",
        "x-forwarded-host": "10.90.10.20:3443",
        origin: "https://evil.example.com",
      },
    });
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("does not block authenticated agent mutations", () => {
    const { res, next } = runGuard({
      actor: { type: "agent", agentId: "agent-1" },
    });
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });
});
