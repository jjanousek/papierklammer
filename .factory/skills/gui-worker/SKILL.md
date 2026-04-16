---
name: gui-worker
description: Implements onboarding UX/UI redesigns with browser-verified visual clarity
---

# GUI Worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the WORK PROCEDURE.

## When to Use This Skill

Use for features that redesign or polish onboarding visuals and information architecture, including:
- first-run entry shells and CTA hierarchy
- wizard copy, visual hierarchy, and disabled-state legibility
- company-prefixed add-agent context cues
- invite/import page clarity and operator/joiner comprehension

## Required Skills

- `agent-browser` — required for all visual verification in this mission.

## Work Procedure

1. Read the assigned feature, its `fulfills` assertions, mission `AGENTS.md`, and `.factory/library/architecture.md`.
2. Read the relevant UI files before editing. Typical targets include:
   - `ui/src/components/OnboardingWizard.tsx`
   - `ui/src/App.tsx`
   - `ui/src/pages/InviteLanding.tsx`
   - `ui/src/pages/CompanyImport.tsx`
   - supporting shared components used by those screens
3. If the feature changes any interactive behavior, write tests first. For copy/layout-only changes, update tests when existing assertions would become stale.
4. Implement the redesign using existing React/Tailwind patterns and UI primitives already present in the repo. Do not introduce a new design system for this mission.
5. Preserve product intent:
   - keep Agent first unless the feature explicitly says otherwise
   - make scope differences visible (`new company` vs `add agent` vs `import`)
   - avoid new modal/route duplication
6. Verify visually with `agent-browser`:
   - capture annotated screenshots of the initial state and the final state
   - verify CTA hierarchy, helper copy, disabled controls, and visible company context
   - if a screen has multiple meaningful states, capture each one
7. Keep runtime usage low: one browser session, one app instance, no more than 3 mission-started Node processes, and only stop PIDs you started.
8. Run automated verification:
   - focused UI tests for changed components/pages
   - `pnpm -r --workspace-concurrency=1 typecheck`
   - `pnpm test:run -- --maxWorkers=1`
   - `pnpm -r --workspace-concurrency=1 build` when the redesign changes shipped runtime surfaces broadly
9. In the handoff, call out the visual problem you fixed, the screenshots that prove the change, and any copy or hierarchy decisions that preserve agent-first onboarding.

## Example Handoff

```json
{
  "salientSummary": "Redesigned the first-run onboarding shell so `/onboarding` now reads as one primary workflow with a single dominant CTA, explicit Agent-first helper copy, and non-competing background content.",
  "whatWasImplemented": "Updated the first-run onboarding entry and wizard chrome to remove competing page-plus-modal emphasis, clarified why Agent comes first, tightened disabled-step copy, and improved add-agent company-context cues on prefixed onboarding routes. Adjusted focused UI tests to match the new copy and shell structure.",
  "whatWasLeftUndone": "",
  "verification": {
    "commandsRun": [
      {
        "command": "pnpm exec vitest run ui/src/components/OnboardingWizard.test.tsx --maxWorkers=1",
        "exitCode": 0,
        "observation": "Focused onboarding UI tests passed"
      },
      {
        "command": "pnpm -r --workspace-concurrency=1 typecheck",
        "exitCode": 0,
        "observation": "Workspace typecheck passed"
      }
    ],
    "interactiveChecks": [
      {
        "action": "Opened `/onboarding` on a fresh instance",
        "observed": "Exactly one onboarding shell was visible, with one dominant primary action and explicit Agent-first copy"
      },
      {
        "action": "Opened `/:companyPrefix/onboarding` for an existing company",
        "observed": "The shell consistently read as add-agent onboarding and kept visible company context"
      }
    ]
  },
  "tests": {
    "added": []
  },
  "discoveredIssues": []
}
```

## When to Return to Orchestrator

- The redesign requires a broader product decision than the assigned feature allows
- Existing UI primitives cannot support the required visual change without broader refactoring
- The change depends on backend/runtime behavior that is not yet implemented
- Visual verification cannot be completed within the mission’s runtime constraints
