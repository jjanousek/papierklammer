---
name: gui-worker
description: Implements GUI redesign applying the papierklammer design system to React/Tailwind components
---

# GUI Worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the WORK PROCEDURE.

## When to Use This Skill

Features involving the web GUI at `ui/src/`:
- Design system application (replacing hardcoded colors, removing shadows)
- Theme system implementation (CSS variables, ThemeContext, selector UI)
- Dashboard fixes (navigation, stream content, dead button removal)
- Component restyling for design system compliance

## Required Skills

- `agent-browser` — for visual verification of GUI changes. Invoke when the feature involves visual changes that need verification.

## Work Procedure

1. **Read the feature description carefully.** Understand what assertions this feature fulfills. Read the validation contract for those assertion IDs.

2. **Read existing code.** Before modifying any file, read it first. Key files:
   - `ui/src/index.css` — CSS custom properties, theme variables, global resets
   - `ui/src/pages/*.tsx` — page components
   - `ui/src/components/*.tsx` — shared components
   - `ui/src/context/ThemeContext.tsx` — theme state management
   - `papierklammer-design-system.md` — design system specification
   - `papierklammer-theme-violet-indigo.md` — violet-indigo theme spec
   - `papierklammer-theme-earth.md` — earth theme spec

3. **Write tests FIRST (TDD)** for any new components or significant logic changes. Tests go in the appropriate `__tests__/` directory.

4. **Implement changes.** Follow these rules strictly:
   - **Colors**: ONLY use CSS custom properties (`var(--bg)`, `var(--fg)`, `var(--alive)`, `var(--warn)`, `var(--dead)`, etc.)
   - **NEVER** use hardcoded Tailwind color classes: `amber-*`, `emerald-*`, `green-*`, `red-*`, `cyan-*`, `blue-*`, `yellow-*`
   - **Replace** any existing hardcoded colors with design system equivalents:
     - Green/emerald → `var(--alive)` or `bg-[var(--alive)]`
     - Yellow/amber → `var(--warn)` or `bg-[var(--warn)]`
     - Red → `var(--dead)` or `bg-[var(--dead)]`
     - Gray/muted → `var(--fg-muted)` or `var(--fg-dim)`
   - **NEVER** use `shadow-*` classes
   - **NEVER** use non-monospace fonts
   - For opacity variants: use CSS opacity on the variable, e.g., `bg-[var(--warn)]/20`

5. **Verify with agent-browser** (for visual features):
   - Start dev server if not running: `PORT=3100 pnpm dev:once &`
   - Wait for health: `curl -sf http://localhost:3100/api/health`
   - Navigate to relevant pages and take screenshots
   - Verify colors, layout, navigation, interactions
   - Each verified flow = one `interactiveChecks` entry

6. **Run automated verification:**
   - `pnpm exec vitest run ui/src/ --max-workers=3` — all UI tests pass
   - `pnpm exec vitest run packages/orchestrator-tui/ --max-workers=3` — TUI tests still pass
   - `pnpm -r typecheck` — no type errors

7. **Commit** with a descriptive message.

## Example Handoff

```json
{
  "salientSummary": "Applied design system to Routines and RoutineDetail pages. Replaced 12 hardcoded Tailwind color classes (amber, emerald, blue) with CSS variable equivalents. Removed 2 shadow classes. Verified both pages render correctly with all 3 themes via agent-browser.",
  "whatWasImplemented": "Routines.tsx: replaced bg-amber-100 with bg-[var(--warn)]/10, bg-amber-900/30 with bg-[var(--warn)]/30, text-amber-800 with text-[var(--warn)], removed shadow-sm from toggle. RoutineDetail.tsx: replaced bg-emerald-500 with bg-[var(--alive)], text-emerald-400 with text-[var(--alive)], bg-blue-500/5 with bg-[var(--border)], removed shadow-sm from toggle.",
  "whatWasLeftUndone": "",
  "verification": {
    "commandsRun": [
      {
        "command": "pnpm exec vitest run ui/src/ --max-workers=3",
        "exitCode": 0,
        "observation": "30 test files, 132 tests all passing"
      },
      {
        "command": "pnpm -r typecheck",
        "exitCode": 0,
        "observation": "All packages typecheck successfully"
      }
    ],
    "interactiveChecks": [
      {
        "action": "Navigated to /routines with papierklammer theme",
        "observed": "Rose background, --warn colored status badges, no shadows, monospace throughout"
      },
      {
        "action": "Switched to earth theme, reloaded /routines",
        "observed": "Brown background, earthy gold warnings, bone ivory text — all design system compliant"
      }
    ]
  },
  "tests": {
    "added": [],
    "updated": [],
    "coverage": "No new tests needed — existing tests cover component rendering, color changes are CSS-only"
  },
  "discoveredIssues": []
}
```

## When to Return to Orchestrator

- A component uses a color that has no design system equivalent
- Theme switching causes layout issues or component breakage
- A shadcn primitive needs restyling that would affect many components
- Existing tests fail due to design system changes and the fix is non-obvious
