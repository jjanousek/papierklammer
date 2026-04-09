## Test data cleanup ordering: `control_plane_events`

- The `control_plane_events.companyId` foreign key references `companies.id`.
- In embedded-Postgres server tests that perform manual cleanup, delete from `control_plane_events` before deleting from `companies`.
- Practical pattern in `afterEach` blocks:
  1. `delete(controlPlaneEvents)`
  2. delete remaining child tables
  3. `delete(companies)`

Without this ordering, cleanup can fail on FK constraints when tests remove companies directly.

## Ink testing-library terminal size behavior (TUI)

- In `ink-testing-library`, the mocked stdout commonly exposes `columns`, but `rows` may be missing unless explicitly defined in tests.
- For resize/layout tests in `packages/orchestrator-tui`, explicitly define both dimensions on the mocked stdout object (including a getter for `rows` when needed by component hooks).
- Practical pattern:
  - set `stdout.columns = <value>`
  - define `rows` with `Object.defineProperty(stdout, "rows", { get: () => currentRows, configurable: true })`
  - emit `stdout.emit("resize")` after changing dimensions

## Company-scoped GUI routes for agent-browser checks

- Many board pages are mounted under a company prefix in the URL, not at bare paths.
- For reliable GUI validation, first query `GET /api/companies`, then navigate with the company slug prefix, e.g. `/WEA/company/export` instead of `/company/export`.
- Using non-prefixed paths can produce false negatives during visual checks (route not found / redirected states).

## Full-suite validator instability under repeated reruns

- In lifecycle scrutiny on 2026-04-10, repeated executions of `pnpm -C "/Users/aischool/work/papierklammer_droid" test:run -- --maxWorkers=1` alternated between pass and fail without repo code changes.
- Observed failures included `PostgresError: deadlock detected` in `server/src/__tests__/heartbeat-local-auth.test.ts` and `server/src/__tests__/heartbeat-direct-wakeup-lease.test.ts`.
- A later rerun also failed `server/src/__tests__/private-hostname-guard.test.ts` with `expected 200 to be 403`, suggesting an order-dependent full-suite state leak in addition to the deadlock flake.
- Treat current full-suite stability as suspect during scrutiny/user-testing gates and preserve the exact failing command output when handing off.
