import { afterEach, describe, expect, it, vi } from "vitest";
// @ts-expect-error test-only import of untyped ESM launcher helper
import { resolveLaunchConfig } from "../../../../scripts/dev-tui-utils.mjs";

describe("launcher readiness", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("fails with an actionable message when no companies exist", async () => {
    const fetchMock = vi.fn().mockImplementation(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/api/health")) {
        return {
          ok: true,
          json: async () => ({ status: "ok", deploymentMode: "local_trusted" }),
        };
      }

      if (url.endsWith("/api/companies")) {
        return {
          ok: true,
          json: async () => [],
        };
      }

      throw new Error(`Unexpected URL: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    await expect(
      resolveLaunchConfig({
        url: "http://127.0.0.1:3101",
        waitTimeoutMs: 5,
      }),
    ).rejects.toThrow(
      "No companies found. Create a company first, then launch the orchestrator TUI.",
    );
  });

  it("auto-selects the only company and returns its label", async () => {
    const fetchMock = vi.fn().mockImplementation(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/api/health")) {
        return {
          ok: true,
          json: async () => ({ status: "ok", deploymentMode: "local_trusted" }),
        };
      }

      if (url.endsWith("/api/companies")) {
        return {
          ok: true,
          json: async () => [
            {
              id: "audit-company",
              name: "Audit Co",
              updatedAt: "2026-04-04T00:00:00.000Z",
            },
          ],
        };
      }

      throw new Error(`Unexpected URL: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    await expect(
      resolveLaunchConfig({
        url: "http://127.0.0.1:3100",
        waitTimeoutMs: 5,
      }),
    ).resolves.toMatchObject({
      baseUrl: "http://127.0.0.1:3100",
      companyId: "audit-company",
      companyName: "Audit Co",
    });
  });
});
