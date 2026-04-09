# Environment

Environment variables, external dependencies, and setup notes.

**What belongs here:** Required env vars, external API keys/services, dependency quirks, platform-specific notes.
**What does NOT belong here:** Service ports/commands (use `.factory/services.yaml`).

---

## Mission runtime

- Node.js 25.6.1 (repo requires `>=20`)
- pnpm 9.15.4
- macOS darwin arm64
- Default mission runtime is the repo’s local dev flow on port `3100`
- `pnpm papierklammer run` is not the default mission path because the non-interactive config is currently missing in this environment
- Docker is off-limits for this mission

## Environment variables

Important env vars for this mission:

- `PORT=3100` — used when starting the default local dev app for mission work
- `DATABASE_URL` — leave unset for embedded Postgres in this mission
- `PAPIERKLAMMER_TUI_COMPANY_ID` — if present, may influence TUI company selection and should be recorded when investigating stale-company behavior

Workers must never print or commit secrets. If a local provider such as `codex_local` becomes relevant to a QA path and is unavailable, record the blocker with evidence and return that blocker in the report instead of silently substituting a mock path.

## Database and migrations

- Embedded PostgreSQL is the default local database for the audit instances
- Migrations auto-apply on server startup
- This mission should not reset or migrate user data unless the user explicitly requests it

## Known local constraints

- Browser + API validation are the primary surfaces for this mission
- TUI validation requires a real PTY and only begins after the QA company exists
- This mission validates one full bundle at a time because memory headroom is limited
- The machine has ambient Node-based processes outside this repo, so workers must not add parallel Node-heavy tooling beyond the single mission-controlled app/process they actively need
- Treat the user’s process-budget instruction conservatively: one app instance at a time, no parallel local validators, and stop temporary Node-based tools as soon as evidence is captured
- Do not wipe the default instance or delete pre-existing companies; create a uniquely named QA company for the audit and preserve existing user state
