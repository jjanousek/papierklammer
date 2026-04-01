---
name: cli-worker
description: Implements CLI tools and commands for the orchestrator console
---

# CLI Worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the WORK PROCEDURE.

## When to Use This Skill

Features that involve:
- New CLI commands in the orchestrator console package
- New pnpm workspace package setup
- CLI REPL implementation
- HTTP client for orchestrator API

## Required Skills

None

## Work Procedure

1. **Read the feature description**. Understand what commands need to be built and what API endpoints they call.

2. **Read existing CLI code** for patterns:
   - `cli/src/index.ts` — command registration pattern (commander.js)
   - `cli/src/client/http.ts` — API client pattern
   - `cli/src/client/context.ts` — auth/context pattern
   - `cli/src/__tests__/` — test patterns

3. **Write tests first** (red):
   - Create test files in `packages/orchestrator-console/src/__tests__/`.
   - Mock the HTTP client to test command logic without a running server.
   - Test: command output format, error handling, argument parsing.
   - Run tests — they should FAIL.

4. **Implement**:
   - **Package setup** (if first feature): Create `packages/orchestrator-console/` with package.json, tsconfig.json, src/ directory. Add to pnpm-workspace.yaml if needed.
   - **HTTP client**: Create API client that calls `/api/orchestrator/*` endpoints. Follow patterns from `cli/src/client/http.ts`.
   - **Commands**: Use commander.js. Each command in its own file under `src/commands/`.
   - **REPL**: Use Node's `readline` module for interactive mode.
   - **Output formatting**: Pretty-print with tables/colors for terminal readability.

5. **Run tests** (green):
   - Run package-specific tests: `cd packages/orchestrator-console && npx vitest run`
   - `pnpm test:run` — all tests pass.
   - `pnpm -r typecheck` — no errors.
   - `pnpm build` — succeeds.

## Example Handoff

```json
{
  "salientSummary": "Created orchestrator-console package with commander.js CLI, HTTP client, and 4 commands: status, stale, nudge, cleanup. All 12 tests pass. Package builds and typechecks.",
  "whatWasImplemented": "New pnpm workspace package packages/orchestrator-console/ with: HTTP client (src/client.ts), 4 commands (src/commands/status.ts, stale.ts, nudge.ts, cleanup.ts), main entry (src/index.ts), bin configuration for papierklammer-orch command. 12 test cases in src/__tests__/.",
  "whatWasLeftUndone": "",
  "verification": {
    "commandsRun": [
      { "command": "cd packages/orchestrator-console && npx vitest run", "exitCode": 0, "observation": "12 tests passed" },
      { "command": "pnpm test:run", "exitCode": 0, "observation": "All tests pass" },
      { "command": "pnpm -r typecheck", "exitCode": 0, "observation": "No errors" },
      { "command": "pnpm build", "exitCode": 0, "observation": "All packages built" }
    ],
    "interactiveChecks": []
  },
  "tests": {
    "added": [
      { "file": "packages/orchestrator-console/src/__tests__/status.test.ts", "cases": [
        { "name": "prints agent overview table", "verifies": "status command output" },
        { "name": "handles auth error", "verifies": "error handling" }
      ]}
    ]
  },
  "discoveredIssues": []
}
```

## When to Return to Orchestrator

- API endpoints this CLI command depends on don't exist yet
- Authentication model unclear
- Package setup conflicts with existing workspace configuration
