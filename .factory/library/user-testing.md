# User Testing

## Validation Surface

All validation is through automated Vitest tests. No browser UI testing.

### Surfaces
1. **Server API** — Tested via supertest with Express app instances
2. **Services** — Tested via direct service function calls with embedded Postgres
3. **CLI commands** — Tested via commander.js command execution with mocked HTTP client

### Required Tools
- Vitest (already installed)
- Embedded Postgres test helper (`server/src/__tests__/helpers/embedded-postgres.ts`)
- supertest (already installed as server dev dependency)

## Validation Concurrency

- **Max concurrent validators:** 5
- **Rationale:** All tests are Vitest-based. Each test process uses ~200-300MB. Machine has 16GB RAM, 10 CPU cores. 5 concurrent Vitest processes = ~1.5GB, well within budget.
- No browser instances needed, no dev server needed for validation.
