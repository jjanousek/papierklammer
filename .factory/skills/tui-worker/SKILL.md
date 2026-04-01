---
name: tui-worker
description: Implements TUI components, hooks, and Codex integration for the orchestrator console
---

# TUI Worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the WORK PROCEDURE.

## When to Use This Skill

Features that involve:
- Ink/React TUI components (layout, panels, input, display)
- Codex app-server subprocess integration (protocol, streaming)
- Keyboard interaction handling
- TUI-specific hooks and state management

## Required Skills

None

## Work Procedure

1. **Read the feature description and AGENTS.md** for Ink patterns and Codex protocol details.

2. **Read existing TUI code** if any exists:
   - `packages/orchestrator-tui/src/` for components and hooks
   - `packages/orchestrator-tui/src/__tests__/` for test patterns
   - `packages/orchestrator-console/src/client.ts` for the API client to reuse

3. **Write tests first** (red):
   - Create test files in `packages/orchestrator-tui/src/__tests__/`
   - Use ink-testing-library's `render()` for component tests:
     ```typescript
     import { render } from 'ink-testing-library';
     const { lastFrame, stdin } = render(<MyComponent />);
     expect(lastFrame()).toContain('Expected text');
     stdin.write('x'); // simulate input
     ```
   - Mock `child_process.spawn` for Codex integration tests
   - Mock `fetch` or the OrchestratorClient for API tests
   - Run tests — they should FAIL.

4. **Implement the feature**:
   - Components in `src/components/` — one file per component
   - Hooks in `src/hooks/` — reusable logic (useCodex, useOrchestratorStatus, etc.)
   - Codex client in `src/codex/` — JSON-RPC protocol handling
   - Follow Ink patterns from AGENTS.md (Box/Text, flexbox, useInput, useFocus)

5. **For package setup** (if first feature):
   - Create `packages/orchestrator-tui/package.json` with ink, react, @types/react deps
   - Create `tsconfig.json` extending `../../tsconfig.base.json` with `jsx: "react-jsx"`
   - Create `vitest.config.ts`
   - Add entry point `src/index.tsx`
   - **Important**: Ink 6 requires `"type": "module"` in package.json and ESM imports

6. **Run tests** (green):
   - `cd packages/orchestrator-tui && npx vitest run`
   - `pnpm -r typecheck`
   - `pnpm test:run --max-workers=1`
   - `pnpm build`

## Example Handoff

```json
{
  "salientSummary": "Implemented full-screen layout with 5 panels (header, sidebar, chat, input, status) using Ink 6 Box/Text components. Layout responds to terminal size via useWindowSize. 8 tests pass with ink-testing-library verifying panel presence and layout structure.",
  "whatWasImplemented": "New package packages/orchestrator-tui/ with: package.json (ink 6, react 19), tsconfig.json, vitest.config.ts, src/index.tsx entry point, src/components/App.tsx (main layout), src/components/Header.tsx, src/components/Sidebar.tsx, src/components/ChatPanel.tsx, src/components/InputBar.tsx, src/components/StatusBar.tsx. Full-screen via alternate screen buffer.",
  "whatWasLeftUndone": "",
  "verification": {
    "commandsRun": [
      { "command": "cd packages/orchestrator-tui && npx vitest run", "exitCode": 0, "observation": "8 tests passed" },
      { "command": "pnpm -r typecheck", "exitCode": 0, "observation": "No errors" },
      { "command": "pnpm test:run --max-workers=1", "exitCode": 0, "observation": "All tests pass" }
    ],
    "interactiveChecks": []
  },
  "tests": {
    "added": [
      { "file": "packages/orchestrator-tui/src/__tests__/layout.test.tsx", "cases": [
        { "name": "renders header bar", "verifies": "Header panel present in layout" },
        { "name": "renders agent sidebar", "verifies": "Sidebar panel present" },
        { "name": "renders chat panel", "verifies": "Main chat area present" },
        { "name": "renders input bar", "verifies": "Input area present" },
        { "name": "renders status bar", "verifies": "Status bar present" }
      ]}
    ]
  },
  "discoveredIssues": []
}
```

## When to Return to Orchestrator

- Ink version incompatibility with React 19
- ink-testing-library not compatible with Ink 6
- Codex app-server not available or protocol has changed
- Package setup conflicts with monorepo workspace config
