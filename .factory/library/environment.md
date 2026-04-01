# Environment

Environment variables, external dependencies, and setup notes.

**What belongs here:** Required env vars, external API keys/services, dependency quirks, platform-specific notes.
**What does NOT belong here:** Service ports/commands (use `.factory/services.yaml`).

---

## Runtime

- Node.js 25.6.1 (>=20 required)
- pnpm 9.15.4
- macOS darwin arm64
- `rg` (ripgrep) is not installed in this mission environment; use factory `Grep`/`Glob` tools or `grep` fallback commands when needed.

## Database

- Embedded PostgreSQL (PGlite) for development — no external DB needed
- Data directory: `~/.papierklammer/instances/default/db` (after rename)
- For testing: `startEmbeddedPostgresTestDatabase()` from `server/src/__tests__/helpers/embedded-postgres.ts`

## Environment Variables

After the rename, all env vars use `PAPIERKLAMMER_` prefix:
- `PAPIERKLAMMER_CONTEXT` — context file path
- `PAPIERKLAMMER_PUBLIC_URL` — public URL for auth
- `PAPIERKLAMMER_DEPLOYMENT_MODE` — deployment mode
- `DATABASE_URL` — optional, for external Postgres (leave unset for embedded)
- `PORT` — API server port (default 3100)

## Drizzle Migrations

To generate migrations after schema changes:
```sh
cd packages/db
pnpm build          # Compile schema to dist/
npx drizzle-kit generate  # Generate SQL migration
```

Migrations are auto-applied on server startup.

## Known Local Validation Quirks

- Full-suite `pnpm test:run` can intermittently fail in this environment due to transient local-state/disk pressure issues (including observed `ENOSPC` cases); rerunning after temp cleanup has resolved these without code changes.
- Intermittent flakes were observed during milestone work in `board-mutation-guard.test.ts` and `agent-skills-routes.test.ts`; treat single failures there as potentially non-deterministic and re-run to confirm before escalating.
