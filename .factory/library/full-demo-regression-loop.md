## Full demo regression loop notes

- Fresh isolated instance flow verified on `PAPIERKLAMMER_HOME=/tmp/papierklammer-mission-64c225d0`, instance `audit`, app `http://localhost:3100`.
- Demo repo target stays at `/Users/aischool/work/papierklammer-audit-demo`; deterministic command is `pnpm --dir /Users/aischool/work/papierklammer-audit-demo smoke`, which writes `artifacts/latest-report.json`.
- A fresh onboarding company can start from the Web UI and land on the seeded issue, but a **technical** starter task assigned to the default CEO will first delegate instead of running the repo directly.
- In the verified loop, the CEO created a CTO hire approval and blocked the parent issue until the board approved it. The approval endpoint needs a JSON body, even when empty:
  - `curl -X POST -H "Content-Type: application/json" -d '{}' http://localhost:3100/api/approvals/<approval-id>/approve`
- After approval, an automatic CEO wake succeeded and created a CTO child issue with the real demo-repo instructions:
  - use `/Users/aischool/work/papierklammer-audit-demo`
  - run `pnpm smoke`
  - report the effective workspace root
  - surface `/Users/aischool/work/papierklammer-audit-demo/artifacts/latest-report.json`
- A manual CTO heartbeat (`POST /api/agents/<cto-agent-id>/heartbeat/invoke`) then completed the delegated issue and posted a board-readable completion comment with:
  - workspace root `/Users/aischool/work/papierklammer-audit-demo`
  - command `pnpm smoke`
  - result `AUDIT_DEMO_OK`
  - artifact path `/Users/aischool/work/papierklammer-audit-demo/artifacts/latest-report.json`
  - SHA256 `0dab1df3b910f9f31547df45a5838907dd10468aab4a9315da361b6c75190aa2`
- Best operator review path after the run:
  1. parent issue for delegation history / approval link
  2. child issue for concrete smoke result and artifact path
  3. run detail for raw transcript / command history
- TUI company scoping and run inspection matched API status during the CTO run, but `tuistory` text entry can still drop characters in free-form prompts; prefer using the TUI for state inspection and use API/browser controls for mission-critical mutations when exact text matters.
