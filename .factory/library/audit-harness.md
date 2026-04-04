# Audit harness helpers

- Demo repo path: `/Users/aischool/work/papierklammer-audit-demo`
- Mission home root: `/tmp/papierklammer-mission-64c225d0`
- Deterministic demo smoke command:
  - `pnpm --dir /Users/aischool/work/papierklammer-audit-demo smoke`
  - writes `/Users/aischool/work/papierklammer-audit-demo/artifacts/latest-report.json`
- Repo helper commands:
  - `pnpm audit:demo:create`
  - `pnpm audit:instance:audit:fresh`
  - `pnpm audit:instance:precompany:fresh`
  - `pnpm audit:bootstrap`
- Use the helper commands before starting the isolated services if you want a fresh bootstrapped instance with config already written for ports `3100` and `3101`.
