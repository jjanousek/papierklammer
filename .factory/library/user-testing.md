# User Testing

## Validation Surface

### Web UI
- Use `agent-browser` against the default local dev app served from `http://localhost:3100`.
- Primary browser flows for this mission: company creation/add-company path, hire flows, approvals, issue delegation, dashboard/issues/inbox/agents review surfaces, and company-context anomalies.
- Keep one browser session tied to the dedicated QA company so company context, screenshots, and network evidence remain aligned.

### API
- Use `curl` against the same local app instance on `http://localhost:3100`.
- Use API responses as the source of truth for `companyId`, `agentId`, `approvalId`, `issueId`, issue key, and any `runId` values that browser and TUI evidence should match.
- The bootstrap pass must capture `/api/health` and `/api/companies` before deeper flows begin.

### TUI
- Use TUI validation only after the QA company exists.
- Use a real PTY-driven terminal path (`tuistory`).
- Focus on company resolution, switching, scoped polling, one management action, and whether empty/error states are distinguished correctly.

### Report artifacts
- The final markdown bug report must live in the repository.
- Supporting evidence notes may live in the mission directory, and raw screenshots/terminal captures/request snippets should live under the mission `evidence/raw/` directory.
- The final report must include a validation matrix, blocker classification, identifier ledger, and a short executive summary.

## Validation Concurrency
- **Web UI:** max **1** concurrent validator.
- **API:** max **1** concurrent validator aligned to the same browser/TUI bundle.
- **TUI:** max **1** concurrent validator when used.
- **Overall bundle rule:** run only **one full validation bundle at a time**.
- **Observed dry-run cost:** starting the local dev app increased the observed node-related process count by about **+9** over baseline in this environment.
- **Resource rule for this mission:** do not add overlapping Node-heavy helpers beyond the single active app and the current surface tool. Keep validation strictly sequential.

## Validation Setup Notes
- Use the default local dev app from `.factory/services.yaml`; do not start a second app instance unless the orchestrator explicitly changes the plan.
- Keep validation **local-only**; do not rely on Docker or remote hosted services.
- Do not reset the default database or delete pre-existing companies. Instead, create a uniquely named QA company and record the starting company inventory before doing so.
- In `local_trusted` mode, requests without an `Authorization` header are implicitly treated as board-authenticated. Do not use headerless requests as anonymous-denial evidence.
- Reuse the same `companyId`, `issueId`, `agentId`, `approvalId`, and `runId` across browser, API, and TUI checks within a bundle.
- When a prerequisite bug blocks a later flow, record the blocker immediately and continue with any remaining reachable surfaces.
- Workers write evidence artifacts; validators own `validation-state.json` and update assertion statuses from those artifacts.

## Flow Validator Guidance: Web UI
- Capture the actual path used to create the QA company: first-run onboarding or add-company flow.
- Trigger one invalid onboarding or agent-readiness path before the real successful create path.
- For hire validation, exercise both direct-hire and approval-gated hire paths.
- For approval-gated hires, verify both “blocked before approval” and “usable after approval.”
- Visit dashboard, approvals, inbox, issues, issue detail, agents, and agent detail explicitly; note “no issue observed” when a surface behaves correctly.

## Flow Validator Guidance: API
- Begin with `GET /api/health` and `GET /api/companies`.
- Use API probes to anchor every cross-surface check: created company, hires, approvals, issue assignment, and any run/wakeup state.
- Preserve exact IDs and issue keys as they appear in payloads so the report can map them back to browser/TUI evidence.
- Keep API checks sequential and scoped to the same QA company.

## Flow Validator Guidance: TUI
- Launch the TUI only after the QA company exists.
- Record whether launch/selection resolves the intended QA company cleanly or falls back in a surprising way.
- If the TUI is usable, capture one real management action and reconcile it with API or browser truth.
- Note whether the TUI distinguishes true empty states from polling failures.
