---
name: backend-worker
description: Implements server-side services, DB schema, API routes, and their tests for the control plane
---

# Backend Worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the WORK PROCEDURE.

## When to Use This Skill

Features that involve:
- New or modified Drizzle schema tables
- New or modified server services (intent queue, scheduler, lease manager, dispatcher, event log, projections, reconciler)
- New or modified Express API routes
- Integration between control plane components
- Company lifecycle gates, quiesce behavior, cleanup/reconciliation hardening
- Issue identifier resolution or other shared backend contract fixes

## Required Skills

None

## Work Procedure

1. **Read the feature description and preconditions**. Check that preconditions are met (required tables exist, dependent services exist).

2. **Read existing code** in the area you're modifying:
   - For schema: read `packages/db/src/schema/` files and `packages/db/src/schema/index.ts`
   - For services: read `server/src/services/` — especially `heartbeat.ts` for patterns
   - For routes: read `server/src/routes/` for Express patterns
   - For shared types: read `packages/shared/src/`

3. **Write tests first** (red):
   - Create test file in `server/src/__tests__/` following existing naming convention (e.g., `intent-queue.test.ts`).
   - For DB-dependent tests, use embedded Postgres:
     ```typescript
     import { getEmbeddedPostgresTestSupport } from "./helpers/embedded-postgres.js";
     const { supported, startDatabase } = await getEmbeddedPostgresTestSupport();
     const describeDB = supported ? describe : describe.skip;
     ```
   - Write test cases covering: success paths, error paths, edge cases, concurrency where relevant.
   - Run `pnpm test:run` — new tests should FAIL.

4. **Implement the feature**:
   - **Schema**: Create schema file in `packages/db/src/schema/NEW_TABLE.ts`. Use Drizzle's `pgTable()`. Export from `index.ts`. Follow existing patterns (see `heartbeat_runs.ts`, `issues.ts` for reference).
   - **Service**: Create service file in `server/src/services/`. Follow the factory function pattern:
     ```typescript
     export function myService(db: ReturnType<typeof createDb>) {
       return {
         methodA: async (...) => { ... },
         methodB: async (...) => { ... },
       };
     }
     ```
   - **Routes**: Create route file in `server/src/routes/`. Register in `server/src/app.ts`. Use Zod for request validation.
   - **Shared types**: Add to `packages/shared/src/` if types are needed by multiple packages.
   - For lifecycle or identifier work, prefer one shared helper over duplicating logic in multiple routes or services.
   - Preserve company scoping and board/agent authorization expectations on every new or updated endpoint.

5. **Generate migrations** (if schema changed):
   ```sh
   cd packages/db && pnpm build && npx drizzle-kit generate
   ```
   Review the generated SQL migration for correctness.

6. **Run tests** (green):
   - `pnpm test:run` — all tests pass.
   - `pnpm -r typecheck` — no type errors.
   - `pnpm build` — builds successfully.

7. **Verify manually**:
   - For services: run individual test file to verify output: `cd server && npx vitest run src/__tests__/YOUR_TEST.test.ts`
   - For schema: verify migration SQL is additive (no DROP statements unless intentional).
   - For API behavior features: run focused `curl` checks for the exact success and failure cases claimed by the feature, including company-isolation or wrong-actor negatives when relevant.
   - For lifecycle features: verify both blocked admission and converged shutdown (`active-run`, `live-runs`, orchestrator/stale surfaces) rather than only the route response.
   - For issue identifier features: verify every secondary issue-detail endpoint that the page uses, not just the primary issue fetch.
   - If you start a local Node service for manual API checks, stop it afterward unless the next verification step explicitly reuses it.

## Example Handoff

```json
{
  "salientSummary": "Implemented intent queue service with 7 intent types, deduplication by dedupeKey, and full state machine (queued→admitted→consumed/rejected/superseded). Wrote 18 test cases covering creation, dedup, state transitions, and closed-issue invalidation. All pass with embedded Postgres.",
  "whatWasImplemented": "New service server/src/services/intent-queue.ts with methods: createIntent, getIntent, admitIntent, rejectIntent, supersedeIntent, consumeIntent, invalidateForClosedIssue, findQueuedIntents. Full Drizzle schema for dispatch_intents table with migration. 18 Vitest test cases in server/src/__tests__/intent-queue.test.ts.",
  "whatWasLeftUndone": "",
  "verification": {
    "commandsRun": [
      { "command": "cd server && npx vitest run src/__tests__/intent-queue.test.ts", "exitCode": 0, "observation": "18 tests passed in 4.2s" },
      { "command": "pnpm test:run", "exitCode": 0, "observation": "168 test files, 780 tests passed" },
      { "command": "pnpm -r typecheck", "exitCode": 0, "observation": "No errors" },
      { "command": "pnpm build", "exitCode": 0, "observation": "All packages built" }
    ],
    "interactiveChecks": []
  },
  "tests": {
    "added": [
      { "file": "server/src/__tests__/intent-queue.test.ts", "cases": [
        { "name": "creates intent with all required fields", "verifies": "intent creation" },
        { "name": "rejects intent with missing issueId", "verifies": "validation" },
        { "name": "deduplicates by dedupeKey", "verifies": "deduplication" },
        { "name": "transitions queued to admitted", "verifies": "state machine" },
        { "name": "rejects invalid transition rejected to admitted", "verifies": "state machine guards" }
      ]}
    ]
  },
  "discoveredIssues": []
}
```

## When to Return to Orchestrator

- Feature depends on a service or table that doesn't exist yet
- Existing lifecycle/admission paths are too entangled to update safely within one worker session
- Migration conflicts with existing data
- Test infrastructure (embedded Postgres) fails to start
- Requirements are ambiguous about behavior in edge cases
