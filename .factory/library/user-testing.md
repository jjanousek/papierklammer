# User Testing

## Validation Surface

### GUI Surface
- Tool: agent-browser
- URL: http://localhost:3100
- Service: `PORT=3100 pnpm dev:once` (background)
- Health check: `curl -sf http://localhost:3100/api/health`
- Capabilities: Screenshot, DOM inspection, computed styles, click navigation, form interaction
- Default company: "Weather Corp" (auto-seeded by PGlite dev mode)

### TUI Surface
- Tool: vitest (unit/integration tests only)
- The TUI renders via React Ink to a terminal — agent-browser cannot interact with it
- All TUI validation is done through Vitest tests with ink-testing-library
- Test command: `pnpm exec vitest run packages/orchestrator-tui/ --max-workers=3`

## Validation Concurrency

### GUI (agent-browser)
- Max concurrent validators: 3
- Rationale: 16GB RAM, ~6GB baseline usage. Dev server ~200MB, each agent-browser ~300MB. 3 validators = 900MB + 200MB = 1.1GB. Budget: (16-6)*0.7 = 7GB. Well within budget.

### TUI (vitest)
- Max concurrent validators: 1 (tests run as single vitest process)
- Rationale: Vitest manages its own parallelism internally

## Known Limitations
- No live agent data in dev environment (agents are seeded but not actively running)
- Dashboard stream content requires live WebSocket transcript data from running agents
- Some assertions about stream content may need fixture seeding via API calls

## Flow Validator Guidance: TUI (vitest)
- Stay within repository path: `/Users/aischool/work/papierklammer_droid`.
- Use only `vitest`-based validation for TUI assertions; do not use browser automation.
- Run assertion-focused tests first, then broader TUI suite only if needed to confirm regressions.
- Do not modify production code during flow validation; only record observed pass/fail/blocked outcomes.
- Save the flow report to `.factory/validation/tui-stability/user-testing/flows/<group-id>.json`.
- Save any supporting logs or command output snippets under mission evidence path for the assigned group.
- For milestone-focused runs, prefer a focused multi-file command over full-suite execution, e.g.:
  `pnpm exec vitest run packages/orchestrator-tui/src/__tests__/reasoning-effort.test.tsx packages/orchestrator-tui/src/__tests__/fast-mode.test.tsx packages/orchestrator-tui/src/__tests__/settings-overlay.test.tsx --max-workers=3`

## Flow Validator Guidance: GUI (agent-browser)
- Use only the local URL `http://localhost:3100`.
- Use `agent-browser` for interactive GUI assertions and `vitest` for code-level GUI assertions when the contract explicitly requires it.
- Stay in read/validation mode: do not edit application code, routes, or schema.
- Keep assertions that depend on the same dashboard stream state in one browser validator to avoid cross-run state interference.
- If no live stream entries are available in the Dashboard UI, record assertions that require stream content as `blocked` with clear evidence.
- For dashboard stream checks, first click the agent card/header region to expose stream rows; explicit `more/less` controls can appear only after expansion.
- Save flow reports to `.factory/validation/gui-bug-fixes/user-testing/flows/<group-id>.json`.
- Save screenshots and any extracted evidence under `/Users/aischool/.factory/missions/516c6da4-69e6-4af4-9abd-848cb1f60929/evidence/gui-bug-fixes/<group-id>/`.

## Flow Validator Guidance: GUI (vitest)
- Run assertion-focused Vitest commands first (do not run unrelated suites).
- Stay within `/Users/aischool/work/papierklammer_droid`; do not modify source files.
- Capture command output and include exact tested files/cases in the flow report.
- Write reports to `.factory/validation/gui-bug-fixes/user-testing/flows/<group-id>.json`.
- Save command evidence under `/Users/aischool/.factory/missions/516c6da4-69e6-4af4-9abd-848cb1f60929/evidence/gui-bug-fixes/<group-id>/`.
