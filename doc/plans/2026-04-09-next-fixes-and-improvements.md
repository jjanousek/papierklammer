# 2026-04-09 Next Fixes And Improvements

## Scope

Investigation target:

- local Papierklammer dev run for `Weather Corp`
- current API state on `http://127.0.0.1:3100`
- persisted run logs under `~/.papierklammer/instances/default`

Current observed state at investigation time:

- API healthy: `GET /api/health` returned `200`
- Weather Corp exists as company `31df67d6-2c58-45f2-bd5d-9f4269a34be9`
- Weather Corp mission issue `WEA-1` is now `done`
- no live runs or stale intents for Weather Corp

## Findings

### 1. Direct assignment wakeups could create orphaned runs without execution leases

Impact:

- a brand-new company could fail on its first CEO run even though assignment and wakeup succeeded
- the control plane admitted work, then later killed that same run as orphaned
- onboarding-style test runs were unreliable because the first mission could die before producing useful work

Evidence:

- Weather Corp run `51723ce4-37c5-4f8d-9ab1-fb725ca614dc` ended as:
  - `status = failed`
  - `error_code = reconciliation_orphaned`
  - `error = Reconciler: orphaned run with no active lease`
- the associated issue execution state pointed at the run, but there was no matching active row in `execution_leases`
- root cause was the direct issue-assignment wakeup path creating a `heartbeat_run` without allocating the same `issue_execution` lease that scheduler-admitted runs receive

Likely code focus:

- `server/src/services/heartbeat.ts`
- `server/src/services/reconciler.ts`
- direct assignment wakeup path versus scheduler lease allocation path

Desired fix:

- always allocate an `issue_execution` lease when a direct issue wakeup creates a run
- keep `issues.executionLeaseId` synchronized anywhere execution ownership is set or cleared
- keep a regression test covering direct assignment wakeups tied to an issue

Status:

- fixed locally once already, with a focused regression test added
- should be reviewed, kept, and merged rather than reintroduced later

### 2. Local agent JWT injection failed for CEO heartbeat runs

Impact:

- at least one CEO heartbeat launched without `PAPIERKLAMMER_API_KEY`
- the agent had to fall back to implicit board access in `local_trusted` mode
- this is an adapter/runtime bug, not an agent-behavior bug

Evidence:

- failed run `51723ce4-37c5-4f8d-9ab1-fb725ca614dc` explicitly discovered `PAPIERKLAMMER_API_KEY` was unset in the heartbeat environment
- the same run traced the server warning path to `server/src/services/heartbeat.ts`
- `server/src/services/heartbeat.ts:2884-2895` logs `local agent jwt secret missing or invalid; running without injected PAPIERKLAMMER_API_KEY`
- `WEA-1` comments also record that the CEO recovered by using local trusted board access instead of agent auth

Likely code focus:

- `server/src/services/heartbeat.ts:2884-2895`
- `server/src/agent-auth-jwt.ts`
- onboarding / env persistence for `PAPIERKLAMMER_AGENT_JWT_SECRET`

Desired fix:

- fail fast and visibly when local JWT creation is required but unavailable
- or guarantee the signing secret is present before any `codex_local` heartbeat starts
- do not silently continue into a degraded auth mode for agent heartbeats

### 3. CEO heartbeats overlapped and caused duplicate organizational work

Impact:

- the same top-level mission spawned redundant approvals and duplicate routing cleanup
- later heartbeats had to repair state instead of making forward progress
- Weather Corp needed extra cleanup issue `WEA-8` only because routing drift accumulated

Evidence:

- `WEA-1` shows `pickupFailCount: 3`
- Weather Corp comments record:
  - duplicate specialist paths (`WEA-3`, `WEA-4` versus `WEA-6`, `WEA-7`)
  - redundant hire approvals later marked unnecessary
  - a later CEO heartbeat hit a `409` checkout conflict because another CEO run was already active
- recent run data confirms multiple CEO runs touched the same mission close together:
  - `55486705-af1c-4803-9bf2-3c3aa34a1143`
  - `f34bbaaf-8623-41d1-b169-b64f03ccc3f2`

Likely code focus:

- heartbeat scheduling / wake dedup for the same agent+issue
- assignment-triggered versus on-demand heartbeat concurrency
- enforcement of `maxConcurrentRuns: 1` for local adapters

