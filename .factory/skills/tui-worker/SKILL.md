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

- `tuistory` — required when the feature affects shipped TUI runtime behavior, company selection, failure recovery, or output/result inspection. Use it for PTY-backed validation.

## Work Procedure

1. **Read the feature description carefully.** Understand what assertions this feature fulfills (check `fulfills` field). Read the validation contract for those assertion IDs to understand exact pass/fail criteria.

2. **Read existing code.** Before modifying any file, read it first to understand current patterns. Key files:
   - `packages/orchestrator-tui/src/components/App.tsx` — root component
   - `packages/orchestrator-tui/src/hooks/useCodex.ts` — Codex integration
   - `packages/orchestrator-tui/src/hooks/useChat.ts` — chat state
   - `packages/orchestrator-tui/src/codex/client.ts` — Codex JSON-RPC client
   - `packages/orchestrator-tui/src/codex/types.ts` — protocol types

3. **Write tests FIRST (TDD).** Create or update test files in `packages/orchestrator-tui/src/__tests__/`. Tests should:
   - Import from `ink-testing-library` for component testing
   - Mock Codex client for async behavior tests
   - Cover the specific scenarios from the validation contract assertions
   - Run with: `pnpm exec vitest run packages/orchestrator-tui/ --max-workers=3`

4. **Implement the feature.** Make tests pass. Follow existing patterns:
   - Use React hooks for state management
   - Use `useStdout()` from Ink for terminal dimensions
   - Use refs for values accessed in async callbacks (avoid stale closures)
   - Use `ink-spinner` for animations (already installed)

5. **Run verification:**
   - `pnpm exec vitest run packages/orchestrator-tui/ --max-workers=3` — all TUI tests pass
   - `pnpm exec vitest run ui/src/ --max-workers=3` — UI tests still pass (no regressions)
   - `pnpm -r typecheck` — no type errors
   - If the feature affects shipped runtime behavior, also validate the actual TUI with `tuistory` against the isolated instance and capture terminal evidence.
   - Keep process count low: do not leave extra `pnpm dev:tui`, `codex app-server`, or helper Node processes running after PTY validation completes.

6. **Commit** with a descriptive message.

## Example Handoff

```json
{
  "salientSummary": "Fixed TUI layout stability by using useStdout() for explicit terminal dimensions. HeaderBar/InputBar/StatusBar have flexShrink={0}. Middle content area uses calculated height. Added resize listener that recalculates dimensions. 6 new tests covering layout, resize, and multi-message flows.",
  "whatWasImplemented": "Added useTerminalSize hook wrapping useStdout() with resize detection. App.tsx now sets explicit height on root Box based on terminal rows. Fixed bars have flexShrink={0} and fixed heights (1 row each). Middle content area height = rows - 3. MessageList implements scroll windowing. Added resize useEffect that resets scroll offset.",
  "whatWasLeftUndone": "",
  "verification": {
    "commandsRun": [
      {
        "command": "pnpm exec vitest run packages/orchestrator-tui/ --max-workers=3",
        "exitCode": 0,
        "observation": "9 test files, 143 tests all passing including 6 new layout tests"
      },
      {
        "command": "pnpm exec vitest run ui/src/ --max-workers=3",
        "exitCode": 0,
        "observation": "30 test files, 132 tests all passing, no regressions"
      },
      {
        "command": "pnpm -r typecheck",
        "exitCode": 0,
        "observation": "All packages typecheck successfully"
      }
    ]
  },
  "tests": {
    "added": [
      {
        "file": "packages/orchestrator-tui/src/__tests__/layout.test.tsx",
        "cases": [
          { "name": "root Box uses explicit height from terminal rows", "verifies": "VAL-TUI-STAB-001" },
          { "name": "layout stable after sending message", "verifies": "VAL-TUI-STAB-002" },
          { "name": "layout recalculates on terminal resize", "verifies": "VAL-TUI-STAB-003" }
        ]
      }
    ]
  },
  "discoveredIssues": []
}
```

## When to Return to Orchestrator

- Ink's `useStdout()` doesn't work as expected for resize detection
- CodexClient protocol changes needed that aren't documented
- Test infrastructure issues (ink-testing-library limitations)
- PTY-backed validation is unavailable for a feature that fulfills runtime TUI assertions
