---
name: web-runtime-worker
description: Implements Web UI behavior fixes for onboarding, company scoping, issue detail, and run/result visibility
---

# Web Runtime Worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the WORK PROCEDURE.

## When to Use This Skill

Features involving `ui/src/` behavior such as:
- Onboarding flow correctness and adapter gating
- Company-context synchronization in routes and detail pages
- Issue, run, and result visibility in the board UI
- Web UI stale-recovery and post-recovery visibility

## Required Skills

- `agent-browser` — required for verifying the actual board UI flows this mission cares about

## Work Procedure

1. Read the feature description and the validation assertions it fulfills.
2. Read the relevant existing code before editing:
   - onboarding: `ui/src/components/OnboardingWizard.tsx`
   - issue/run review: `ui/src/pages/IssueDetail.tsx`, `ui/src/components/LiveRunWidget.tsx`
   - company context: `ui/src/context/CompanyContext.tsx`, detail pages, router helpers
3. Write tests first. Prefer the narrowest existing UI or route-level test file that can prove the behavior. Add focused component or page tests when possible.
4. Implement the fix using existing query/state patterns. Preserve company-scoped routing and avoid introducing hidden global state.
5. Verify with `agent-browser` against the isolated audit instance from `.factory/services.yaml`. Collect screenshots or network evidence for the exact assertions this feature fulfills.
6. Keep Node-process usage low during verification. Reuse one local app instance when possible and stop any temporary server or helper process once the browser checks that need it are complete.
7. Run automated verification:
   - focused UI tests first
   - `pnpm -r typecheck`
   - `pnpm test:run -- --maxWorkers=5`
   - `pnpm build` if the feature affects shipped runtime paths
8. In the handoff, list the URLs visited, company slug/id used, any local processes started for verification, and the exact evidence that proved the web behavior changed.

## Example Handoff

```json
{
  "salientSummary": "Fixed onboarding so failed codex_local validation blocks progression, and issue detail now synchronizes company context from deep links before related queries fire. Verified both flows in the browser against a fresh isolated instance.",
  "whatWasImplemented": "Updated ui/src/components/OnboardingWizard.tsx to gate agent creation on a passing adapter environment result and updated issue-detail route handling so secondary company-scoped queries use the deep-linked company context before attachments, agents, or related issue queries run. Added targeted UI tests for the failed validation path and company-context synchronization behavior.",
  "whatWasLeftUndone": "",
  "verification": {
    "commandsRun": [
      {
        "command": "pnpm exec vitest run ui/src/components/__tests__/OnboardingWizard.test.tsx ui/src/pages/__tests__/IssueDetail.test.tsx --maxWorkers=5",
        "exitCode": 0,
        "observation": "Focused onboarding and issue-detail tests passed"
      },
      {
        "command": "pnpm -r typecheck",
        "exitCode": 0,
        "observation": "No type errors"
      },
      {
        "command": "pnpm test:run -- --maxWorkers=5",
        "exitCode": 0,
        "observation": "Full Vitest suite passed"
      }
    ],
    "interactiveChecks": [
      {
        "action": "Ran onboarding with an invalid codex_local environment result",
        "observed": "UI stayed on the adapter step and no CEO agent was created"
      },
      {
        "action": "Opened a company-B issue deep link while company A had been selected previously",
        "observed": "Issue detail synchronized to company B and follow-up requests used company B"
      }
    ]
  },
  "tests": {
    "added": [
      {
        "file": "ui/src/components/__tests__/OnboardingWizard.test.tsx",
        "cases": [
          {
            "name": "failed codex_local validation blocks next step",
            "verifies": "VAL-DEMO-005"
          }
        ]
      }
    ]
  },
  "discoveredIssues": []
}
```

## When to Return to Orchestrator

- The required behavior depends on missing API fields or route support
- The browser flow cannot be exercised because the isolated instance is not bootable
- The feature requires broader shared-state changes than one worker session can safely make