Desired fix:

- prevent a second heartbeat from starting when the same agent already has an active run for the same issue
- coalesce duplicate wakes instead of letting both runs mutate shared company state

### 4. Concurrent workspace writes caused `apply_patch` verification failure

Impact:

- the closing CEO run succeeded overall but hit a real write conflict in its managed memory/project files
- this indicates shared workspace state can drift underneath a live run

Evidence:

- successful run `f34bbaaf-8623-41d1-b169-b64f03ccc3f2` contains:
  - `ERROR codex_core::tools::router: error=apply_patch verification failed`
  - target file: `.../life/projects/weather-corp/summary.md`
- the same run later observed that another heartbeat had already updated the memory files

Likely code focus:

- per-agent workspace locking
- sequencing of post-run memory/project-summary writes
- cross-run mutation rules for shared agent home files

Desired fix:

- serialize writes to the managed agent workspace
- or isolate per-run scratch state and merge deterministically afterward

### 5. Lease cleanup and run teardown have a deadlock risk

Impact:

- execution teardown can contend with cleanup in a way that produces a database deadlock
- even if this surfaced first in a test harness, the same lock-ordering problem is relevant to pause/archive/delete flows that cancel many runs at once

Evidence:

- during the focused direct-wakeup regression test, the assertion passed but a background heartbeat later logged:
  - `PostgresError: deadlock detected`
- the deadlock happened while heartbeat cleanup was still running after the lease-related test case

Likely code focus:

- heartbeat execution teardown
- lease release / issue execution cleanup
- any bulk cancellation paths that touch runs, issues, and execution leases in different lock orders

Desired fix:

- audit lock ordering across run teardown and lease cleanup paths
- make lifecycle cancellation flows use a consistent row-touch order
- add a concurrency-focused regression test if this reproduces outside the current test setup

### 6. Early Weather Corp runs also hit CLI/runtime boot problems

Impact:

- onboarding-quality reliability is low even before business logic begins

Evidence:

- failed run `51723ce4-37c5-4f8d-9ab1-fb725ca614dc` tried fallback command `paperclipai agent local-cli ...` and got `command not found: paperclipai`
- failed run `75d754fd-851f-4f12-af5d-533a42261dee` logged repeated:
  - `failed to refresh available models: timeout waiting for child process to exit`

Likely code focus:

- heartbeat PATH / CLI bootstrapping
- Codex model refresh subprocess lifecycle

Desired fix:

- ensure supported Paperclip CLI entrypoints are available in heartbeat PATH when referenced
- investigate why Codex model refresh can hang long enough to fail a run

### 7. Issue work-product route still has inconsistent identifier handling

Impact:

- a normal issue page can still hit a server `500` when the route receives an issue identifier instead of a UUID
- this is a real API correctness bug I reproduced live

Evidence:

- `curl http://127.0.0.1:3100/api/issues/AUD-2/work-products` returned `500 Internal server error`
- current server log shows:
  - `invalid input syntax for type uuid: "AUD-2"`
- `server/src/routes/issues.ts:522-531` calls `svc.getById(id)` directly for `/issues/:id/work-products`
- `server/src/routes/activity.ts:33-38` already has the correct identifier-or-UUID resolution pattern

Likely code focus:

- `server/src/routes/issues.ts:522-531`
- any sibling routes under `issues.ts` that still call `getById` on selector-like params

Desired fix:

- normalize issue selectors consistently across all issue-scoped routes
- return `404 Issue not found` for unknown identifiers instead of leaking a database uuid parse failure as `500`

## Suggested Order

1. Keep and merge the execution-lease fix for direct assignment wakeups.
2. Fix local JWT injection for local adapters.
3. Add same-agent same-issue heartbeat dedup / concurrency guard.
4. Fix workspace write serialization for managed memory/project files.
5. Audit deadlock risk in lease cleanup and run teardown.
6. Fix identifier handling in `issues.ts` work-product and sibling routes.
7. Investigate Codex model refresh timeouts and heartbeat PATH completeness.

## Residual Risk

- Weather Corp itself is complete, so these defects are easy to miss unless another onboarding-style company is started.
- The most serious runtime bugs are cross-cutting: auth injection and concurrent heartbeats can corrupt many workflows, not just Weather Corp.
