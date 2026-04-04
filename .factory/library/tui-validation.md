# TUI validation notes

- PTY validation against the isolated audit instance on `http://127.0.0.1:3100` confirmed that the company picker defaults to the most recently updated company and that relaunching into a different `--company-id` starts with an empty transcript.
- During live Codex turns, the TUI now passes the selected `companyId`, `companyName`, and normalized base URL into thread instructions and turn input. This was visible in test coverage and in PTY assistant output.
- The TUI now starts `codex app-server` with `-c sandbox_workspace_write.network_access=true`, which was required for live Codex turns to `curl` the local Papierklammer API and create real company-scoped issues during PTY validation.
- Launching the TUI entrypoint with `codex` intentionally removed from `PATH` now leaves the console up in a recoverable disconnected state with `Codex: disconnected | Error: spawn codex ENOENT` instead of crashing the Ink process.
