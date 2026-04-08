# Environment

Environment variables, external dependencies, and setup notes.

**What belongs here:** Required env vars, external API keys/services, dependency quirks, platform-specific notes.
**What does NOT belong here:** Service ports/commands (use `.factory/services.yaml`).

---

## Mission runtime

- Node.js 25.6.1 (repo requires `>=20`)
- pnpm 9.15.4
- macOS darwin arm64
- `codex` CLI is required for this mission because onboarding drafting and Codex onboarding use real `codex_local`
- Docker is off-limits for this mission

## Isolated local instances

Workers and validators should use fresh isolated local instance data instead of the default Papierklammer home.

- Mission home root: `/tmp/papierklammer-mission-64c225d0`
- Primary audit instance id: `audit`
- Primary app port: `3100`
- Pre-company/TUI launcher instance id: `precompany`
- Pre-company launcher port: `3101`

Do not reuse `~/.papierklammer/instances/default` for mission validation unless the orchestrator explicitly changes the plan. Reset `instances/audit` or `instances/precompany` under the mission home before fresh validation runs when needed.

## Environment variables

Important env vars for this mission:

- `PAPIERKLAMMER_HOME` — isolated instance home root
- `PAPIERKLAMMER_INSTANCE_ID` — isolated instance id within that home
- `PORT` — hardcoded service port for the chosen instance
- `DATABASE_URL` — leave unset for embedded Postgres in this mission

For `codex_local`, local readiness may come from existing Codex login state and/or `OPENAI_API_KEY`. Workers must never print or commit secrets. If Codex is unavailable, return to the orchestrator rather than substituting a mock provider silently.

## Database and migrations

- Embedded PostgreSQL is the default local database for the audit instances
- Migrations auto-apply on server startup
- If schema changes are required:
  ```sh
  cd packages/db
  pnpm build
  npx drizzle-kit generate
  ```

## Known local constraints

- Browser + API validation are the primary surfaces for this mission
- TUI validation requires a real PTY and is only used when a feature truly touches orchestration/TUI-adjacent behavior
- This mission validates one full bundle at a time because memory headroom is limited
- There are existing local uncommitted changes around direct wakeup lease ownership; workers touching that area must inspect them before editing
