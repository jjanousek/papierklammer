---
name: rename-worker
description: Handles codebase-wide rename operations (package scopes, env vars, paths, branding)
---

# Rename Worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the WORK PROCEDURE.

## When to Use This Skill

Features that involve renaming package scopes, environment variables, filesystem paths, or branding across the monorepo.

## Required Skills

None

## Work Procedure

1. **Read the feature description** carefully. Understand exactly what strings/patterns need to be renamed and to what.

2. **Write tests first** (red):
   - Create test file(s) in `server/src/__tests__/` that grep the codebase for old patterns and assert zero matches.
   - For schema changes: write tests that import the new schema and assert columns/types exist.
   - Run tests — they should FAIL (old patterns still present).

3. **Perform the rename**:
   - Use ripgrep (`rg`) to find all occurrences of the old pattern across the codebase (excluding node_modules, dist, .git).
   - Group changes by file type and area (package.json, TypeScript source, config files, documentation).
   - Apply changes systematically. For large-scale renames, process files in batches by directory.
   - Be careful with case sensitivity: `PAPERCLIP` vs `paperclip` vs `Paperclip` may all need different replacements.
   - Do NOT rename anything inside `node_modules/` or `dist/` directories.
   - After renames in package.json files, run `pnpm install` to update the lockfile.

4. **For schema changes**:
   - Create new schema files in `packages/db/src/schema/`.
   - Export from `packages/db/src/schema/index.ts`.
   - Add new columns to existing schema files as needed.
   - Generate migrations: `cd packages/db && pnpm build && npx drizzle-kit generate`.
   - Verify migrations look correct (additive only, no destructive changes).

5. **Run tests** (green):
   - `pnpm test:run` — all tests must pass including new ones.
   - `pnpm -r typecheck` — must pass.
   - `pnpm build` — must succeed.

6. **Manual verification**:
   - Run `rg 'OLD_PATTERN' . --glob '!node_modules/**' --glob '!dist/**' --glob '!.git/**'` to verify no stale references remain.
   - For env var renames, check `.env.example` is updated.

## Example Handoff

```json
{
  "salientSummary": "Renamed all @paperclipai/* package scopes to @papierklammer/* across 18 packages. Updated 127 import statements, 34 package.json files, and 15 script references. All 762 existing tests pass, typecheck clean, build succeeds.",
  "whatWasImplemented": "Full package scope rename from @paperclipai to @papierklammer in all package.json names, dependencies, devDependencies, peerDependencies, scripts, and TypeScript import statements. Updated pnpm-workspace.yaml and lockfile.",
  "whatWasLeftUndone": "",
  "verification": {
    "commandsRun": [
      { "command": "rg '@paperclipai/' . --glob '!node_modules/**' --glob '!dist/**'", "exitCode": 1, "observation": "Zero matches — all references renamed" },
      { "command": "pnpm test:run", "exitCode": 0, "observation": "150 test files, 768 tests passed (762 existing + 6 new rename verification tests)" },
      { "command": "pnpm -r typecheck", "exitCode": 0, "observation": "No type errors" },
      { "command": "pnpm build", "exitCode": 0, "observation": "All packages built successfully" }
    ],
    "interactiveChecks": []
  },
  "tests": {
    "added": [
      { "file": "server/src/__tests__/rename-verification.test.ts", "cases": [
        { "name": "no @paperclipai references in package.json files", "verifies": "package scope rename complete" },
        { "name": "no @paperclipai imports in TypeScript source", "verifies": "import rename complete" }
      ]}
    ]
  },
  "discoveredIssues": []
}
```

## When to Return to Orchestrator

- Rename would break a third-party integration or external API contract
- Found references in binary/generated files that cannot be renamed
- pnpm install fails after package.json renames (lockfile conflict)
