# User Testing

## Validation Surface

### Terminal UI (TUI)
- For orchestrator TUI milestones, use the real PTY surface via `tuistory`.
- Reuse the healthy local trusted app on `http://127.0.0.1:3100` when available; do not start parallel app instances or switch ports.
- Launch the shipped TUI with isolated local state: `env PAPIERKLAMMER_HOME=/tmp/papierklammer-tui-mission PAPIERKLAMMER_INSTANCE_ID=tui-mission pnpm --dir "/Users/aischool/work/papierklammer_droid" dev:tui -- --url http://127.0.0.1:3100`
- If `/api/companies` already returns at least one company, reuse that seeded company instead of reseeding.
- Prefer per-key `tuistory press` input over `tuistory type` when Ink text entry becomes unreliable.

### Browser UI
- This is the primary validation surface for the mission.
- Use `agent-browser` for all operator-visible onboarding assertions.
- Annotated screenshots are mandatory for entry, wizard, invite, import, and regression checks.
- Prefer one browser session for the entire validation bundle.

### API support
- Use `curl` only to support browser validation where backend-state proof is required.
- Typical support probes:
  - `GET /api/health`
  - `GET /api/companies`
  - company-scoped `GET` routes for agents/issues/projects when proving mutation or non-mutation
  - invite/join claim endpoints when validating approval-gated agent claim behavior
- API evidence complements browser assertions; it does not replace them.

## Validation Concurrency

### Terminal UI (TUI)
- **Max concurrent validators: 1**
- Rationale: one TUI/PTTY session on the shared local app is the safe ceiling for this repo and avoids transcript/company-state interference.

### Browser UI
- **Max concurrent validators: 1**
- Rationale: one browser session plus one local app instance is sufficient and avoids exceeding the user’s 3-process Node budget.

### API support
- **Max concurrent validators: 1**
- Rationale: curl-based probes are lightweight, but should be serialized with browser work to avoid confusing shared state.

### Overall rule
- Run a single validation bundle at a time.
- Reuse one healthy app on `3100` instead of starting parallel app instances.

## Validation Setup Notes

- Prefer the `qa-app` service from `.factory/services.yaml` when a healthy mission-owned app is needed.
- If `http://127.0.0.1:3100/api/health` is already healthy and the worker did not start that process, reuse it and do not stop it.
- If the worker starts `qa-app`, stop it via the mission pid file after validation is complete.
- Do not use Docker-based release smoke flows in this mission.
- Use the mission home at `/tmp/papierklammer-onboarding-mission` for any mission-started service.
- For bootstrap/auth gate assertions, if port `3100` is already occupied by a healthy non-worker-owned app and the mission cannot start a separate authenticated instance on the required port, browser-side mock injection of health/session responses against the reused app is an acceptable fallback. Capture the mocked routes, final URL, and screenshots so the evidence is auditable.
- On the current onboarding mission app, a seeded company can prevent auditable zero-company route recovery; if browser-side interception of local `/api/*` traffic is unstable, treat first-run root/deep-link and bootstrap/auth assertions as blocked and schedule a fresh first-run round instead of mutating the shared seeded state.

## Assertion-specific guidance

- Entry and shell assertions must capture full-page screenshots so route-vs-modal overlap and CTA competition are visible.
- Failure-path assertions must capture both the visible error state and before/after API evidence proving zero mutation.
- Exactly-once assertions must capture retry actions plus post-action API state proving there is only one mutation set.
- Invite human-join assertions should show the joiner-facing state and the operator-facing Inbox state.
- Agent-claim assertions should pair browser evidence for approval states with explicit claim API responses.
- Import assertions should capture source mode, target mode, preview, and final landing so stale preview bugs cannot hide.

## Flow Validator Guidance: TUI

- Stay on port `3100` only and reuse the existing healthy app whenever possible.
- Keep validation inside the shared isolation boundary: `PAPIERKLAMMER_HOME=/tmp/papierklammer-tui-mission`, `PAPIERKLAMMER_INSTANCE_ID=tui-mission`.
- Do not create extra repo-owned dev/TUI/Codex helpers beyond what your assigned flow needs.
- Prefer a single launched TUI session per assertion bundle; relaunch only when the PTY relay or Ink input becomes unreliable.
- Save terminal captures and screenshots under the mission evidence directory for the assigned flow group so synthesis can trace them back to exact `VAL-*` assertions.

## Flow Validator Guidance: Browser UI

- Reuse the already-healthy app at `http://127.0.0.1:3100`; do not start another app stack unless health fails during the assigned run.
- Stay within one non-default `agent-browser` session for a milestone bundle and do not open concurrent browser sessions against the shared app.
- Keep onboarding-entry validation focused on route recovery, shell clarity, bootstrap/auth gating, close/reopen, and history behavior.
- Avoid unnecessary entity-creating flows for onboarding-entry; prefer route and shell checks unless the assigned assertion explicitly requires mutation proof.
- Save durable screenshots and JSON output under `.factory/validation/onboarding-entry/user-testing/` so synthesis can trace each `VAL-*` assertion to evidence.

## Evidence Convention

- Prefer durable evidence paths under `.factory/validation/<milestone>/...` whenever a validator or worker saves screenshots or API transcripts for follow-up.
- Include fulfilled `VAL-*` IDs in filenames or adjacent notes when practical so the evidence can be traced back to the validation contract without manual guesswork.
