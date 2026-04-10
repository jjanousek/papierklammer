import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join, resolve } from "path";

const ROOT = resolve(__dirname, "../../..");

/**
 * Recursively collects files matching extensions, excluding
 * node_modules, dist, .git, .factory, patches directories.
 */
function collectFiles(
  dir: string,
  extensions: string[],
  results: string[] = [],
): string[] {
  for (const entry of readdirSync(dir)) {
    if (
      entry === "node_modules" ||
      entry === "dist" ||
      entry === ".git" ||
      entry === ".factory" ||
      entry === "patches"
    )
      continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      collectFiles(full, extensions, results);
    } else if (extensions.some((ext) => full.endsWith(ext))) {
      results.push(full);
    }
  }
  return results;
}

/**
 * Directories and file basenames to exclude from path-rename checks.
 * These are documentation, historical records, or reference files
 * where .paperclip or paperclipai branding is acceptable.
 */
const EXCLUDED_PATH_DIRS = [
  "CHANGELOG.md",
  "PAPIERKLAMMER_ARCHITECTURE_REPORT",
  "PAPIERKLAMMER_FORK_SPEC",
  "releases/",
  "pnpm-lock.yaml",
];

function shouldExcludeForPathCheck(filePath: string): boolean {
  const rel = filePath.replace(ROOT + "/", "");
  return EXCLUDED_PATH_DIRS.some((pattern) => rel.includes(pattern));
}

