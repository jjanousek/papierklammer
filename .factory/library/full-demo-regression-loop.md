## Full demo regression loop notes

- Fresh isolated instance flow verified on `PAPIERKLAMMER_HOME=/tmp/papierklammer-mission-64c225d0`, instance `audit`, app `http://localhost:3100`.
- Demo repo target stays at `/Users/aischool/work/papierklammer-audit-demo`; deterministic command is `pnpm --dir /Users/aischool/work/papierklammer-audit-demo smoke`, which writes `artifacts/latest-report.json`.
- A fresh onboarding company can start from the Web UI and land on the seeded issue, but a **technical** starter task assigned to the default CEO will first delegate instead of running the repo directly.
- The shipped TUI management path now works for the full loop. In the fresh 2026-04-05 rerun:
  1. launch `pnpm dev:tui --url http://127.0.0.1:3100 --company-id <company-id>`
  2. press `Tab`, then `a` to approve the pending CTO hire from the sidebar
  3. keep the sidebar focused on CTO and press `v` to invoke the CTO heartbeat from the same TUI session
- The TUI approval cleared the pending approval and the follow-up API state corroborated the same company:
  - company `74762368-22f7-4e88-9088-77eb7a12d49e` (`Audit Co`)
  - parent issue `AUD-1` / `ccd02dc2-25f9-4619-b63b-c4c5dd7325de`
  - CTO child issue `AUD-2` / `ebc4b247-a787-49d1-bac5-259b21b242bf`
  - TUI-invoked CTO run `45ecc95e-dc0c-41af-a08f-ca6f78e48691`
- After the TUI approval, an automatic CEO wake created a CTO child issue with the real demo-repo instructions:
  - use `/Users/aischool/work/papierklammer-audit-demo`
  - run `pnpm smoke`
  - report the effective workspace root
  - surface `/Users/aischool/work/papierklammer-audit-demo/artifacts/latest-report.json`
- The TUI-invoked CTO heartbeat completed the delegated issue and both API + Web UI corroborated the result:
  - `/api/issues/ebc4b247-a787-49d1-bac5-259b21b242bf` moved to `done` with `completedAt=2026-04-05T15:44:40.558Z`
  - the issue detail page at `/AUD/issues/AUD-2` showed completed run `45ecc95e`, the completion comment, and work product `latest-report.json`
  - the completion comment confirmed workspace root `/Users/aischool/work/papierklammer-audit-demo` and artifact path `/Users/aischool/work/papierklammer-audit-demo/artifacts/latest-report.json`
- Best operator review path after the run:
  1. parent issue for delegation history / approval link
  2. child issue for concrete smoke result and artifact path
  3. run detail for raw transcript / command history
- TUI company scoping, approval handling, heartbeat invocation, and run inspection all matched API/Web evidence in the same loop; no curl mutation was needed for the management steps in this rerun.
