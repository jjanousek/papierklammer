# User Testing

## Validation Surface

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

## Assertion-specific guidance

- Entry and shell assertions must capture full-page screenshots so route-vs-modal overlap and CTA competition are visible.
- Failure-path assertions must capture both the visible error state and before/after API evidence proving zero mutation.
- Exactly-once assertions must capture retry actions plus post-action API state proving there is only one mutation set.
- Invite human-join assertions should show the joiner-facing state and the operator-facing Inbox state.
- Agent-claim assertions should pair browser evidence for approval states with explicit claim API responses.
- Import assertions should capture source mode, target mode, preview, and final landing so stale preview bugs cannot hide.

## Evidence Convention

- Prefer durable evidence paths under `.factory/validation/<milestone>/...` whenever a validator or worker saves screenshots or API transcripts for follow-up.
- Include fulfilled `VAL-*` IDs in filenames or adjacent notes when practical so the evidence can be traced back to the validation contract without manual guesswork.
