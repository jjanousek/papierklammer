# User Testing

## Validation Surface

### Web UI
- Use `agent-browser` against the fresh local-only Papierklammer instance served from `http://localhost:3100`.
- Validate first-run onboarding, `codex_local` environment readiness, company-scoped issue visibility, live run visibility, and post-recovery issue state.
- Keep one browser session tied to the active audit company so screenshots, network traces, and visible company context stay consistent across the bundle.

### Orchestrator TUI
- Use a real PTY-driven terminal path (`tuistory` or equivalent manual terminal capture) against the same local server instance.
- Validate the pre-company refusal path, post-onboarding company picker/company session, orchestrator actions, failure recovery, and any available in-TUI run/result inspection.
- Treat raw non-interactive execution as insufficient for TUI evidence; the mission requires an actual terminal session.

### API
- Use `curl` against the same fresh isolated instance.
- Validate `/api/health`, company/agent/issue reads and writes, live-run consistency endpoints, and stale/unblock/nudge recovery endpoints.
- Use API responses as the source of truth for `companyId`, `agentId`, `issueId`, and `runId` that should match Web UI and TUI evidence.

## Validation Concurrency
- **Web UI:** max **1** concurrent validator. Rationale: the audit depends on one fresh instance, one selected company context, and one live browser state; parallel browser validators would race onboarding, company switching, and live-run evidence.
- **Orchestrator TUI:** max **1** concurrent validator. Rationale: the TUI is company/session oriented and must be driven through one PTY at a time to avoid thread-context leakage and conflicting orchestrator actions.
- **API:** max **1** concurrent validator for the active audit bundle. Rationale: API probes are lightweight, but this mission uses them to confirm the same live company/run state seen in UI and TUI, so sequential probes keep evidence aligned and avoid mutating the fresh instance out of band.
- **Overall bundle rule:** run only **one full validation bundle at a time** across Web UI + TUI + API. Rationale: the approved plan is local-only on one fresh isolated instance with `codex_local`, and correctness of cross-surface state matters more than throughput.
- **Process hygiene rule:** keep Node-based process count low. Reuse one active app instance when possible, and stop temporary app/TUI processes immediately after the step that needed them.

## Validation Setup Notes
- Use a **fresh isolated local instance** for the audit; do not reuse stale prior app state.
- Before a fresh validation pass, run the relevant reset command from `.factory/services.yaml` (`reset_audit_instance` or `reset_precompany_instance`) so the mission home starts from clean state.
- The isolated audit harness now assigns distinct embedded PostgreSQL ports by default: `audit` uses `54329` and `precompany` uses `54330`. You can run both mission services concurrently without manual config edits.
- Keep the mission **local-only**; do not rely on Docker, remote services, or hosted integrations.
- Use **`codex_local` only** for the audited company. If local Codex install/auth readiness fails, mark the affected flow blocked instead of substituting another adapter.
- Use the tiny sibling CLI repo created for the audit as the managed project under real execution.
- Capture and reuse the same `companyId`, `issueId`, `agentId`, and `runId` across all three surfaces.
- Start with API health and empty-instance checks before onboarding, then create the company in Web UI, then validate the TUI against that created company.
- When validating stale recovery or company isolation, use a second company only for explicit negative checks; do not run a second full bundle in parallel.
- If you start a local server or TUI process only for one check, stop it before continuing to the next unrelated check.

## Flow Validator Guidance: Web UI
- Start from the empty-instance onboarding flow and confirm the product enters first-company setup instead of a broken dashboard.
- During onboarding, explicitly select `codex_local` and capture the successful environment validation result before relying on the adapter for real work.
- Keep validation focused on the audit company’s issue, run, and recovery views; use company switching only when the contract calls for an isolation check.
- When validating live execution, correlate visible run state with the exact `issueId`/`runId` already confirmed via API.
- After stale cleanup or unblock actions, refresh the issue list/detail views and verify the UI no longer presents the issue as actively running.

## Flow Validator Guidance: Orchestrator TUI
- Validate the no-company startup refusal first only on a truly fresh instance; after onboarding, relaunch and confirm the TUI becomes usable for the created company.
- Use the company picker or loaded-company header as explicit evidence that the TUI is scoped to the intended company before issuing management requests.
- Drive one orchestrator action chain at a time for the audit company: create work, nudge active work, or unblock stuck work; do not overlap actions.
- For company-switch isolation checks, relaunch into company B after using company A and verify no stale thread/transcript context leaks across launches.
- If the TUI lacks a concrete run-output/result inspection affordance, record that negative result explicitly rather than inferring success from API-only evidence.

## Flow Validator Guidance: API
- Begin with `GET /api/health` on the fresh isolated instance, then use company-scoped reads/writes to confirm the entities created during onboarding and audit execution.
- Use API probes to anchor every cross-surface check: company creation, agent selection, issue creation, active run identity, heartbeat run status, stale inventory, nudge intent, and unblock recovery.
- During live-run validation, poll the related run endpoints sequentially for the same issue and confirm matching identifiers instead of probing unrelated endpoints in parallel.
- When exercising nudge, unblock, or stale cleanup, include the required negative company-isolation check so recovery actions are proven to affect only the target company.
- Preserve request/response transcripts that show both success cases and expected failures (for example no-company, no-active-issue, wrong-company, or blocked adapter readiness).
