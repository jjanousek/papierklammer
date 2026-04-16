---
name: tui-worker
description: Implements TUI components, hooks, and Codex integration for the orchestrator console
---

# TUI Worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the WORK PROCEDURE.

## When to Use This Skill

Features involving the orchestrator TUI at `packages/orchestrator-tui/`:
- Component fixes and new components (React Ink)
- Hook modifications (useCodex, useChat, useOrchestratorStatus)
- Codex client protocol changes
- Terminal layout and resize handling
- Keyboard interaction and overlays

## Required Skills

- `tuistory` — required whenever the feature changes shipped TUI behavior, focus/shortcut routing, company switching, transcript rendering, or failure/recovery behavior.

## Work Procedure

1. **Read the feature description carefully.** Understand what assertions this feature fulfills (check `fulfills` field). Read the validation contract for those assertion IDs to understand exact pass/fail criteria.

2. **Read existing code.** Before modifying any file, read it first to understand current patterns. Key files:
   - `packages/orchestrator-tui/src/components/App.tsx` — root component
   - `packages/orchestrator-tui/src/hooks/useCodex.ts` — Codex integration
   - `packages/orchestrator-tui/src/hooks/useChat.ts` — chat state
   - `packages/orchestrator-tui/src/codex/client.ts` — Codex JSON-RPC client
   - `packages/orchestrator-tui/src/codex/types.ts` — protocol types

3. **Write tests FIRST (TDD).** Create or update test files in `packages/orchestrator-tui/src/__tests__/` before implementation. Tests should:
   - Import from `ink-testing-library` for component testing
   - Mock Codex client for async behavior tests
   - Cover the specific scenarios from the validation contract assertions
   - Start with the narrowest failing test for the feature, then broaden to the full TUI package suite
   - Run with: `pnpm exec vitest run packages/orchestrator-tui/src/__tests__ --maxWorkers=2`

4. **Implement the feature.** Make the new failing tests pass. Follow existing patterns:
   - Use React hooks for state management
    - Treat company scope, focus ownership, and transcript chronology as explicit invariants
   - Use refs for values accessed in async callbacks when stale closures would break live stream handling
   - Keep runtime behavior aligned with what help text and inline hints advertise

5. **Run verification:**
   - `pnpm exec vitest run packages/orchestrator-tui/src/__tests__ --maxWorkers=2` — full TUI package tests pass
   - `pnpm --filter @papierklammer/orchestrator-tui typecheck` — package typecheck passes
   - `pnpm --filter @papierklammer/orchestrator-tui build` — run when the feature changes exported package/runtime code paths
   - If the feature affects shipped runtime behavior, validate the live TUI with `tuistory` against the local trusted app on port `3100`
   - Seed a validation company before live TUI checks when `/api/companies` is empty
   - Keep process count low: do not leave extra `pnpm dev:tui`, `codex app-server`, or helper Node processes running after PTY validation completes

6. **Commit** with a descriptive message.

## Example Handoff

```json
{
  "salientSummary": "Redesigned the TUI focus model so the active region is explicit, chat drafts stay in sync with shortcut gating, and company-switch dismissal no longer resets the live session. Added focused tests for input/sidebar/company-switch flows plus a PTY-backed check of draft-safe switching.",
  "whatWasImplemented": "Updated App.tsx and InputBar.tsx so visible draft text is parent-controlled, focus ownership is explicit, and draft-sensitive shortcuts read the visible composer state. Company-switch open/dismiss now preserves the active session when no company is selected, while confirmed switches clear prior thread/transcript context before the new company loads. Help/discoverability surfaces were aligned with the new routing rules.",
  "whatWasLeftUndone": "",
  "verification": {
    "commandsRun": [
      {
        "command": "pnpm exec vitest run packages/orchestrator-tui/src/__tests__ --maxWorkers=2",
        "exitCode": 0,
        "observation": "All orchestrator TUI package tests passed, including the new focus/company-switch regression cases"
      },
      {
        "command": "pnpm --filter @papierklammer/orchestrator-tui typecheck",
        "exitCode": 0,
        "observation": "The orchestrator TUI package typechecked cleanly"
      },
      {
        "command": "pnpm --filter @papierklammer/orchestrator-tui build",
        "exitCode": 0,
        "observation": "The package build completed successfully"
      },
      {
        "command": "PAPIERKLAMMER_HOME=/tmp/papierklammer-tui-mission PAPIERKLAMMER_INSTANCE_ID=tui-mission PORT=3100 pnpm dev:once",
        "exitCode": 0,
        "observation": "Local trusted app launched on 127.0.0.1:3100 for PTY validation"
      }
    ],
    "interactiveChecks": [
      {
        "action": "Used tuistory to launch the TUI, typed a draft, opened and dismissed company switching, then confirmed the same draft and focus target were preserved",
        "observed": "Visible draft text remained intact, no stale session reset occurred, and the switcher only changed context on explicit selection"
      }
    ]
  },
  "tests": {
    "added": [
      {
        "file": "packages/orchestrator-tui/src/__tests__/management-shortcuts.test.tsx",
        "cases": [
          { "name": "company-switch dismiss preserves the live session", "verifies": "VAL-FOCUS-007" },
          { "name": "visible draft remains the source of truth for shortcut gating", "verifies": "VAL-FOCUS-008" },
          { "name": "non-input management shortcuts only fire for the active region", "verifies": "VAL-SHORTCUT-002" }
        ]
      }
    ]
  },
  "discoveredIssues": []
}
```

## When to Return to Orchestrator

- The feature depends on server/runtime fixture behavior outside the agreed TUI mission scope
- A required assertion cannot be validated because seeded-company setup is unavailable
- Codex event semantics need a contract decision (for example, reasoning/tool chronology cannot be inferred safely)
- PTY-backed validation is unavailable for a feature that changes shipped TUI runtime behavior