describe("fork-path-cli-rename-verification: filesystem paths and CLI branding", () => {
  describe("VAL-FORK-004: Filesystem paths use ~/.papierklammer/", () => {
    it("no ~/.paperclip/ path references in source code", () => {
      const sourceFiles = collectFiles(ROOT, [".ts", ".tsx", ".mjs", ".js"]);
      const violations: { file: string; line: string }[] = [];

      for (const f of sourceFiles) {
        if (shouldExcludeForPathCheck(f)) continue;
        if (f.includes("fork-path-cli-rename-verification")) continue;
        const content = readFileSync(f, "utf-8");
        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          // Match .paperclip/ or .paperclip" or .paperclip' as path references
          // but NOT .paperclip.yaml, .paperclip.yml (vendor sidecar filenames)
          if (
            line.includes(".paperclip/") ||
            line.includes('.paperclip"') ||
            line.includes(".paperclip'") ||
            line.includes(".paperclip`") ||
            line.includes(".paperclip-worktrees") ||
            line.includes(".paperclip-sdk") ||
            line.includes(".paperclip-local") ||
            line.includes(".paperclip-review") ||
            line.includes(".paperclip-openclaw")
          ) {
            // Allow .paperclip.yaml / .paperclip.yml references (vendor sidecar)
            const trimmed = line.trim();
            if (
              trimmed.includes(".paperclip.yaml") ||
              trimmed.includes(".paperclip.yml")
            ) {
              // Only skip if the ONLY .paperclip reference is the yaml/yml one
              const withoutYaml = trimmed
                .replace(/\.paperclip\.yaml/g, "")
                .replace(/\.paperclip\.yml/g, "");
              if (
                !withoutYaml.includes(".paperclip/") &&
                !withoutYaml.includes('.paperclip"') &&
                !withoutYaml.includes(".paperclip'") &&
                !withoutYaml.includes(".paperclip`") &&
                !withoutYaml.includes(".paperclip-worktrees") &&
                !withoutYaml.includes(".paperclip-sdk") &&
                !withoutYaml.includes(".paperclip-local") &&
                !withoutYaml.includes(".paperclip-review") &&
                !withoutYaml.includes(".paperclip-openclaw")
              ) {
                continue;
              }
            }
            violations.push({
              file: f.replace(ROOT + "/", ""),
              line: `L${i + 1}: ${trimmed}`,
            });
          }
        }
      }
      expect(violations).toEqual([]);
    });

    it("no ~/.paperclip/ path references in config schema defaults", () => {
      const configSchemaPath = join(
        ROOT,
        "packages/shared/src/config-schema.ts",
      );
      const content = readFileSync(configSchemaPath, "utf-8");
      const matches = content.match(/~\/\.paperclip\//g);
      expect(matches).toBeNull();
    });

    it("worktree home default uses ~/.papierklammer-worktrees", () => {
      const worktreeLib = join(ROOT, "cli/src/commands/worktree-lib.ts");
      const content = readFileSync(worktreeLib, "utf-8");
      expect(content).toContain("~/.papierklammer-worktrees");
      expect(content).not.toContain("~/.paperclip-worktrees");
    });

    it("default home dir resolves to ~/.papierklammer", () => {
      const homeTs = join(ROOT, "cli/src/config/home.ts");
      const content = readFileSync(homeTs, "utf-8");
      expect(content).toContain(".papierklammer");
      expect(content).not.toContain('".paperclip"');
    });
  });

  describe("VAL-FORK-005: CLI binary renamed", () => {
    it("CLI package.json bin field uses papierklammer key", () => {
      const cliPkg = JSON.parse(
        readFileSync(join(ROOT, "cli/package.json"), "utf-8"),
      );
      expect(cliPkg.bin).toHaveProperty("papierklammer");
      expect(cliPkg.bin).not.toHaveProperty("paperclipai");
    });

    it("CLI package.json name is papierklammer", () => {
      const cliPkg = JSON.parse(
        readFileSync(join(ROOT, "cli/package.json"), "utf-8"),
      );
      expect(cliPkg.name).toBe("papierklammer");
    });

    it("CLI program name is papierklammer", () => {
      const indexTs = readFileSync(join(ROOT, "cli/src/index.ts"), "utf-8");
      expect(indexTs).toContain('.name("papierklammer")');
      expect(indexTs).not.toContain('.name("paperclipai")');
    });

    it("CLI description says Papierklammer", () => {
      const indexTs = readFileSync(join(ROOT, "cli/src/index.ts"), "utf-8");
      expect(indexTs).toContain("Papierklammer");
    });
  });

  describe("create-paperclip-plugin → create-papierklammer-plugin", () => {
    it("package name is @papierklammer/create-papierklammer-plugin", () => {
      const pkg = JSON.parse(
        readFileSync(
          join(
            ROOT,
            "packages/plugins/create-papierklammer-plugin/package.json",
          ),
          "utf-8",
        ),
      );
      expect(pkg.name).toBe("@papierklammer/create-papierklammer-plugin");
    });

    it("bin field uses create-papierklammer-plugin", () => {
      const pkg = JSON.parse(
        readFileSync(
          join(
            ROOT,
            "packages/plugins/create-papierklammer-plugin/package.json",
          ),
          "utf-8",
        ),
      );
      expect(pkg.bin).toHaveProperty("create-papierklammer-plugin");
      expect(pkg.bin).not.toHaveProperty("create-paperclip-plugin");
    });
  });

  describe("branding strings updated", () => {
    it("UI window title uses Papierklammer", () => {
      const indexHtml = readFileSync(
        join(ROOT, "ui/index.html"),
        "utf-8",
      );
      expect(indexHtml).toContain("Papierklammer");
      expect(indexHtml).not.toMatch(/<title>Paperclip<\/title>/);
    });

    it("web manifest uses Papierklammer", () => {
      const manifest = JSON.parse(
        readFileSync(
          join(ROOT, "ui/public/site.webmanifest"),
          "utf-8",
        ),
      );
      expect(manifest.name).toBe("Papierklammer");
      expect(manifest.short_name).toBe("Papierklammer");
    });

    it("service worker cache name uses papierklammer", () => {
      const sw = readFileSync(
        join(ROOT, "ui/public/sw.js"),
        "utf-8",
      );
      expect(sw).toContain("papierklammer");
      expect(sw).not.toContain("paperclip-v");
    });
  });

  describe("runtime web/api branding uses Papierklammer", () => {
    it("root shell runtime branding keys use papierklammer names", () => {
      const indexHtml = readFileSync(join(ROOT, "ui/index.html"), "utf-8");
      const uiBranding = readFileSync(join(ROOT, "server/src/ui-branding.ts"), "utf-8");
      const worktreeBranding = readFileSync(join(ROOT, "ui/src/lib/worktree-branding.ts"), "utf-8");

      expect(indexHtml).toContain('const key = "papierklammer-theme"');
      expect(indexHtml).not.toContain('const key = "paperclip.theme"');

      expect(uiBranding).toContain('name="papierklammer-worktree-name"');
      expect(uiBranding).not.toContain('name="paperclip-worktree-name"');
      expect(worktreeBranding).toContain('readMetaContent("papierklammer-worktree-name")');
      expect(worktreeBranding).not.toContain('readMetaContent("paperclip-worktree-name")');
    });

    it("auth, cli approval, dashboard, and operator chrome copy is renamed", () => {
      const authPage = readFileSync(join(ROOT, "ui/src/pages/Auth.tsx"), "utf-8");
      const cliAuthPage = readFileSync(join(ROOT, "ui/src/pages/CliAuth.tsx"), "utf-8");
      const dashboardPage = readFileSync(join(ROOT, "ui/src/pages/Dashboard.tsx"), "utf-8");
      const layout = readFileSync(join(ROOT, "ui/src/components/Layout.tsx"), "utf-8");

      expect(authPage).toContain("Papierklammer");
      expect(authPage).not.toContain("Sign in to Paperclip");
      expect(cliAuthPage).toContain("Approve Papierklammer CLI access");
      expect(cliAuthPage).not.toContain("Approve Paperclip CLI access");
      expect(dashboardPage).toContain("Welcome to Papierklammer.");
      expect(dashboardPage).not.toContain("Welcome to Paperclip.");
      expect(layout).not.toContain("https://docs.paperclip.ing/");
      expect(layout).toContain("https://github.com/papierklammer/papierklammer#readme");
      expect(layout).not.toContain("https://github.com/papierklammer/paperclip#readme");
    });

    it("browser persistence keys hard-cut to papierklammer names", () => {
      const files = [
        "ui/src/context/CompanyContext.tsx",
        "ui/src/context/PanelContext.tsx",
        "ui/src/hooks/useCompanyPageMemory.ts",
        "ui/src/lib/inbox.ts",
        "ui/src/hooks/useInboxBadge.ts",
        "ui/src/lib/project-order.ts",
        "ui/src/lib/agent-order.ts",
        "ui/src/lib/recent-assignees.ts",
        "ui/src/components/CompanyRail.tsx",
        "ui/src/pages/Issues.tsx",
        "ui/src/pages/ProjectDetail.tsx",
        "ui/src/pages/IssueDetail.tsx",
        "ui/src/components/NewIssueDialog.tsx",
        "ui/src/components/IssueDocumentsSection.tsx",
      ];

      const content = files.map((file) => readFileSync(join(ROOT, file), "utf-8")).join("\n");

      expect(content).toContain("papierklammer.selectedCompanyId");
      expect(content).toContain("papierklammer:panel-visible");
      expect(content).toContain("papierklammer.companyPaths");
      expect(content).toContain("papierklammer:inbox:dismissed");
      expect(content).toContain("papierklammer.companyOrder");
      expect(content).toContain("papierklammer:issues-view");
      expect(content).toContain("papierklammer:project-tab:");
      expect(content).toContain("papierklammer:issue-draft");
      expect(content).toContain("papierklammer:issue-document-folds:");

      expect(content).not.toContain("paperclip.selectedCompanyId");
      expect(content).not.toContain("paperclip:panel-visible");
      expect(content).not.toContain("paperclip.companyPaths");
      expect(content).not.toContain("paperclip:inbox:dismissed");
      expect(content).not.toContain("paperclip.companyOrder");
      expect(content).not.toContain("paperclip:issues-view");
      expect(content).not.toContain("paperclip:project-tab:");
      expect(content).not.toContain("paperclip:issue-draft");
      expect(content).not.toContain("paperclip:issue-document-folds:");
    });

    it("runtime session and run header namespace is renamed", () => {
      const appTs = readFileSync(join(ROOT, "server/src/app.ts"), "utf-8");
      const clientHttp = readFileSync(join(ROOT, "cli/src/client/http.ts"), "utf-8");
      const clientCommon = readFileSync(join(ROOT, "cli/src/commands/client/common.ts"), "utf-8");
      const authMiddleware = readFileSync(join(ROOT, "server/src/middleware/auth.ts"), "utf-8");
      const issuesRoute = readFileSync(join(ROOT, "server/src/routes/issues.ts"), "utf-8");

      expect(appTs).toContain("papierklammer:${req.actor.source}:${req.actor.userId}");
      expect(appTs).not.toContain("paperclip:${req.actor.source}:${req.actor.userId}");
      expect(clientHttp).toContain('headers["x-papierklammer-run-id"] = this.runId;');
      expect(clientHttp).toContain('headers["x-papierklammer-trace-id"] = this.traceId;');
      expect(clientHttp).not.toContain('headers["x-paperclip-run-id"] = this.runId;');
      expect(clientCommon).toContain("const runId = process.env.PAPIERKLAMMER_RUN_ID?.trim() || undefined;");
      expect(clientCommon).toContain("runId,");
      expect(authMiddleware).toContain('req.header("x-papierklammer-run-id")');
      expect(authMiddleware).not.toContain('req.header("x-paperclip-run-id")');
      expect(issuesRoute).toContain('req.header("x-papierklammer-trace-id")');
      expect(issuesRoute).toContain("originRunId: actor.runId ?? traceIdHeader ?? undefined,");
    });

    it("generated runtime text and svg assets are renamed", () => {
      const llmRoutes = readFileSync(join(ROOT, "server/src/routes/llms.ts"), "utf-8");
      const orgChartSvg = readFileSync(join(ROOT, "server/src/routes/org-chart-svg.ts"), "utf-8");
      const geminiAdapter = readFileSync(
        join(ROOT, "packages/adapters/gemini-local/src/index.ts"),
        "utf-8",
      );
      const openclawGatewayAdapter = readFileSync(
        join(ROOT, "packages/adapters/openclaw-gateway/src/index.ts"),
        "utf-8",
      );

      expect(llmRoutes).toContain("# Papierklammer Agent Configuration Index");
      expect(llmRoutes).toContain("# Papierklammer Agent Icon Names");
      expect(llmRoutes).not.toContain("# Paperclip Agent Configuration Index");
      expect(orgChartSvg).toContain("Papierklammer");
      expect(orgChartSvg).not.toContain(">Paperclip</text>");
      expect(geminiAdapter).toContain("You want Papierklammer to run the Gemini CLI locally on the host machine");
      expect(geminiAdapter).toContain("Papierklammer auto-injects local skills");
      expect(geminiAdapter).not.toContain("You want Paperclip to run the Gemini CLI locally on the host machine");
      expect(geminiAdapter).not.toContain("Paperclip auto-injects local skills");
      expect(openclawGatewayAdapter).toContain("You want Papierklammer to invoke OpenClaw over the Gateway WebSocket protocol.");
      expect(openclawGatewayAdapter).toContain("Papierklammer base URL advertised in wake text");
      expect(openclawGatewayAdapter).toContain("papierklammerApiUrl");
      expect(openclawGatewayAdapter).toContain("papierklammer (object): standardized Papierklammer context added to every gateway agent request");
      expect(openclawGatewayAdapter).toContain("papierklammer.workspace");
      expect(openclawGatewayAdapter).toContain("papierklammer.workspaces");
      expect(openclawGatewayAdapter).toContain("papierklammer.workspaceRuntime");
      expect(openclawGatewayAdapter).toContain("fixed session key when strategy=fixed (default papierklammer)");
      expect(openclawGatewayAdapter).toContain("standardized Papierklammer context added to every gateway agent request");
      expect(openclawGatewayAdapter).not.toContain("You want Paperclip to invoke OpenClaw over the Gateway WebSocket protocol.");
      expect(openclawGatewayAdapter).not.toContain("absolute Paperclip base URL advertised in wake text");
      expect(openclawGatewayAdapter).not.toContain("fixed session key when strategy=fixed (default paperclip)");
      expect(openclawGatewayAdapter).not.toContain("standardized Paperclip context added to every gateway agent request");
      expect(openclawGatewayAdapter).not.toContain("paperclipApiUrl");
      expect(openclawGatewayAdapter).not.toContain("paperclip (object): standardized Papierklammer context added to every gateway agent request");
      expect(openclawGatewayAdapter).not.toContain("paperclip.workspace");
      expect(openclawGatewayAdapter).not.toContain("paperclip.workspaces");
      expect(openclawGatewayAdapter).not.toContain("paperclip.workspaceRuntime");
    });

    it("doctor help text is renamed", () => {
      const cliIndex = readFileSync(join(ROOT, "cli/src/index.ts"), "utf-8");

      expect(cliIndex).toContain('description("Run diagnostic checks on your Papierklammer setup")');
      expect(cliIndex).not.toContain('description("Run diagnostic checks on your Paperclip setup")');
    });

    it("operator CLI command wording and legacy flags are renamed", () => {
      const files = [
        "cli/src/index.ts",
        "cli/src/commands/onboard.ts",
        "cli/src/commands/run.ts",
        "cli/src/commands/configure.ts",
        "cli/src/commands/allowed-hostname.ts",
        "cli/src/commands/auth-bootstrap-ceo.ts",
        "cli/src/commands/client/common.ts",
        "cli/src/commands/client/company.ts",
        "cli/src/commands/worktree.ts",
        "cli/src/config/env.ts",
      ];

      const content = files.map((file) => readFileSync(join(ROOT, file), "utf-8")).join("\n");

      expect(content).toContain("Base URL for the Papierklammer server API");
      expect(content).toContain("Start Papierklammer immediately after saving config");
      expect(content).toContain("Bootstrap local setup (onboard + doctor) and run Papierklammer");
      expect(content).toContain("Starting Papierklammer server...");
      expect(content).toContain("No config found at ${configPath}. Run ${pc.cyan(\"papierklammer onboard\")} first.");
      expect(content).toContain("Restart the Papierklammer server for this change to take effect.");
      expect(content).toContain("Worktree-local Papierklammer instance helpers");
      expect(content).toContain("Print shell exports for the current worktree-local Papierklammer instance");
      expect(content).toContain("Select what Papierklammer should import");
      expect(content).toContain("Generated by Papierklammer CLI commands");
      expect(content).toContain("set context profile companyId via `papierklammer context set`.");
      expect(content).not.toContain("--paperclip-url <url>");
      expect(content).not.toContain("paperclipai run");
      expect(content).not.toContain("paperclipai configure");
      expect(content).not.toContain("paperclipai doctor");
      expect(content).not.toContain("paperclipai auth bootstrap-ceo");
      expect(content).not.toContain("Start Paperclip immediately after saving config");
      expect(content).not.toContain("Bootstrap local setup (onboard + doctor) and run Paperclip");
      expect(content).not.toContain("Starting Paperclip server...");
      expect(content).not.toContain("Run ${pc.cyan(\"paperclip onboard\")} first.");
      expect(content).not.toContain("Restart the Paperclip server for this change to take effect.");
      expect(content).not.toContain("Select what Paperclip should import");
      expect(content).not.toContain("Generated by Paperclip CLI commands");
      expect(content).not.toContain("set context profile companyId via `paperclipai context set`.");
    });

    it("backup, worktree, and dev helper sources use renamed prefixes and labels", () => {
      const cliIndex = readFileSync(join(ROOT, "cli/src/index.ts"), "utf-8");
      const dbBackup = readFileSync(join(ROOT, "cli/src/commands/db-backup.ts"), "utf-8");
      const worktree = readFileSync(join(ROOT, "cli/src/commands/worktree.ts"), "utf-8");
      const provisionWorktree = readFileSync(join(ROOT, "scripts/provision-worktree.sh"), "utf-8");
      const backupScript = readFileSync(join(ROOT, "scripts/backup-db.sh"), "utf-8");
      const devWithTui = readFileSync(join(ROOT, "scripts/dev-with-tui.mjs"), "utf-8");
      const devTui = readFileSync(join(ROOT, "scripts/dev-tui.mjs"), "utf-8");
      const devRunner = readFileSync(join(ROOT, "scripts/dev-runner.ts"), "utf-8");
      const devService = readFileSync(join(ROOT, "scripts/dev-service.ts"), "utf-8");
      const ensureWorkspaceLinks = readFileSync(join(ROOT, "scripts/ensure-workspace-package-links.ts"), "utf-8");

      expect(cliIndex).toContain('"Backup filename prefix", "papierklammer"');
      expect(cliIndex).not.toContain('"Backup filename prefix", "paperclip"');
      expect(dbBackup).toContain('const filenamePrefix = opts.filenamePrefix?.trim() || "papierklammer";');
      expect(dbBackup).toContain('pc.bgCyan(pc.black(" papierklammer db:backup "))');
      expect(dbBackup).not.toContain('const filenamePrefix = opts.filenamePrefix?.trim() || "paperclip";');
      expect(dbBackup).not.toContain('pc.bgCyan(pc.black(" paperclip db:backup "))');
      expect(worktree).toContain('const WORKTREE_NAME_PREFIX = "papierklammer-"');
      expect(worktree).toContain("Run Papierklammer inside this repo");
      expect(worktree).toContain("does not look like a Papierklammer worktree.");
      expect(worktree).toContain("No Papierklammer worktrees were found.");
      expect(worktree).not.toContain('const WORKTREE_NAME_PREFIX = "paperclip-"');
      expect(provisionWorktree).toContain('echo "papierklammer CLI not available in this workspace; writing isolated fallback config without DB seeding." >&2');
      expect(provisionWorktree).not.toContain('echo "paperclipai CLI not available in this workspace; writing isolated fallback config without DB seeding." >&2');
      expect(backupScript).toContain("Backup the configured Papierklammer database");
      expect(backupScript).not.toContain("Backup the configured Paperclip database");
      expect(devWithTui).toContain("Starts the Papierklammer dev server");
      expect(devWithTui).toContain("[papierklammer] orchestrator TUI exited with status %s");
      expect(devWithTui).not.toContain("Starts the Paperclip dev server");
      expect(devTui).toContain("[papierklammer] launching orchestrator TUI");
      expect(devTui).not.toContain("[paperclip] launching orchestrator TUI");
      expect(devRunner).toContain("[papierklammer] dev mode: local_trusted (default)");
      expect(devRunner).toContain("[papierklammer] Papierklammer server already listening on http://127.0.0.1:");
      expect(devRunner).not.toContain("[paperclip] Paperclip server already listening on http://127.0.0.1:");
      expect(devService).toContain("papierklammer-dev-watch");
      expect(devService).toContain("papierklammer-server");
      expect(devService).toContain("No Papierklammer dev services registered for this repo.");
      expect(devService).not.toContain("No Paperclip dev services registered for this repo.");
      expect(ensureWorkspaceLinks).toContain("[papierklammer] detected stale workspace package links for server; relinking dependencies...");
      expect(ensureWorkspaceLinks).not.toContain("[paperclip] detected stale workspace package links for server; relinking dependencies...");
    });

    it("active clean-onboard scripts use renamed operator-facing entrypoints and labels", () => {
      const cleanOnboardGit = readFileSync(join(ROOT, "scripts/clean-onboard-git.sh"), "utf-8");
      const cleanOnboardNpm = readFileSync(join(ROOT, "scripts/clean-onboard-npm.sh"), "utf-8");
      const cleanOnboardRef = readFileSync(join(ROOT, "scripts/clean-onboard-ref.sh"), "utf-8");

      expect(cleanOnboardGit).toContain("https://github.com/papierklammer/papierklammer.git");
      expect(cleanOnboardGit).not.toContain("https://github.com/paperclipai/paperclip.git");
      expect(cleanOnboardNpm).toContain("npx --yes papierklammer onboard --yes --data-dir");
      expect(cleanOnboardNpm).not.toContain("npx --yes paperclipai onboard --yes --data-dir");
      expect(cleanOnboardRef).toContain("Papierklammer data dir to use");
      expect(cleanOnboardRef).not.toContain("Paperclip data dir to use");
    });

    it("OpenClaw onboarding and helper surfaces use renamed Papierklammer contract", () => {
      const accessRoutes = readFileSync(join(ROOT, "server/src/routes/access.ts"), "utf-8");
      const openclawGatewayExecute = readFileSync(
        join(ROOT, "packages/adapters/openclaw-gateway/src/server/execute.ts"),
        "utf-8",
      );
      const openclawGatewayConfigFields = readFileSync(
        join(ROOT, "ui/src/adapters/openclaw-gateway/config-fields.tsx"),
        "utf-8",
      );
      const companySettings = readFileSync(join(ROOT, "ui/src/pages/CompanySettings.tsx"), "utf-8");
      const openclawJoinScript = readFileSync(join(ROOT, "scripts/smoke/openclaw-join.sh"), "utf-8");
      const openclawDockerUi = readFileSync(join(ROOT, "scripts/smoke/openclaw-docker-ui.sh"), "utf-8");
      const openclawGatewayE2E = readFileSync(join(ROOT, "scripts/smoke/openclaw-gateway-e2e.sh"), "utf-8");
      const openclawSseStandalone = readFileSync(join(ROOT, "scripts/smoke/openclaw-sse-standalone.sh"), "utf-8");

      expect(accessRoutes).toContain("papierklammerApiUrl");
      expect(accessRoutes).toContain("# Papierklammer OpenClaw Gateway Onboarding");
      expect(accessRoutes).toContain("agentDefaultsPayload.papierklammerApiUrl");
      expect(accessRoutes).not.toContain("paperclipApiUrl");
      expect(accessRoutes).not.toContain("set the first reachable candidate as agentDefaultsPayload.paperclipApiUrl");
      expect(openclawGatewayExecute).toContain('const fallback = input.configuredSessionKey ?? "papierklammer";');
      expect(openclawGatewayExecute).toContain("return `papierklammer:run:${input.runId}`;");
      expect(openclawGatewayExecute).toContain("return `papierklammer:issue:${input.issueId}`;");
      expect(openclawGatewayExecute).toContain('const claimedApiKeyPath = "~/.openclaw/workspace/papierklammer-claimed-api-key.json";');
      expect(openclawGatewayExecute).toContain("Papierklammer wake event for a cloud adapter.");
      expect(openclawGatewayExecute).toContain("- Use X-Papierklammer-Run-Id: $PAPIERKLAMMER_RUN_ID on every mutating API call.");
      expect(openclawGatewayExecute).toContain("agentParams.papierklammer = papierklammerPayload;");
      expect(openclawGatewayExecute).toContain('delete agentParams.paperclip;');
      expect(openclawGatewayExecute).not.toContain("paperclip:run:");
      expect(openclawGatewayExecute).not.toContain("paperclip:issue:");
      expect(openclawGatewayExecute).not.toContain("paperclip-claimed-api-key.json");
      expect(openclawGatewayExecute).not.toContain("Paperclip wake event for a cloud adapter.");
      expect(openclawGatewayExecute).not.toContain("X-Paperclip-Run-Id");
      expect(openclawGatewayConfigFields).toContain('label="Papierklammer API URL override"');
      expect(openclawGatewayConfigFields).toContain('"papierklammerApiUrl"');
      expect(openclawGatewayConfigFields).toContain('String(config.papierklammerApiUrl ?? "")');
      expect(openclawGatewayConfigFields).toContain('String(config.sessionKey ?? "papierklammer")');
      expect(openclawGatewayConfigFields).toContain('placeholder="papierklammer"');
      expect(openclawGatewayConfigFields).not.toContain('label="Paperclip API URL override"');
      expect(openclawGatewayConfigFields).not.toContain('"paperclipApiUrl"');
      expect(companySettings).toContain("Papierklammer organization");
      expect(companySettings).toContain("Papierklammer-to-gateway reachability");
      expect(companySettings).toContain("If you are running on a different machine than Papierklammer");
      expect(companySettings).toContain("Papierklammer will generate and persist one during join");
      expect(companySettings).toContain('session called "papierklammer-onboarding"');
      expect(companySettings).not.toContain("Paperclip organization");
      expect(companySettings).not.toContain("Paperclip-to-gateway reachability");
      expect(companySettings).not.toContain('session called "paperclip-onboarding"');
      expect(openclawJoinScript).toContain('log "checking Papierklammer health"');
      expect(openclawJoinScript).toContain('SMOKE_IMAGE="${SMOKE_IMAGE:-papierklammer-openclaw-smoke:local}"');
      expect(openclawJoinScript).toContain('.body.papierklammer.agentId');
      expect(openclawJoinScript).toContain('grep -q "Papierklammer OpenClaw Gateway Onboarding"');
      expect(openclawJoinScript).not.toContain('log "checking Paperclip health"');
      expect(openclawJoinScript).not.toContain("paperclip-openclaw-smoke");
      expect(openclawJoinScript).not.toContain(".body.paperclip.agentId");
      expect(openclawJoinScript).not.toContain('grep -q "Paperclip OpenClaw Gateway Onboarding"');
      expect(openclawDockerUi).toContain('OPENCLAW_CONFIG_DIR="${OPENCLAW_CONFIG_DIR:-$OPENCLAW_TMP_DIR/openclaw-papierklammer-smoke}"');
      expect(openclawDockerUi).toContain("Papierklammer URL for OpenClaw container:");
      expect(openclawDockerUi).not.toContain("openclaw-paperclip-smoke");
      expect(openclawDockerUi).not.toContain("Paperclip URL for OpenClaw container:");
      expect(openclawGatewayE2E).toContain("--arg papierklammerApiUrl");
      expect(openclawGatewayE2E).toContain('sessionKey: "papierklammer"');
      expect(openclawGatewayE2E).toContain("papierklammerApiUrl: $papierklammerApiUrl");
      expect(openclawGatewayE2E).toContain('local skill_dir="${OPENCLAW_CONFIG_DIR%/}/skills/papierklammer"');
      expect(openclawGatewayE2E).toContain('local claimed_file="${workspace_dir}/papierklammer-claimed-api-key.json"');
      expect(openclawGatewayE2E).toContain('api_request "GET" "/skills/papierklammer"');
      expect(openclawGatewayE2E).toContain("before running Papierklammer heartbeat steps.");
      expect(openclawGatewayE2E).toContain("Papierklammer issue comment");
      expect(openclawGatewayE2E).toContain("Papierklammer API health endpoint not reachable");
      expect(openclawGatewayE2E).toContain('log "papierklammer health deploymentMode=');
      expect(openclawGatewayE2E).not.toContain("paperclipApiUrl");
      expect(openclawGatewayE2E).not.toContain('sessionKey: "paperclip"');
      expect(openclawGatewayE2E).not.toContain('/skills/paperclip');
      expect(openclawGatewayE2E).not.toContain("paperclip-claimed-api-key.json");
      expect(openclawGatewayE2E).not.toContain("before running Paperclip heartbeat steps.");
      expect(openclawGatewayE2E).not.toContain("Paperclip issue comment");
      expect(openclawGatewayE2E).not.toContain("Paperclip API health endpoint not reachable");
      expect(openclawSseStandalone).toContain("Run your Papierklammer heartbeat procedure now.");
      expect(openclawSseStandalone).toContain('OPENCLAW_USER="${OPENCLAW_USER:-papierklammer-smoke}"');
      expect(openclawSseStandalone).toContain('papierklammer_session_key: ("papierklammer:run:" + $runId)');
      expect(openclawSseStandalone).toContain('-H "x-openclaw-session-key: papierklammer:run:${PAPIERKLAMMER_RUN_ID}"');
      expect(openclawSseStandalone).not.toContain("Run your Paperclip heartbeat procedure now.");
      expect(openclawSseStandalone).not.toContain('OPENCLAW_USER="${OPENCLAW_USER:-paperclip-smoke}"');
      expect(openclawSseStandalone).not.toContain('paperclip_session_key: ("paperclip:run:" + $runId)');
      expect(openclawSseStandalone).not.toContain('x-openclaw-session-key: paperclip:run:${PAPIERKLAMMER_RUN_ID}');
    });
  });

  describe("skill catalog and worker-skill branding uses renamed Papierklammer identities", () => {
    it("bundled skill directories and discovery routes only expose renamed slugs", () => {
      const accessRoutes = readFileSync(join(ROOT, "server/src/routes/access.ts"), "utf-8");
      const bundledSkillDirs = readdirSync(join(ROOT, "skills"), { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();

      expect(bundledSkillDirs).toEqual([
        "papierklammer",
        "papierklammer-create-agent",
        "papierklammer-create-plugin",
        "para-memory-files",
      ]);
      expect(accessRoutes).toContain('/api/skills/papierklammer');
      expect(accessRoutes).toContain('/api/skills/papierklammer-create-agent');
      expect(accessRoutes).not.toContain('/api/skills/paperclip');
      expect(accessRoutes).not.toContain('/api/skills/paperclip-create-agent');
      expect(accessRoutes).not.toContain('/api/skills/paperclip-create-plugin');
    });

    it("active bundled and project worker skill markdown avoids legacy Paperclip copy", () => {
      const skillFiles = collectFiles(join(ROOT, "skills"), [".md"]).concat(
        collectFiles(join(ROOT, ".factory/skills"), [".md"]),
      );
      const violations: { file: string; line: string }[] = [];
      const forbiddenPatterns = [
        "paperclipai",
        "Paperclip",
        "paperclip-create-agent",
        "paperclip-create-plugin",
        "/api/skills/paperclip",
        "skills/paperclip",
        "X-Paperclip",
      ];

      for (const file of skillFiles) {
        const content = readFileSync(file, "utf-8");
        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i += 1) {
          const line = lines[i]!;
          if (!forbiddenPatterns.some((pattern) => line.includes(pattern))) continue;
          violations.push({
            file: file.replace(ROOT + "/", ""),
            line: `L${i + 1}: ${line.trim()}`,
          });
        }
      }

      expect(violations).toEqual([]);
    });

    it("available-skill and adapter guidance text uses Papierklammer managed wording", () => {
      const accessRoutes = readFileSync(join(ROOT, "server/src/routes/access.ts"), "utf-8");
      const companySkills = readFileSync(join(ROOT, "server/src/services/company-skills.ts"), "utf-8");
      const claudeSkills = readFileSync(join(ROOT, "packages/adapters/claude-local/src/server/skills.ts"), "utf-8");
      const codexSkills = readFileSync(join(ROOT, "packages/adapters/codex-local/src/server/skills.ts"), "utf-8");
      const availableSkillsApi = readFileSync(join(ROOT, "ui/src/api/agents.ts"), "utf-8");

      expect(accessRoutes).toContain("isPapierklammerManaged");
      expect(accessRoutes).not.toContain("isPaperclipManaged");
      expect(companySkills).toContain("Bundled Papierklammer skills are read-only.");
      expect(companySkills).toContain('sourceBadge: "papierklammer"');
      expect(companySkills).not.toContain("Bundled Paperclip skills are read-only.");
      expect(companySkills).not.toContain('sourceBadge: "paperclip"');
      expect(claudeSkills).toContain("Required by Papierklammer");
      expect(claudeSkills).toContain("Managed by Papierklammer");
      expect(claudeSkills).not.toContain("Required by Paperclip");
      expect(codexSkills).toContain("Required by Papierklammer");
      expect(codexSkills).toContain("Managed by Papierklammer");
      expect(codexSkills).not.toContain("Managed by Paperclip");
      expect(availableSkillsApi).toContain("isPapierklammerManaged");
      expect(availableSkillsApi).not.toContain("isPaperclipManaged");
    });

    it("local agent skill round-trip code uses renamed bundled skill keys and installer wording", () => {
      const serverUtils = readFileSync(join(ROOT, "packages/adapter-utils/src/server-utils.ts"), "utf-8");
      const companySkills = readFileSync(join(ROOT, "server/src/services/company-skills.ts"), "utf-8");
      const agentCli = readFileSync(join(ROOT, "cli/src/commands/client/agent.ts"), "utf-8");

      expect(serverUtils).not.toContain("papierklammer/paperclip/");
      expect(companySkills).not.toContain("papierklammer/paperclip/");
      expect(agentCli).toContain("install local Papierklammer skills for Codex/Claude");
      expect(agentCli).not.toContain("install local Paperclip skills for Codex/Claude");
      expect(agentCli).toContain("Skip installing Papierklammer skills into ~/.codex/skills and ~/.claude/skills");
      expect(agentCli).not.toContain("Skip installing Paperclip skills into ~/.codex/skills and ~/.claude/skills");
      expect(agentCli).toContain("Could not locate local Papierklammer skills directory.");
      expect(agentCli).not.toContain("Could not locate local Paperclip skills directory.");
    });
  });
});
