# Architecture: Papierklammer

## System Overview

Papierklammer is a TypeScript monorepo for autonomous AI agent orchestration. It manages a "company" of AI agents that work on issues, organized by projects and goals.

## Monorepo Structure

```
packages/db/          — Drizzle ORM schema + migrations (PostgreSQL)
packages/shared/      — Shared types, constants, validators (Zod)
packages/adapter-utils/ — Adapter interface + shared utilities
packages/adapters/    — 7+ agent adapters (claude, codex, cursor, gemini, etc.)
packages/plugins/     — Plugin SDK + examples
packages/orchestrator-console/ — [NEW] Orchestrator CLI tool
server/               — Express 5 API server + services
ui/                   — React 19 + Vite frontend
cli/                  — CLI tool (commander.js)
```

## Data Flow: Intent → Execution

### Before (legacy heartbeat model)
```
Timer/Event → enqueueWakeup() → heartbeat_runs(queued) → executeRun() → adapter.execute()
```
Everything happens in heartbeat.ts (~4000 lines). Fire-and-forget dispatch. No admission control. Workspace resolved inline. No leases.

### After (Papierklammer control plane)
```
Event → Intent Queue (dispatch_intents) → Scheduler (admission) → Lease Manager (execution_leases)
→ Dispatcher (execution_envelopes) → heartbeat_runs(running) → adapter.execute()
→ Event Log (control_plane_events) → Projections → Board State
```

## Key Components

### Intent Queue (`server/src/services/intent-queue.ts`)
- Replaces direct `enqueueWakeup()` calls
- Durable queue backed by `dispatch_intents` table
- Deduplication by `dedupeKey`
- State machine: queued → admitted/rejected/superseded/deferred → consumed

### Scheduler (`server/src/services/scheduler.ts`)
- Consumes intents from the queue
- Admission checks: issue open, assignee match, workspace exists, no active lease, agent capacity, budget
- Outputs: admitted/rejected/deferred/superseded
- Replaces ad-hoc logic scattered in heartbeat.ts

### Lease Manager (`server/src/services/lease-manager.ts`)
- Execution leases for issues and agents
- Backed by `execution_leases` table
- Checkout TTL enforcement (60s default)
- Lease renewal on agent activity
- Auto-cancel on expiry

### Dispatcher (`server/src/services/dispatcher.ts`)
- Creates immutable execution envelopes
- Resolves workspace at dispatch time
- Rejects if workspace unavailable (no fallback for project work)
- Passes envelope to adapter via AdapterExecutionContext

### Event Log (`server/src/services/event-log.ts`)
- Append-only `control_plane_events` table
- All lifecycle transitions emit events
- Source of truth for projections

### Projection Service (`server/src/services/projections.ts`)
- Derives issue status from events/run/lease state
- Issue with active run+checkout → in_progress
- Cancelled run → stays at raw status

### Reconciler (`server/src/services/reconciler.ts`)
- Periodic job: close orphaned runs, invalidate stale intents, fix ghost projections
- Emits reconciliation events

### Stale Run Reaper (extension of existing `reapOrphanedRuns`)
- Adds lease-based reaping
- Cancels runs with expired leases
- Increments pickup failure count

### Warm Workspace Pool (`server/src/services/warm-workspace-pool.ts`)
- In-memory pool of resolved workspace paths
- TTL-based eviction, LRU when at capacity
- Sticky routing: prefer warm workspace for same project

### Orchestrator Console (`packages/orchestrator-console/`)
- Standalone CLI tool (commander.js)
- Admin-level API endpoints under `/api/orchestrator/`
- No LLM integration — pure API + REPL

## Database Schema (key tables)

### New tables
- `dispatch_intents` — Work intent queue
- `execution_leases` — Lease tracking
- `execution_envelopes` — Immutable run context
- `control_plane_events` — Append-only event log
- `issue_dependencies` — Issue dependency graph

### Modified tables
- `heartbeat_runs` — Added: intentId, envelopeId
- `issues` — Added: executionLeaseId, pickupFailCount, lastPickupFailureAt, lastReconciledAt

## Integration Points

The new control plane intercepts the existing heartbeat system at these points:
1. `enqueueWakeup()` → replaced by intent creation
2. `startNextQueuedRunForAgent()` → replaced by scheduler
3. Issue execution lock → replaced by leases
4. `executeRun()` → decomposed: envelope construction + dispatch + execution
5. `tickTimers()` → creates timer_hint intents instead of direct wakeups
6. `releaseIssueExecutionAndPromote()` → lease release + event emission

The adapter interface is preserved. Adapters receive additional envelope context but existing AdapterExecutionContext fields remain.
