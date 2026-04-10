# User Testing

## Validation Surface

### Web UI
- Use `agent-browser` against the local app on `http://127.0.0.1:3100` only when a browser assertion is required by the contract.
- Primary browser flows for this mission are low-cost rename checks: root/auth/CLI-approval/dashboard text, visible links, and localStorage behavior.
- Prefer deterministic text/link/key checks over broad manual exploration.

### API
- Use `curl` against the same local app instance on `http://127.0.0.1:3100`.
- Primary API checks: skill discovery, skill fetches, skill sync responses, session/runtime payloads, and other lightweight rename-sensitive routes.
- Use API probes as the main source of truth for contract assertions that do not require a browser.

### CLI and operator scripts
- Use lightweight `pnpm papierklammer ... --help` / safe diagnostic commands as the main operator-surface validation path.
- For active scripts, prefer deterministic scans or safe dry-run style invocations that do not mutate user state.
- Use temporary directories/home overrides for installer/onboarding probes when possible.

### TUI
- TUI is a secondary rename surface.
- Validate only if a low-process, non-overlapping check is feasible within the user’s strict process budget.
- Prefer passive or narrowly scoped probes over long interactive sessions.

## Validation Concurrency

### Validation Concurrency
- **Web UI:** max **1** concurrent validator.
- **API:** max **1** concurrent validator.
- **CLI/scripts:** max **1** concurrent validator.
- **TUI:** max **1** concurrent validator, only if used.
- **Overall rule:** run only **one validation surface bundle at a time**.
- **Process rule:** the mission must stay within the user’s strict low-memory posture; do not intentionally exceed 4 mission-started Node processes.

## Validation Setup Notes
- Stop repo-owned extra dev/watch/TUI processes before starting validation work.
- Reuse the existing app entrypoint/port from `.factory/services.yaml`; do not start a second local app instance.
- Keep validation local-only; do not rely on Docker or remote services.
- The full `pnpm test:run -- --maxWorkers=1` suite is not the mission baseline because it exceeds the process budget.
- Scope repo sweeps carefully: include active code, active `skills/`, active `.factory/skills/`, active `scripts/`, and other explicitly in-scope live files; exclude historical docs, tests unless required, dist output, and mission artifacts.
- Treat compatibility/vendor filenames such as `.paperclip.yaml` as allowlisted only when the contract or worker guidance explicitly says so.

## Flow Validator Guidance: Web UI
- Capture visible `Papierklammer` versus `Paperclip` text on the exact pages named in the assertion.
- When validating localStorage hard cuts, seed only the legacy keys needed for the contract, reload once, and record both the pre-seeded and post-load key state.
- Record legacy docs/link targets if a page still points to them.

## Flow Validator Guidance: API
- Begin with the exact route named by the assertion; do not broaden scope unnecessarily.
- For skill/API assertions, capture both success on the renamed path and failure on the legacy path when the contract requires a hard cut.
- For sync/mutation assertions, capture the request plus the resulting observable snapshot/state.

## Flow Validator Guidance: CLI and scripts
- Favor `--help`, `--version`, safe error paths, and deterministic scans before trying heavier commands.
- When a contract requires generated names/prefixes, use isolated temp output paths or dry-run-friendly inputs so validation does not pollute the user’s real environment.
- For script inventory checks, preserve the exact scan command and match criteria in the evidence.

## Flow Validator Guidance: TUI
- Skip the TUI surface unless it can be exercised without violating the process budget.
- If used, keep the check short and capture only the rename-relevant output.
