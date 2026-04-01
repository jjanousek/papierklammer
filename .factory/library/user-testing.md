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

## Flow Validator Guidance: vitest

- Use only Vitest/command-line validation for this mission surface; no browser tooling is needed.
- Stay inside repository root: `/Users/aischool/work/papierklammer_droid`.
- Do not modify product code during validation. You may write only:
  - flow report JSON under `.factory/validation/<milestone>/user-testing/flows/`
  - evidence artifacts under the assigned mission evidence directory.
- Keep commands deterministic and scoped to assigned assertions.
- For expensive global validators (`pnpm test:run`, `pnpm -r typecheck`, `pnpm build`), run in isolated validation batches (serialize with other heavy validators) to avoid shared-workspace contention.

## Observed Validation Notes

- `fork-setup` user-testing round observed nondeterministic failures in full-suite `pnpm test:run`:
  - `server/src/__tests__/agent-permissions-routes.test.ts` failed once in full run (`setPrincipalPermission` spy not called) but passed when run alone.
  - `server/src/__tests__/costs-service.test.ts` failed in a subsequent full run (`invalid 'to' date` test expected 400, got 200).
- Treat `VAL-FORK-014` as failed until full-suite stability is restored.
