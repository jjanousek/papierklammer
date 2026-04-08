---
name: audit-worker
description: Builds the demo repo, isolated audit harness, and cross-surface regression flows for the Papierklammer audit mission
---

# Audit Worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the WORK PROCEDURE.

## When to Use This Skill

Features that involve:
- Creating or updating the tiny sibling CLI demo repo used for the mission
- Adding isolated-instance helpers or audit harness code/scripts
- Cross-surface regression features that must prove Web UI + TUI + API work together
- End-to-end audit preparation and replay against the demo repo

## Required Skills

- `agent-browser` — use for Web UI onboarding, issue/run review, and cross-surface evidence collection
- `tuistory` — use for PTY-driven orchestrator TUI validation and transcript capture

## Work Procedure

1. Read the feature description, mission contract assertions in `fulfills`, `.factory/library/architecture.md`, `.factory/library/environment.md`, and `.factory/library/user-testing.md`.
2. Read the current runtime entrypoints before editing:
   - `package.json`
   - `doc/DEVELOPING.md`
   - `scripts/dev-tui*.mjs`
   - onboarding and issue/run flows relevant to the feature
3. If the feature changes code, write tests first for the repo code you are modifying. Use the narrowest existing suite that proves the new behavior.
4. For demo-repo work, create or update the sibling CLI repo with real files and commands the agent can run. Keep it intentionally small and deterministic.
5. For isolated-instance work, use the mission paths and ports from `.factory/services.yaml` and `.factory/library/environment.md`. Do not reuse the default Papierklammer instance.
6. Be conservative about Node-based processes. Prefer one running app instance at a time, avoid parallel local runtime processes, stop temporary dev/TUI processes as soon as the relevant check completes, and never exceed 4 concurrent Node.js processes total.
7. Run the real audit flow required by the feature:
   - API health / setup with `curl`
   - Web UI checks with `agent-browser`
   - TUI checks with `tuistory`
   - Confirm the same `companyId`, `issueId`, and `runId` across surfaces when relevant
8. Run automated verification:
   - targeted tests first
   - `pnpm -r typecheck`
   - `pnpm test:run -- --maxWorkers=5`
   - `pnpm build` when feature scope affects shipped runtime behavior broadly
9. In the handoff, include the exact demo repo path used, isolated instance path(s), ports, which processes you started, and confirmation that temporary processes were stopped or intentionally reused.

## Example Handoff

```json
{
  "salientSummary": "Created a tiny sibling CLI repo plus an isolated audit bootstrap path, then proved onboarding -> issue run -> result review works against that repo across Web UI, TUI, and API. The same company, issue, and run identifiers matched across all captured surfaces.",
  "whatWasImplemented": "Added scripts/audit/create-demo-cli.mjs and scripts/audit/reset-isolated-instance.mjs, created ../papierklammer-audit-demo with package.json and a small Node CLI task, and updated runtime helpers so workers/validators can spin up a fresh isolated instance on 3100 or a precompany instance on 3101. Added focused tests for helper behavior and used the demo repo to validate the end-to-end control loop.",
  "whatWasLeftUndone": "",
  "verification": {
    "commandsRun": [
      {
        "command": "pnpm exec vitest run server/src/__tests__/onboarding-routes.test.ts --maxWorkers=5",
        "exitCode": 0,
        "observation": "Focused runtime test passed with the new audit helper paths"
      },
      {
        "command": "pnpm -r typecheck",
        "exitCode": 0,
        "observation": "All packages typechecked successfully"
      },
      {
        "command": "pnpm test:run -- --maxWorkers=5",
        "exitCode": 0,
        "observation": "Full Vitest suite passed"
      }
    ],
    "interactiveChecks": [
      {
        "action": "Completed onboarding in the Web UI against the isolated audit instance",
        "observed": "Created company AUD, codex_local validated, landed on issue AUD-1"
      },
      {
        "action": "Opened the orchestrator TUI with tuistory against the same company",
        "observed": "TUI loaded the correct company and created a follow-up issue visible in API and Web UI"
      }
    ]
  },
  "tests": {
    "added": [
      {
        "file": "server/src/__tests__/audit-bootstrap.test.ts",
        "cases": [
          {
            "name": "uses isolated instance paths for audit bootstrap",
            "verifies": "fresh mission state isolation"
          }
        ]
      }
    ]
  },
  "discoveredIssues": []
}
```

## When to Return to Orchestrator

- `codex_local` is not installed, not authenticated, or cannot pass environment validation
- The demo repo cannot be executed locally from a stable absolute path
- PTY-backed TUI validation is unavailable
- Cross-surface identifiers (`companyId`, `issueId`, `runId`) cannot be reconciled from the available surfaces
