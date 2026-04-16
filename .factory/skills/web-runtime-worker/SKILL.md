---
name: web-runtime-worker
description: Implements onboarding web behavior fixes, route recovery, and browser-verified UX correctness
---

# Web Runtime Worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the WORK PROCEDURE.

## When to Use This Skill

Use for features that change onboarding behavior across the web runtime, including:
- `/`, `/onboarding`, and company-prefixed route recovery
- onboarding wizard state, progression, and exactly-once mutation behavior
- bootstrap/auth gating on web entry routes
- add-agent onboarding behavior for existing companies
- invite/join landing and approval UI surfaces
- import entry, preview, apply, and company-context recovery

## Required Skills

- `agent-browser` — required for every feature that fulfills onboarding assertions, because the contract is browser-first and screenshot-backed.

## Work Procedure

1. Read the assigned feature, its `fulfills` assertions, `mission.md`, mission `AGENTS.md`, and `.factory/library/architecture.md`.
2. Read the exact code paths before editing. Typical files include:
   - `ui/src/App.tsx`
   - `ui/src/components/OnboardingWizard.tsx`
   - `ui/src/lib/onboarding-route.ts`
   - `ui/src/context/DialogContext.tsx`
   - `ui/src/pages/InviteLanding.tsx`
   - `ui/src/pages/CompanyImport.tsx`
   - `ui/src/pages/CompanySettings.tsx`
   - `ui/src/pages/Inbox.tsx`
   - matching `ui/src/api/*`, `server/src/routes/*`, and `packages/shared/*` files when the UI depends on backend contracts
3. Write tests first. Prefer the narrowest existing UI or route-level test file that can prove the behavior. For mutation-boundary bugs, add tests that prove both success and non-mutation failure paths.
4. Implement the smallest fix that makes the assigned assertions pass. Preserve company scoping and keep agent-first ordering unless the feature explicitly authorizes a change.
5. Verify with `agent-browser` against the local onboarding surface. Use one browser session, collect annotated screenshots, and cover the exact route/step/error states claimed by the feature.
6. When the assertion depends on mutation or non-mutation, collect API evidence with `curl` or browser network captures before and after the action.
7. Keep runtime usage low:
   - never keep more than one app instance for this feature
   - do not exceed 3 mission-started Node processes
   - only stop PIDs you started yourself
8. Run automated verification in this order:
   - focused tests for changed files
   - `pnpm -r --workspace-concurrency=1 typecheck`
   - onboarding-scoped `commands.test` from `.factory/services.yaml`
   - `pnpm -r --workspace-concurrency=1 build` when the feature changes shipped runtime behavior or shared UI/runtime contracts
9. In the handoff, list every URL visited, every screenshot/evidence path, whether the feature changed the mutation boundary, and exactly which before/after API probes proved the assertions.

## Example Handoff

```json
{
  "salientSummary": "Normalized first-run route recovery so `/`, `/dashboard`, and `/issues` now resolve to one onboarding shell, and fixed close/reopen on `/onboarding` so the route stays canonical without duplicate page+modal rendering.",
  "whatWasImplemented": "Updated route recovery in ui/src/App.tsx and onboarding route helpers so companyless deep links consistently resolve to `/onboarding`, unknown company prefixes fail safely, and in-app onboarding reopen preserves the underlying board route. Added focused tests for route recovery, invalid prefixed onboarding, and close/reopen behavior.",
  "whatWasLeftUndone": "",
  "verification": {
    "commandsRun": [
      {
        "command": "pnpm exec vitest run ui/src/lib/onboarding-route.test.ts ui/src/components/OnboardingWizard.test.tsx --maxWorkers=1",
        "exitCode": 0,
        "observation": "Focused onboarding route and wizard tests passed"
      },
      {
        "command": "pnpm -r --workspace-concurrency=1 typecheck",
        "exitCode": 0,
        "observation": "Workspace typecheck passed"
      },
      {
        "command": "pnpm exec vitest run ui/src/components/OnboardingWizard.test.tsx ui/src/lib/onboarding-route.test.ts ui/src/lib/onboarding-launch.test.ts ui/src/lib/onboarding-goal.test.ts server/src/__tests__/invite-onboarding-text.test.ts server/src/__tests__/openclaw-invite-prompt-route.test.ts server/src/__tests__/invite-accept-gateway-defaults.test.ts server/src/__tests__/invite-accept-replay.test.ts server/src/__tests__/invite-expiry.test.ts server/src/__tests__/invite-join-grants.test.ts server/src/__tests__/invite-join-manager.test.ts server/src/__tests__/company-portability-routes.test.ts cli/src/__tests__/onboard.test.ts --maxWorkers=1",
        "exitCode": 0,
        "observation": "Mission-scoped onboarding baseline passed"
      }
    ],
    "interactiveChecks": [
      {
        "action": "Visited `/dashboard` with zero companies and let recovery complete",
        "observed": "Recovered into a single `/onboarding` shell with one primary onboarding action"
      },
      {
        "action": "Opened onboarding from a board CTA, closed it, then reopened it",
        "observed": "The underlying board URL was preserved, close returned to the same page, and reopening produced one onboarding shell"
      }
    ]
  },
  "tests": {
    "added": [
      {
        "file": "ui/src/lib/onboarding-route.test.ts",
        "cases": [
          {
            "name": "companyless dashboard recovers to onboarding",
            "verifies": "VAL-ENTRY-003"
          },
          {
            "name": "invalid prefixed onboarding fails safely",
            "verifies": "VAL-ENTRY-006"
          }
        ]
      }
    ]
  },
  "discoveredIssues": []
}
```

## When to Return to Orchestrator

- The feature needs a backend/shared contract change large enough that the assigned scope is no longer a web-runtime-only fix
- The onboarding flow depends on missing data or routes that do not yet exist
- The app cannot be started or reused within the mission’s Node/process limits
- The actual product expectation conflicts with the assigned assertions or agent-first requirement
