import { afterEach, describe, expect, it, vi } from "vitest";
// @ts-expect-error test-only import of untyped ESM launcher helper
import { resolveLaunchConfig } from "../../../../scripts/dev-tui-utils.mjs";
// @ts-expect-error test-only import of untyped ESM launcher helper
import { buildTuiCommand } from "../../../../scripts/dev-with-tui.mjs";

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
        apiKey: "board-api-key",
        waitTimeoutMs: 5,
      }),
    ).resolves.toMatchObject({
      baseUrl: "http://127.0.0.1:3100",
      apiKey: "board-api-key",
      companyId: "audit-company",
      companyName: "Audit Co",
    });
  });

  it("falls back to the picker when an env preset company id is invalid", async () => {
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
            {
              id: "second-company",
              name: "Second Co",
              updatedAt: "2026-04-03T00:00:00.000Z",
            },
          ],
        };
      }

      throw new Error(`Unexpected URL: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("PAPIERKLAMMER_TUI_COMPANY_ID", "missing-company");

    await expect(
      resolveLaunchConfig({
        url: "http://127.0.0.1:3100",
        waitTimeoutMs: 5,
      }),
    ).resolves.toMatchObject({
      baseUrl: "http://127.0.0.1:3100",
      companyId: "",
      companyName: "",
    });
  });

  it("rejects an explicit invalid company id with an actionable error", async () => {
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
        companyId: "missing-company",
        waitTimeoutMs: 5,
      }),
    ).rejects.toThrow(
      "Company missing-company was not found. Choose a valid --company-id or omit it to use automatic selection.",
    );
  });

  it("embeds the resolved launch context directly into the auto-open command", () => {
    const command = buildTuiCommand({
      baseUrl: "http://127.0.0.1:3100",
      apiKey: "board-api-key",
      companyId: "audit-company",
      companyName: "Audit Co",
    });

    expect(command).toContain(
      "PAPIERKLAMMER_TUI_URL='http://127.0.0.1:3100' PAPIERKLAMMER_TUI_API_KEY='board-api-key' PAPIERKLAMMER_TUI_COMPANY_NAME='Audit Co' PAPIERKLAMMER_TUI_COMPANY_ID='audit-company' pnpm dev:tui",
    );
    expect(command).not.toContain("PAPIERKLAMMER_TUI_URL='http://127.0.0.1:3100' &&");
    expect(command).toContain("Press Enter to close...");
  });
});
