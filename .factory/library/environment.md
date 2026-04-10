# Environment

Environment variables, external dependencies, and setup notes.

**What belongs here:** Required env vars, external API keys/services, dependency quirks, platform-specific notes.
**What does NOT belong here:** Service ports/commands (use `.factory/services.yaml`).

---

## Mission runtime

- Node.js 25.6.1 (repo requires `>=20`)
- pnpm 9.15.4
- macOS darwin arm64
- Default local app/API surface is `http://127.0.0.1:3100`
- Embedded Postgres is currently observed on `127.0.0.1:54329`
- Docker is off-limits for this mission

## Resource and process posture

- The user requires a strict low-memory mode: do not intentionally exceed 4 mission-started Node processes at once.
- Stop repo-owned dev/watch/TUI processes you are not using before validation or implementation.
- Do not run overlapping app instances on multiple ports; reuse `3100` when a local app is needed.
- Run validators sequentially. The repo’s full `pnpm test:run -- --maxWorkers=1` is not an allowed baseline for this mission because it exceeds the process budget.

## Environment variables

Important env vars for this mission:

- `PORT=3100` — use only when a worker must start the local app for validation
- `DATABASE_URL` — leave unset to keep the embedded local database path
- `PAPIERKLAMMER_API_URL` — may appear in CLI/operator flows and should remain aligned with renamed wording
- Adapter/home overrides used during validation should point at temporary directories rather than real user homes whenever possible

Workers must never print or commit secrets.

## Data and filesystem expectations

- The user allowed a hard rename with no backward compatibility. Existing test companies/state can be reset if needed for validation.
- Even so, prefer isolated temp directories for skill-install and onboarding checks instead of mutating real user homes.
- Broad docs/history cleanup is out of scope; keep file scans and edits focused on active code, active skills, active scripts, and live generated outputs.

## Known local constraints

- Primary validation surfaces are lightweight API, CLI, and web checks.
- TUI checks are secondary and should remain low-process.
- Active `.factory/skills/` files are in scope for the rename because agents in this repo rely on them.
- Allowlisted compatibility/vendor filenames such as `.paperclip.yaml` should only remain when they are intentionally part of a published format; workers should not assume every `paperclip` token is automatically safe.
