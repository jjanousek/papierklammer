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
