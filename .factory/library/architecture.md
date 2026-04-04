# Architecture

## What this mission covers
- Auditing Papierklammer end to end against a real tiny sibling CLI repository using a fresh local-only instance.
- Verifying the operator loop across onboarding, issue creation, issue execution, output inspection, stale-work detection, and recovery.
- Stressing the places this mission cares about most: company scoping, orchestrator behavior, stale runs/intents/issues, and operator-visible output.
- Treating the Web UI, Orchestrator TUI, and API as one control-plane system that must agree on the same company, issue, and run state.

## Runtime surfaces
### Web UI
- Board-facing React app served from the local server, used for first-company onboarding and day-to-day review.
- After company selection, the UI operates in company context and drives issue, agent, run, and settings pages for that company.
- This mission relies on it to confirm onboarding flow, visible work state, live/completed run review, and post-recovery state.

### Orchestrator TUI
- Ink-based terminal console in `packages/orchestrator-tui`, launched against the same local instance and requiring a real PTY.
- Starts with a company picker when no company is preselected, then polls orchestrator status and lets the operator turn free-form intent into normal company actions.
- Mission-critical behaviors are company selection, action reliability, failure recovery, and the operator’s ability to see that the right company is being managed.

### API
- Express API in `server/src` is the ground-truth state surface for health, companies, issues, runs, and orchestrator actions.
- Key audit paths include health/onboarding checks plus orchestrator status, stale inventory, nudge, unblock, active-run, live-run, and heartbeat-run endpoints.
- Board auth and company access checks are part of the mission: denial and isolation checks are first-class evidence, not secondary polish. If the API is wrong, the UI and TUI evidence do not count as trustworthy.

### CLI heartbeat runner
- The shipped CLI is also a real runtime consumer for this mission, especially `papierklammer heartbeat run`.
- That command explicitly supports agent-authenticated usage via `--api-key`, triggers `/agents/:id/wakeup`, and then polls `/api/heartbeat-runs/:runId/events` plus `/api/heartbeat-runs/:runId/log` to stream progress.
- Auth or contract changes on heartbeat-run detail endpoints must preserve this CLI path or reject it intentionally and explicitly; otherwise in-repo runtime validation can regress even if Web UI and TUI checks still pass.

### Demo repo audit target
- A tiny sibling CLI repository created near this workspace and used as the real managed project for the audit.
- Small enough for repeatable local runs, but real enough to produce actual issue execution, file changes, and inspectable outputs.
- It is the execution target that proves Papierklammer is managing real work rather than only shuffling control-plane metadata.

## Core control flow
1. Start a fresh isolated local Papierklammer instance and confirm the API is healthy before any company exists.
2. Onboard the first company in the Web UI with `codex_local`, and confirm adapter readiness before depending on execution.
3. Seed or create work tied to the demo CLI repo through one of the main entry paths: onboarding-created starter work, board-created work in the Web UI, or TUI-created orchestrator work.
4. Make sure the same company context is selected across UI, TUI, and API checks before mutating or reviewing that work.
5. Let the assigned `codex_local` agent pick up that work, create a heartbeat run, and execute against the demo repo workspace.
6. Review live progress and final results through issue/run surfaces while matching the same `companyId`, `issueId`, and `runId` across operator surfaces.
7. Exercise stale or blocked paths, recover them through cleanup or unblock actions, and verify all surfaces converge back to a schedulable, reviewable state.

## State and invariants
- Every important record is company-scoped; no action in company A should create, reveal, or mutate work in company B.
- The selected company in the Web UI and the selected company in the TUI must match the company used for follow-up API reads and mutations.
- One live run should keep the same identity across issue detail, company live-run feeds, heartbeat-run feeds, and orchestrator status.
- `codex_local` must be locally installed and authenticated enough to pass environment validation before the mission relies on it.
- Stale recovery is explicit and observable: cleanup or unblock should clear ownership and stale queued work rather than merely hiding symptoms.
- Completed or failed runs must remain reviewable through operator-facing output surfaces, not only via backend-only state.
- This mission is local-only and fresh-instance oriented; do not rely on Docker, remote services, or leftover prior state.

## Known risk concentrations
- Company-context drift between prefixed Web UI routes, stored selected-company state, and TUI company selection.
- Onboarding or adapter-validation paths reporting `codex_local` readiness incorrectly before real work starts.
- Stale run, lease, and intent cleanup leaving an issue half-locked or causing UI/TUI/API status disagreement.
- Output-visibility failures where work runs exist but operators cannot inspect transcript, logs, or results from issue-centric review flows.
- TUI startup and action handling around no-company state, PTY requirements, failed turns, and company switching.
- Demo-repo workspace/session reuse during repeated local runs, especially after stale failures or forced recovery.

## Worker guidance
- Think in evidence chains: company -> issue -> run -> output.
- Use the API as the truth source first, then verify how the Web UI and TUI represent that same state.
- Primary proof endpoints in this mission are `/api/health`, `/api/companies`, `/api/orchestrator/status`, `/api/orchestrator/stale`, `/api/issues/:issueId/active-run`, `/api/issues/:issueId/live-runs`, and `/api/companies/:companyId/heartbeat-runs`.
- When comparing operator-facing run summaries across surfaces, keep the UI/TUI field precedence aligned with the existing server-side heartbeat-run summary behavior, including structured `error` summaries for failed runs.
- Prioritize onboarding, company scoping, run visibility, and stale recovery over low-value implementation details.
- Use the demo CLI repo for real execution and output review, not synthetic placeholders.
- Prefer fresh local state over inherited state whenever behavior is ambiguous.
- If `codex_local`, PTY access, or company scoping is broken, treat that as a mission blocker and report it clearly.
