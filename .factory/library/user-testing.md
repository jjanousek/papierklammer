# User Testing

## Validation Surface

### TUI
- This is the primary validation surface for the mission.
- Use `tuistory` for PTY-backed interaction and evidence capture.
- Validate against the local trusted app on `http://127.0.0.1:3100`.
- Full-flow validation requires a seeded company.

### API setup support
- Use `curl` only to prove local health and seed validation data for the TUI.
- Primary setup routes:
  - `GET /api/health`
  - `GET /api/companies`
  - `POST /api/companies` when a validation company must be created in local trusted mode
- Use API probes to confirm company selection/setup before launching the TUI.

## Validation Concurrency

### Validation Concurrency
- **TUI:** max **2** concurrent validators.
- **API setup support:** max **1** concurrent validator.
- **Overall rule:** prefer one validation surface bundle at a time unless the validator explicitly parallelizes within the approved TUI limit.

## Validation Setup Notes
- Stop repo-owned extra dev/watch/TUI processes before starting validation work.
- Reuse the existing app entrypoint/port from `.factory/services.yaml`; do not start a second local app instance.
- Keep validation local-only; do not rely on Docker or remote services.
- Use a temporary isolated home/instance:
  - `PAPIERKLAMMER_HOME=/tmp/papierklammer-tui-mission`
  - `PAPIERKLAMMER_INSTANCE_ID=tui-mission`
- If `/api/companies` is empty, create a validation company first. Example local trusted seed command:

```sh
curl -sf -X POST http://127.0.0.1:3100/api/companies \
  -H 'content-type: application/json' \
  -d '{"name":"TUI Validation Co","description":"Mission fixture"}'
```

- Use broader seeded fixtures only when the assertion needs them (for example multi-company switching or long issue queues).

## Flow Validator Guidance: TUI
- Use `tuistory launch`, `wait-idle`, snapshots, and keystroke playback to validate shipped TUI behavior.
- Prefer validating through `pnpm dev:tui` once a seeded company exists; use the direct TUI entrypoint only when isolating launcher-vs-runtime behavior matters.
- Capture:
  - startup frame
  - the key interaction sequence
  - the final frame
  - any intermediate frames needed for streaming/tool/reasoning assertions
- When validating company scope, pair the terminal evidence with minimal `curl` setup proof for the selected company.
