---
name: backend-worker
description: Implements onboarding backend and shared-contract fixes with browser-backed verification
---

# Backend Worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the WORK PROCEDURE.

## When to Use This Skill

Use for onboarding features that primarily change server routes, services, data contracts, or shared validators/types, including:
- invite generation, approval, and claim semantics
- onboarding drafting or launch APIs when exactly-once semantics are broken
- import preview/apply fidelity and supporting server behavior
- approval-gated hiring behavior exposed through onboarding

## Required Skills

- `agent-browser` — required when the feature fulfills browser-visible onboarding assertions or needs UI confirmation of backend behavior.

## Work Procedure

1. Read the assigned feature, its assertions, mission `AGENTS.md`, and `.factory/library/architecture.md`.
2. Read the relevant files before editing:
   - `server/src/routes/*`
   - `server/src/services/*`
   - `packages/shared/src/*`
   - `packages/db/src/schema/*` if schema changes are required
   - the UI/API files that consume the contract you are changing
3. Write failing tests first. Prefer focused server tests in `server/src/__tests__/` and shared-validator tests where appropriate. For DB-backed behavior, use the existing embedded Postgres helpers.
4. Implement the minimal backend/shared fix while preserving company scoping, approval semantics, and route contract consistency across server, shared, and UI layers.
5. If schema changes are required, update schema exports and generate the necessary migration.
6. Verify behavior in two layers:
   - focused backend/shared tests
   - browser/API proof for the user-visible onboarding contract (`agent-browser` for the UI state, `curl` or browser requests for API-only paths like claim)
7. Keep runtime usage low: no extra app instances, no more than 3 mission-started Node processes, and only stop PIDs you started.
8. Run automated verification:
   - focused backend/shared tests
   - `pnpm -r --workspace-concurrency=1 typecheck`
   - `pnpm test:run -- --maxWorkers=1`
   - `pnpm -r --workspace-concurrency=1 build` when shared runtime contracts or shipped server behavior changed
9. In the handoff, list every changed contract surface, the exact API routes verified, and the browser/API evidence that proves approval, claim, or import semantics now match the assigned assertions.

## Example Handoff

```json
{
  "salientSummary": "Fixed invite approval and claim gating so Inbox approval now cleanly enables exactly one successful agent claim, while pre-approval and replayed claim attempts fail with the intended errors.",
  "whatWasImplemented": "Updated invite/join route handling and shared validators so operator-generated invites preserve the intended join mode, Inbox approval resolves join-request state consistently, and claim endpoints enforce approval, wrong-secret, expired, and replayed behaviors without leaking credentials. Added focused server tests for approval and claim paths.",
  "whatWasLeftUndone": "",
  "verification": {
    "commandsRun": [
      {
        "command": "pnpm exec vitest run server/src/__tests__/invite-join-manager.test.ts server/src/__tests__/invite-accept-replay.test.ts --maxWorkers=1",
        "exitCode": 0,
        "observation": "Focused invite/join tests passed"
      },
      {
        "command": "pnpm -r --workspace-concurrency=1 typecheck",
        "exitCode": 0,
        "observation": "Workspace typecheck passed"
      },
      {
        "command": "pnpm test:run -- --maxWorkers=1",
        "exitCode": 0,
        "observation": "Full Vitest suite passed with low concurrency"
      }
    ],
    "interactiveChecks": [
      {
        "action": "Submitted an invite join request and approved it from Inbox",
        "observed": "The operator saw the request resolve cleanly and the joiner-facing state changed from pending to approved"
      },
      {
        "action": "Called the claim API before approval and after approval",
        "observed": "Pre-approval claim failed, approved claim succeeded once, and replayed claim failed cleanly"
      }
    ]
  },
  "tests": {
    "added": [
      {
        "file": "server/src/__tests__/invite-claim-gating.test.ts",
        "cases": [
          {
            "name": "pre-approval claim is rejected",
            "verifies": "VAL-INVITE-010"
          },
          {
            "name": "approved claim succeeds once",
            "verifies": "VAL-INVITE-010"
          }
        ]
      }
    ]
  },
  "discoveredIssues": []
}
```

## When to Return to Orchestrator

- The assigned feature actually requires a broad UI redesign or route-state change beyond backend/shared scope
- Existing backend behavior conflicts with the assigned assertions in a way that needs a product decision
- Embedded Postgres or the local app cannot be started within the mission’s runtime budget
- A migration or shared-contract change would invalidate multiple earlier milestones and should be replanned
