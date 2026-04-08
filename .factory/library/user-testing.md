# User Testing

## Validation Surface

### Web UI
- Use `agent-browser` against the isolated local app instance served from `http://localhost:3100` unless the flow specifically starts from the precompany instance on `3101`.
- Validate company lifecycle controls, onboarding order/model selection/drafting, archived-vs-paused navigation behavior, issue-detail deep links, skill/invite branding, and operator-visible lifecycle/audit feedback.
- Keep one browser session tied to the active validation company so company context, screenshots, and network evidence remain aligned across each flow bundle.

### API
- Use `curl` against the same fresh isolated instance.
- Validate lifecycle routes, company activity visibility, issue-detail secondary endpoints, run-state convergence, invite/skill text surfaces, and onboarding-related API calls.
- Use API responses as the source of truth for `companyId`, `agentId`, `issueId`, and `runId` that browser evidence should match.

### TUI (conditional)
- Use TUI validation only if a feature explicitly changes orchestration/TUI-adjacent behavior.
- If needed, use a real PTY-driven terminal path (`tuistory` or equivalent). Raw non-interactive execution is not acceptable evidence.

## Validation Concurrency
- **Web UI:** max **1** concurrent validator. Rationale: lifecycle/onboarding flows mutate one active company context and race badly if run in parallel.
- **API:** max **1** concurrent validator for the active bundle. Rationale: API probes are lightweight, but they must stay aligned with the same browser-visible company and run state.
- **TUI:** max **1** concurrent validator when used. Rationale: PTY-backed sessions are stateful and should not overlap on the same local instance.
- **Overall bundle rule:** run only **one full validation bundle at a time**.
- **Process hygiene rule:** keep Node-based process count low. Reuse one active app instance when possible and stop temporary processes as soon as the relevant check is done.
- **Hard cap:** never exceed **4 concurrent Node.js processes** total during validation. This includes app servers, Vitest workers, helper scripts, and any temporary Node-based tooling.

## Validation Setup Notes
- Use a **fresh isolated local instance** for each major validation pass; do not reuse stale prior app state.
- Before a fresh validation pass, run the relevant reset command from `.factory/services.yaml` so the mission home starts clean.
- The isolated mission instances use distinct embedded PostgreSQL ports by default; prefer the manifest commands instead of ad hoc startup.
- Keep validation **local-only**; do not rely on Docker or remote hosted services.
- Use **real `codex_local`** when validating Codex-backed onboarding or drafting. If local Codex readiness fails, mark the affected assertions blocked and return to the orchestrator.
- In `local_trusted` mode, requests without an `Authorization` header are implicitly treated as board-authenticated. Do not use headerless requests as anonymous-denial evidence.
- Reuse the same `companyId`, `issueId`, `agentId`, and `runId` across browser and API checks within a bundle.
- When running validators, prefer the low-concurrency commands from `.factory/services.yaml`; do not increase worker counts unless the orchestrator updates the process limit.

## Flow Validator Guidance: Web UI
- Start lifecycle validation from a company that has real or recently created work so pause/archive quiesce behavior can be observed.
- Validate the active/paused/archived control matrix from Company Settings and any company-management list surfaces that expose delete.
- For archived-company flows, verify both default-navigation hiding and deep-link readability.
- For onboarding, verify the Agent-first step order, curated Codex models, AI draft actions, in-place editability, launch summary, and the created issue after a short settle window.
- For issue-detail validation, open a public issue-key route and inspect every secondary request the page makes.
- For branding validation, inspect both visible copy and any rendered snippets/instructions the operator can copy or review.

## Flow Validator Guidance: API
- Begin with `GET /api/health` on the fresh isolated instance, then use company-scoped reads/writes to confirm the entities created during onboarding and audit execution.
- Use API probes to anchor every cross-surface check: lifecycle transitions, company creation, agent/model selection, AI drafting calls, issue creation, active run identity, heartbeat run status, stale inventory, and unblock/cleanup recovery.
- During lifecycle validation, probe both the canonical routes and any legacy bypass candidates (`PATCH`/`DELETE`) so guardrails are actually proven.
- During run-state validation, poll the related run endpoints sequentially for the same issue and confirm matching identifiers instead of probing unrelated endpoints in parallel.
- When exercising cleanup or lifecycle quiesce, preserve transcripts that show both success and rejected admission attempts afterward.
