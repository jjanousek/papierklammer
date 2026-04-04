import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockResolveLaunchConfig, mockSpawn } = vi.hoisted(() => ({
  mockResolveLaunchConfig: vi.fn(),
  mockSpawn: vi.fn(),
}));

vi.mock("node:child_process", async (importOriginal) => {
  const cp = await importOriginal<typeof import("node:child_process")>();
  return {
    ...cp,
    spawn: (...args: Parameters<typeof cp.spawn>) => mockSpawn(...args) as ReturnType<typeof cp.spawn>,
  };
});

vi.mock("../../../../scripts/dev-tui-utils.mjs", async (importOriginal) => {
  const mod = (await importOriginal()) as Record<string, unknown>;
  return {
    ...mod,
    resolveLaunchConfig: (...args: unknown[]) => mockResolveLaunchConfig(...args),
  };
});

function createChild(exitCode = 0): ChildProcess {
  const child = new EventEmitter() as ChildProcess;
  Object.assign(child, {
    killed: false,
    kill: vi.fn(),
  });
  queueMicrotask(() => {
    child.emit("exit", exitCode, null);
  });
  return child;
}

describe("dev-tui spawn env", () => {
  beforeEach(() => {
    mockResolveLaunchConfig.mockReset();
    mockSpawn.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("sanitizes stale preset company env when the launcher falls back to the picker", async () => {
    mockResolveLaunchConfig.mockResolvedValue({
      baseUrl: "http://127.0.0.1:3100",
      apiKey: "",
      companyId: "",
      companyName: "",
    });
    mockSpawn.mockImplementation(() => createChild());
    vi.stubEnv("PAPIERKLAMMER_TUI_COMPANY_ID", "missing-company");
    vi.stubEnv("PAPIERKLAMMER_TUI_COMPANY_NAME", "Ghost Co");

    // @ts-expect-error test-only import of untyped ESM launcher helper
    const { main } = await import("../../../../scripts/dev-tui.mjs");
    const exitCode = await main(["node", "scripts/dev-tui.mjs"]);

    expect(exitCode).toBe(0);
    expect(mockSpawn).toHaveBeenCalledTimes(1);
    const [pnpmBin, args, options] = mockSpawn.mock.calls[0] ?? [];

    expect(pnpmBin).toBe("pnpm");
    expect(args).toEqual([
      "--filter",
      "@papierklammer/server",
      "exec",
      "tsx",
      "../packages/orchestrator-tui/src/index.tsx",
      "--url",
      "http://127.0.0.1:3100",
      "--api-key",
      "",
    ]);
    expect(options?.env?.PAPIERKLAMMER_TUI_URL).toBe("http://127.0.0.1:3100");
    expect(options?.env?.PAPIERKLAMMER_TUI_COMPANY_ID).toBeUndefined();
    expect(options?.env?.PAPIERKLAMMER_TUI_COMPANY_NAME).toBeUndefined();
  });
});
