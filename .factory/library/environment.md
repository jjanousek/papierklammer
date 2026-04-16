# Environment

Environment variables, external dependencies, and setup notes.

**What belongs here:** Required env vars, external API keys/services, dependency quirks, platform-specific notes.
**What does NOT belong here:** Service ports/commands (use `.factory/services.yaml`).

---

## Mission runtime

- Node.js 25.6.1 (repo requires `>=20`)
- pnpm 9.15.4
- macOS darwin arm64
- `tuistory` is installed and should be used for PTY-backed TUI validation
- Local trusted app surface for this mission is `http://127.0.0.1:3100`
- Leave `DATABASE_URL` unset so the local trusted server uses embedded local storage/postgres behavior

## Resource and process posture

- Machine profile observed during planning: 10 CPU cores, 16 GiB RAM
- Baseline memory pressure is already elevated; keep validation conservative
- Do not run overlapping app instances; reuse `3100`
- Stop repo-owned dev/watch/TUI processes you are not actively using
- Keep validators sequential or low-concurrency; recommended max concurrent TUI validators is `2`
- Prefer package-scoped TUI checks over repo-wide validation unless a change spills outside the TUI package or launch helpers

## Environment variables for this mission

- `PORT=3100` — required when starting the local trusted app for validation
- `PAPIERKLAMMER_HOME=/tmp/papierklammer-tui-mission` — recommended isolated runtime home for workers/validators
- `PAPIERKLAMMER_INSTANCE_ID=tui-mission` — recommended isolated local instance id
- `PAPIERKLAMMER_TUI_URL=http://127.0.0.1:3100` — optional explicit TUI target
- `PAPIERKLAMMER_TUI_COMPANY_ID` / `PAPIERKLAMMER_TUI_COMPANY_NAME` — use only when intentionally pinning the validation company

In local trusted mode, API keys are not required. Workers must never print or commit secrets if they encounter any.

## Seeded-company validation rule

- The no-company launcher failure is out of scope for this mission.
- All live validation for shipped TUI behavior should assume a seeded company exists.
- If `/api/companies` is empty, create a validation company before attempting the full launcher flow.

## Filesystem expectations

- Use temporary directories under `/tmp` for local trusted validation state rather than mutating long-lived user state.
- Keep mission edits focused on `packages/orchestrator-tui/**` and directly related launch/test helpers only.
