---
name: audit-worker
description: Runs the Papierklammer QA audit, captures evidence across browser/API/TUI, and produces the bug report artifacts
---

# Audit Worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the WORK PROCEDURE.

## When to Use This Skill

Features that involve:
- Starting the QA runtime and auditing bootstrap behavior
- Exercising browser/API hire and delegation flows
- Running post-company TUI checks
- Writing evidence notes, the final markdown bug report, or the final handoff note

## Required Skills

- `agent-browser` — use for browser-visible operator flows and screenshots/network evidence
- `tuistory` — use for PTY-driven orchestrator TUI validation and transcript capture once the QA company exists

## Work Procedure

1. Read the feature description, the `fulfills` assertions, `mission.md`, `AGENTS.md`, `.factory/library/architecture.md`, `.factory/library/environment.md`, `.factory/library/user-testing.md`, and `.factory/library/qa-report.md`.
2. Read the runtime entrypoints before acting:
   - `package.json`
   - `doc/DEVELOPING.md`
   - browser/TUI files relevant to the feature
3. This is a QA-only mission. Do not fix product bugs as part of normal execution. If a minimal environment-only adjustment is clearly required to keep the audit executable, make it only when the feature explicitly calls for it; otherwise report the blocker.
4. Keep the runtime conservative:
   - use the single app instance from `.factory/services.yaml`
   - keep browser/API/TUI work sequential
   - stop temporary Node-based processes as soon as their evidence is captured
5. Capture evidence while you audit, not afterward from memory. Preserve:
   - screenshots
   - terminal captures
   - request/response snippets
   - `companyId`, `agentId`, `approvalId`, `issueId`, issue key, and `runId` values
6. When a prerequisite bug blocks the next planned flow:
   - capture the blocker immediately
   - record which downstream assertions are now blocked
   - continue with any remaining reachable surfaces
7. For browser work, use `agent-browser`. For TUI work, use `tuistory`. Raw prose without captured evidence is not sufficient.
8. When writing evidence artifacts or the final report, follow `.factory/library/qa-report.md` exactly.
9. Run automated verification after any file edits:
   - `pnpm -r --workspace-concurrency=1 typecheck`
   - `pnpm test:run -- --maxWorkers=1`
   - run `pnpm -r --workspace-concurrency=1 build` only if your feature changed shipped runtime code or required runtime-facing edits that justify a full build
10. In the handoff, include the QA company name, the key identifiers captured, the report/evidence paths you wrote, the processes you started, and whether they were stopped.

## Example Handoff

```json
{
  "salientSummary": "Ran the lifecycle QA pass against a dedicated QA company, captured browser/API/TUI evidence for direct hire, approval-gated hire, and delegation, and wrote the markdown bug report plus the final handoff note. Two product bugs were recorded and one downstream TUI assertion was marked blocked by an earlier routing failure.",
  "whatWasImplemented": "Started the local dev app on port 3100, created the QA company `Papierklammer QA Audit 2026-04-09 16:40`, captured health and company inventory, audited direct-hire and approval-gated hire flows, delegated a runnable issue to the approved hire, correlated the same company/agent/approval/issue IDs through browser and API evidence, ran a post-company TUI check with tuistory, and wrote the evidence notes, repository markdown bug report, and mission handoff note.",
  "whatWasLeftUndone": "TUI company-switch coverage remained blocked after the launcher resolved a stale company context incorrectly; the blocker and downstream blocked assertions were recorded in the report matrix.",
  "verification": {
    "commandsRun": [
      {
        "command": "curl -sf http://localhost:3100/api/health",
        "exitCode": 0,
        "observation": "Health returned status ok before the audit began"
      },
      {
        "command": "pnpm -r --workspace-concurrency=1 typecheck",
        "exitCode": 0,
        "observation": "Workspace typecheck passed after writing the audit artifacts"
      },
      {
        "command": "pnpm test:run -- --maxWorkers=1",
        "exitCode": 0,
        "observation": "Vitest suite passed after writing the audit artifacts"
      }
    ],
    "interactiveChecks": [
      {
        "action": "Completed the browser lifecycle audit for the QA company",
        "observed": "Direct hire succeeded without an approval, the approval-gated hire stayed pending until approval, and the delegated issue appeared with matching identifiers in browser and API evidence"
      },
      {
        "action": "Opened the orchestrator TUI with tuistory after the QA company existed",
        "observed": "TUI launched, but company-switch polling exposed a stale-context defect that was captured as a bug and blocked one follow-on assertion"
      }
    ]
  },
  "tests": {
    "added": []
  },
  "discoveredIssues": [
    {
      "severity": "medium",
      "description": "Dashboard routing reused a stale company context and produced a company-specific 404 during bootstrap; report documents repro and evidence.",
      "suggestedFix": "Trace company-selection persistence around dashboard entry and stale stored company IDs."
    }
  ]
}
```

## When to Return to Orchestrator

- The local dev app cannot be started or kept healthy on port `3100`
- A blocker would require a product fix outside the mission’s QA-only scope
- PTY-backed TUI validation is unavailable when the feature requires TUI evidence
- Cross-surface identifiers cannot be reconciled from the available browser/API/TUI evidence
- Existing local state would need to be destroyed or reset to continue
