# User Testing

## Validation Surface

Two validation surfaces for this mission:

### Surface 1: Vitest (TUI)
- All TUI validation through Vitest + ink-testing-library
- Tests in `packages/orchestrator-tui/src/__tests__/`
- Mock child_process.spawn for Codex, mock fetch for API
- Use `pnpm exec vitest run <target-file>` for deterministic file-scoped runs

### Surface 2: Agent-Browser (GUI)
- Visual verification of GUI design system compliance
- Dev server on port 3100 (`pnpm dev`)
- Key verification flows: load dashboard, check font/colors/borders, navigate between pages
- DOM inspection scripts for computed style verification (fontFamily, borderRadius, boxShadow, backgroundColor)
- Invoke `agent-browser` skill for browser automation

### Required Tools
- Vitest (installed)
- ink-testing-library (installed in orchestrator-tui)
- agent-browser (available, Chromium 1217 installed)
- Dev server starts with `pnpm dev` on port 3100

## Validation Concurrency

### Vitest surface (TUI)
- **Max concurrent validators:** 3
- **Rationale:** Each Vitest process ~200-300MB. Machine has 16GB RAM. Well within budget.

### Agent-browser surface (GUI)
- **Max concurrent validators:** 2
- **Rationale:** Each agent-browser ~300MB + shared dev server ~200MB = ~800MB total for 2 instances. Machine has 16GB RAM with ~8GB headroom. Conservative limit due to Chromium memory usage.

## Flow Validator Guidance

### vitest flows
- Stay inside repository root: `/Users/aischool/work/papierklammer_droid`
- Use `pnpm exec vitest run <target-file>` for deterministic file-scoped runs
- Do not modify product code during validation
- Pre-existing server test flakiness is expected — only TUI/GUI test failures matter

### agent-browser flows
- Start dev server: `cd /Users/aischool/work/papierklammer_droid && PORT=3100 pnpm dev` (background, wait for healthcheck)
- Healthcheck: `curl -sf http://localhost:3100/api/health`
- Invoke `agent-browser` skill before browser operations
- Navigate to pages, take screenshots, run DOM inspection scripts
- Stop dev server after validation: `lsof -ti :3100 | xargs kill 2>/dev/null || true`
- For DOM style assertions: use `page.evaluate()` with JavaScript that checks `getComputedStyle()` values

## Observed Validation Notes

- Pre-existing server route tests have intermittent failures due to shared mock state — ignore these
- `pnpm exec vitest run <file>` is more reliable than `pnpm test:run -- <file>` for scoped runs
- Agent-browser Chromium 1217 installed via Playwright CLI (not built-in agent-browser install)
- Dev server takes ~12 seconds to start with embedded PGlite
- Current `cli.test.ts` coverage does not include a dedicated `--company-id` parse assertion; treat `VAL-TUI-CORE-003` as blocked until explicit test coverage is added.

## Flow Validator Guidance: vitest

- Isolation boundary: repository-only operations under `/Users/aischool/work/papierklammer_droid`.
- Do not modify product code or mission contract files from flow validators.
- Only execute deterministic file-scoped tests in `packages/orchestrator-tui/src/__tests__/`.
- Store evidence as command logs and assertion-to-test mapping notes for each flow report.
