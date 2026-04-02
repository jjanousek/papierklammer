---
name: tui-worker
description: Implements TUI components, hooks, and Codex integration for the orchestrator console
---

# TUI Worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the WORK PROCEDURE.

## When to Use This Skill

Features that involve creating or modifying files in `packages/orchestrator-tui/` — components, hooks, Codex client, CLI, tests.

## Required Skills

None.

## Work Procedure

1. **Read the feature description carefully.** Understand what components, hooks, and tests need to be created/modified.

2. **Read existing code first.** Before writing anything, read the current state of files you'll modify. Check `packages/orchestrator-tui/src/` for existing patterns, imports, and conventions.

3. **Write tests first (red).** Create test files in `packages/orchestrator-tui/src/__tests__/` using Vitest + ink-testing-library. For components, use `render()` from ink-testing-library and assert on `lastFrame()`. For hooks, create test harness components. For the Codex client, mock `child_process.spawn`. For API calls, use injectable `fetchFn`. Tests must fail before implementation.

4. **Implement to make tests pass (green).** Write the minimum code to make tests pass. Follow these patterns:
   - Components: functional React components with hooks, one per file in `src/components/`
   - Hooks: custom hooks in `src/hooks/`, each managing one concern
   - Codex client: class-based client in `src/codex/client.ts` with types in `src/codex/types.ts`
   - CLI: argument parsing in `src/cli.ts`, entry point in `src/index.tsx`

5. **Run verification:**
   ```sh
   cd packages/orchestrator-tui && npx vitest run  # TUI tests
   pnpm -r typecheck                                # Full typecheck
   pnpm build                                       # Full build
   ```

6. **Manual smoke check:** Review the rendered output in test frames. Verify all expected text markers appear.

7. **Commit and hand off.**

## Example Handoff

```json
{
  "salientSummary": "Implemented useChat hook with message history, streaming text accumulation, and command block tracking. Created ChatPanel, MessageList, CommandBlock, and InputBar components. 27 tests cover all chat functionality including message display, streaming deltas, command blocks, thinking state, and input submission.",
  "whatWasImplemented": "Created src/hooks/useChat.ts (message state management with sendMessage, onDelta, onTurnCompleted, onCommandExecution). Created src/components/ChatPanel.tsx (message list container), src/components/MessageList.tsx (scrollable message rendering with user/assistant prefixes, streaming cursor, thinking indicator), src/components/CommandBlock.tsx (bordered command display with $ prefix), updated src/components/InputBar.tsx (ink-text-input with submit/disabled states). 27 new tests in __tests__/chat.test.tsx.",
  "whatWasLeftUndone": "",
  "verification": {
    "commandsRun": [
      {"command": "cd packages/orchestrator-tui && npx vitest run", "exitCode": 0, "observation": "7 test files, 96 tests passed"},
      {"command": "pnpm -r typecheck", "exitCode": 0, "observation": "All 21 packages typecheck"},
      {"command": "pnpm build", "exitCode": 0, "observation": "All packages build"}
    ]
  },
  "tests": {
    "added": [
      {"file": "packages/orchestrator-tui/src/__tests__/chat.test.tsx", "cases": [
        {"name": "renders user messages with You: prefix", "verifies": "VAL-TUI-CHAT-001"},
        {"name": "renders assistant messages with Orchestrator: prefix", "verifies": "VAL-TUI-CHAT-002"}
      ]}
    ]
  },
  "discoveredIssues": []
}
```

## When to Return to Orchestrator

- Codex app-server protocol documentation is insufficient for implementing a feature
- A dependency (ink, ink-text-input, ink-testing-library) has an incompatible version
- Feature requires modifying server routes or API endpoints (out of scope)
