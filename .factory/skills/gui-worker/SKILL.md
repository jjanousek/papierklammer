---
name: gui-worker
description: Implements GUI redesign applying the papierklammer design system to React/Tailwind components
---

# GUI Worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the WORK PROCEDURE.

## When to Use This Skill

Features that involve modifying files in `ui/src/` to apply the papierklammer design system — CSS variables, component restyling, layout restructuring, new components.

## Required Skills

- `agent-browser` — MUST be invoked for visual verification of GUI changes. After making changes, start the dev server and use agent-browser to screenshot the affected pages.

## Work Procedure

1. **Read the feature description and the design system spec.** The design system is at `/Users/aischool/work/papierklammer_droid/papierklammer-design-system.md`. Read it fully before starting work. Understand the exact CSS values, color codes, typography scale, and component specifications.

2. **Read existing code first.** Read the current state of all files you'll modify. Check existing Tailwind classes, CSS variables, component structure, and data flow.

3. **Write tests first where applicable (red).** For component logic changes (e.g., tier-column grouping, agent sorting), write Vitest tests first. For purely visual CSS changes, tests may not be applicable — visual verification via agent-browser replaces unit tests.

4. **Implement the design changes.** Follow these rules strictly:
   - **CSS variables**: Define all design system variables in `ui/src/index.css` under `:root`
   - **Font**: Add JetBrains Mono via Google Fonts in `ui/index.html` `<head>` and set `* { font-family: 'JetBrains Mono', monospace; }` in index.css
   - **No border-radius**: Add `* { border-radius: 0 !important; }` to index.css. Also remove all `rounded-*` Tailwind classes from components
   - **Colors**: Replace all color classes with design system equivalents. Use CSS custom properties.
   - **Status indicators**: Replace all `rounded-full` status dots with `w-1.5 h-1.5` squares
   - **Typography**: Apply monospace font, correct sizes (see design system type scale), uppercase+letter-spacing for labels
   - **Borders**: Use `border border-[--border]` for dividers. No shadows (`shadow-none` or remove shadow classes)
   - **Buttons**: `bg-transparent border border-white text-white font-mono text-[11px] uppercase tracking-wider`
   - **Inputs**: `bg-transparent border border-[--border-strong] text-white font-mono text-[11px]`

5. **Visual verification with agent-browser:**
   - Start the dev server: `cd /Users/aischool/work/papierklammer_droid && pnpm dev` (background)
   - Wait for it to be ready (curl localhost:3100/api/health)
   - Invoke the `agent-browser` skill
   - Navigate to affected pages and take screenshots
   - Verify: correct font, correct colors, zero border-radius, correct layout structure
   - Stop the dev server when done

6. **Run verification:**
   ```sh
   pnpm -r typecheck  # Must pass
   pnpm build         # Must pass
   ```

7. **Commit and hand off.**

## Example Handoff

```json
{
  "salientSummary": "Applied design system foundation: JetBrains Mono font, pink/rose color palette, global border-radius removal, CSS custom properties. Redesigned Button, Input, Badge, Tabs primitives. Verified via agent-browser screenshots showing correct font, colors, and sharp corners on Dashboard and Agents pages.",
  "whatWasImplemented": "Updated ui/index.html with Google Fonts JetBrains Mono import. Rewrote ui/src/index.css CSS custom properties with rose palette values. Added global border-radius: 0 reset. Restyled ui/src/components/ui/button.tsx (transparent bg, 1px white border, uppercase 11px). Restyled input.tsx, badge.tsx, tabs.tsx. Updated StatusIcon to render 6x6 squares instead of circles. Removed 47 instances of rounded-* classes across 12 component files.",
  "whatWasImplemented": "...",
  "whatWasLeftUndone": "",
  "verification": {
    "commandsRun": [
      {"command": "pnpm -r typecheck", "exitCode": 0, "observation": "All packages typecheck"},
      {"command": "pnpm build", "exitCode": 0, "observation": "All packages build"}
    ],
    "interactiveChecks": [
      {"action": "Opened Dashboard in agent-browser", "observed": "Pink/rose background, JetBrains Mono font, all sharp corners, status squares visible"},
      {"action": "Opened Agents page in agent-browser", "observed": "Agent names in monospace, square status indicators, correct filter tab styling"}
    ]
  },
  "tests": {
    "added": [
      {"file": "ui/src/components/StatusIcon.test.tsx", "cases": [
        {"name": "renders 6x6 square indicator for alive status", "verifies": "VAL-GUI-FOUND-004"}
      ]}
    ]
  },
  "discoveredIssues": []
}
```

## When to Return to Orchestrator

- Design system spec is ambiguous for a specific component
- A component requires server-side changes to support the new layout
- An existing test fails due to the redesign and the fix is non-trivial
- Agent-browser cannot start or take screenshots
