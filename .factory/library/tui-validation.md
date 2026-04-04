# TUI validation notes

- PTY validation against the isolated audit instance on `http://127.0.0.1:3100` confirmed that the company picker defaults to the most recently updated company and that relaunching into a different `--company-id` starts with an empty transcript.
- During live Codex turns, the TUI now passes the selected `companyId`, `companyName`, and normalized base URL into thread instructions and turn input. This was visible in test coverage and in PTY assistant output.
- In local PTY validation, the Codex `paperclip` skill still reported that `http://127.0.0.1:3100` was unreachable from its session, so vague-intent turns produced scoped “intended issue” text instead of creating the issue through the API.
- Launching the TUI entrypoint with `codex` intentionally removed from `PATH` crashes on `spawn codex ENOENT` before a turn begins; this is a separate runtime hardening gap outside the company-scoping fix.
