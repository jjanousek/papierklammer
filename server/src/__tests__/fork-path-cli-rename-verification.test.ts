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
      const authMiddleware = readFileSync(join(ROOT, "server/src/middleware/auth.ts"), "utf-8");

      expect(appTs).toContain("papierklammer:${req.actor.source}:${req.actor.userId}");
      expect(appTs).not.toContain("paperclip:${req.actor.source}:${req.actor.userId}");
      expect(clientHttp).toContain('headers["x-papierklammer-run-id"] = this.runId;');
      expect(clientHttp).not.toContain('headers["x-paperclip-run-id"] = this.runId;');
      expect(authMiddleware).toContain('req.header("x-papierklammer-run-id")');
      expect(authMiddleware).not.toContain('req.header("x-paperclip-run-id")');
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
