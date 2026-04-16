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
- For the current local trusted validation instance, launching `pnpm dev:tui -- --url http://127.0.0.1:3100 --company-id <seeded-company-id>` can leave the chat shell stuck at `Waiting for response...`; prefer single-company auto-resolution via `pnpm dev:tui -- --url http://127.0.0.1:3100` unless a validator is explicitly testing company switching.
- For Ink `TextInput` fields, prefer explicit per-key `tuistory press ...` sequences over bulk `tuistory type ...`; the bulk text command can intermittently drop characters in alternate-screen Ink sessions.
- For issue-composer failure-path validation, a real local fetch failure can be induced by stopping the live app listener on port `3100` immediately before submitting the filled overlay. The current TUI keeps the overlay open, preserves entered values, and shows `fetch failed`; restart with `env PAPIERKLAMMER_HOME=/tmp/papierklammer-tui-mission PAPIERKLAMMER_INSTANCE_ID=tui-mission PORT=3100 pnpm --dir "/Users/aischool/work/papierklammer_droid" dev:once` and wait for `/api/health`.
- For message-send failure-path validation, killing the TUI-owned `codex app-server` subprocess after `Waiting for response...` appears is a deterministic negative probe. Current shipped behavior auto-reconnects Codex but leaves the composer stuck in `Waiting for response...` without a visible failure or retryable idle state; use this as regression evidence for `VAL-FOCUS-003`.
- Capture:
  - startup frame
  - the key interaction sequence
  - the final frame
  - any intermediate frames needed for streaming/tool/reasoning assertions
- When validating company scope, pair the terminal evidence with minimal `curl` setup proof for the selected company.
