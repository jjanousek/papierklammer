# Paperclip, rebuilt for faster orchestration

This repository is a fork of [Paperclip](https://github.com/paperclipai/paperclip). It keeps the core idea intact: a control plane for running multi-agent companies with goals, issues, approvals, budgets, workspaces, a web UI, and local adapter support.

The biggest changes are not cosmetic. This fork reworks the backend control plane so the orchestrator spends less time waking the wrong thing, less time getting stuck behind stale runs, and less time drifting away from what is actually happening in the repo.

In short: the fork is built for higher real throughput, not just more activity.

## Why this fork exists

Upstream Paperclip is strong on the product model, adapter ecosystem, and operator surface area. In practice, though, long-running multi-agent setups still hit a few recurring backend problems:

- duplicate or stale runs blocking useful work
- timer-driven noise that looks like progress but does not move issues forward
- project work starting from the wrong workspace
- board state drifting away from actual runtime state
- too much manual cleanup before real work can resume

This fork treats those as control-plane problems first. The goal is a stricter and faster backend that admits only valid work, keeps ownership explicit, and recovers automatically when runs go stale.

## What stays the same

If you already know Paperclip, the high-level model will feel familiar:

- company-scoped agents, goals, projects, issues, approvals, and budgets
- Node.js server, React UI, CLI, and local adapter model
- bring-your-own runtimes such as Codex, Claude, OpenCode, Cursor, process, and HTTP adapters
- self-hosted deployment with embedded PostgreSQL for local development

The fork does not replace the Paperclip product model. It changes how work gets admitted, dispatched, tracked, and recovered.

## What changed in the backend

If you only remember three new ideas, remember these:

- work is queued as an intent before it is allowed to run
- active work is protected by a lease with expiry and renewal
- every admitted run gets a fixed execution envelope instead of inferring context on the fly

### At a glance

| Area | Upstream Paperclip | This fork |
| --- | --- | --- |
| Wakeups | Agents are primarily woken directly from timer, assignment, and comment flows | Work first becomes a durable intent in `dispatch_intents`, then passes admission control |
| Scheduling | Wake first, then let the runtime sort it out | Scheduler validates issue state, assignee, dependencies, workspace, budgets, leases, and agent capacity before dispatch |
| Concurrency control | Best-effort coalescing and stale-run reporting | Lease-controlled execution with TTLs, renewal, expiry, and one active execution path per issue |
| Workspace binding | Project work can still drift into fallback execution paths | Project work must resolve to a project workspace; missing workspace means the run is rejected |
| Run context | Context is inferred at run time | Each admitted run gets an immutable execution envelope |
| Recovery | Stale work is surfaced and often left for manual cleanup | Reconciliation jobs, stale-lease reaping, pickup failure tracking, and operator recovery endpoints are built into the server |
| Throughput | Timers can create noise and waste scheduler capacity | Event-driven intents outrank timer hints, dependency-unblocked work is re-queued automatically, and warm workspaces reduce cold-start churn |

### 1. Intent-driven dispatch instead of direct wake-and-hope

The most important architectural change is that wakes are no longer the main execution primitive.

This fork adds a durable `dispatch_intents` queue. Assignment, mentions, approvals, dependency changes, retries, and timer hints all enter the system as intents first. You can think of an intent as "a request to run this issue," not a run itself. The scheduler then decides whether that request should actually become a run.

That means the control plane can:

- dedupe repeated wakes for the same issue
- prioritize real events over timer noise
- reject invalid work before it starts consuming runtime
- defer work until it is actually safe and ready to run

This is a major difference from upstream Paperclip's more direct wakeup model, and it is the foundation for the other reliability improvements.

### 2. Lease-controlled execution instead of soft ownership

This fork adds `execution_leases` and uses them to enforce issue ownership in the runtime, not just in the UI. A lease is a time-limited claim on a piece of work.

In practice:

- one issue gets at most one active execution lease at a time
- dispatched runs have a time-limited execution window
- activity can renew the lease
- expired leases are reaped server-side
- runs that never properly pick up work can be cancelled automatically

This is how the fork attacks duplicate execution and stale blockage. Instead of hoping agents behave, the control plane has an explicit ownership model and expiry path.

### 3. Immutable execution envelopes and strict workspace binding

This fork adds `execution_envelopes` and creates one for every admitted run. An execution envelope is the frozen run context: company, agent, issue, project, goal, workspace, wake reason, and policy version.

Just as important, project work is expected to be workspace-bound. If a project workspace cannot be resolved, the run is rejected instead of silently falling back to a generic home directory.

For Paperclip users who have seen work land in the wrong checkout, this is one of the biggest behavioral changes in the fork.

### 4. Server-side reconciliation instead of stale-state drift

Upstream Paperclip explicitly leans toward surfacing stale work and keeping recovery fairly manual. This fork pushes much more of that burden back into the control plane.

It adds:

- append-only `control_plane_events` for lifecycle history
- reconciliation jobs for orphaned runs, stale intents, and ghost `in_progress` state
- stale-lease reaping tied to run cleanup
- pickup failure counters and escalation hooks
- operator endpoints for stale inspection, cleanup, nudges, and force-unblock actions

The result is a board that converges toward runtime truth faster, with less operator babysitting.

### 5. Dependency-aware scheduling

This fork adds issue dependency tracking in the backend and makes unresolved dependencies an admission gate.

When a dependency is completed, the control plane can enqueue `dependency_unblocked` intents automatically. That shifts the system away from repeatedly poking blocked issues and toward spending runtime on work that just became actionable.

### 6. Warm workspace reuse for better throughput

This fork adds a warm workspace pool and tighter workspace/runtime handling around project execution.

The goal is simple:

- reuse healthy workspace state when possible
- avoid unnecessary cold starts
- keep the right checkout sticky for repeated work on the same project
- keep actively leased workspaces out of circulation

This is one of the main ways the fork improves speed without changing models or prompts.

### 7. Stronger terminal-state enforcement

This fork is stricter about what counts as a meaningful run. A run that checks out work but finishes silently can be treated as a policy violation instead of being counted as success.

The server now has explicit logic for:

- checkout deadlines
- lease renewal as keepalive
- silent-completion detection
- automatic escalation when a run repeatedly fails to pick up or advance work

That makes the orchestrator less likely to look healthy while no real progress is happening.

## Why this is faster in practice

The fork is faster mainly because it wastes less execution:

- timer hints no longer compete equally with meaningful events
- duplicate work is blocked before it becomes a second run
- stale ownership expires instead of sitting around indefinitely
- blocked issues stop consuming scheduler attention
- warm workspaces reduce repeat setup cost
- board state is repaired automatically instead of waiting on manual cleanup

This is a throughput-oriented fork. The aim is not to make agents think faster. The aim is to stop the orchestrator from slowing them down.

## Backend components added by the fork

The main control-plane additions include:

- `dispatch_intents`
- `execution_leases`
- `execution_envelopes`
- `control_plane_events`
- `issue_dependencies`
- `scheduler`
- `dispatcher`
- `lease-manager`
- `reconciler`
- `timer-intent-bridge`
- `warm-workspace-pool`
- `orchestrator` recovery APIs and operator tooling

If you have worked on upstream Paperclip before, those are the pieces to inspect first.

## Secondary changes

The fork also adds stronger operator tooling around the new backend model:

- a dedicated orchestrator API for stale inspection, cleanup, nudging, reprioritization, and manual unblock flows
- an orchestrator console and TUI for runtime recovery workflows
- richer runtime and run-review surfaces

These are useful, but they are downstream of the backend changes above. The core story of the fork is the execution model.

## Quickstart

### Requirements

- Node.js 20+
- pnpm 9.15+

### Run from a local clone

```bash
pnpm install
pnpm dev
```

This starts the local server and development surfaces at `http://localhost:3100`.

Quick health checks:

```bash
curl http://localhost:3100/api/health
curl http://localhost:3100/api/companies
```

### Repository CLI

From the repository root:

```bash
pnpm papierklammer onboard --yes
pnpm papierklammer run
```

By default, local state lives under `~/.papierklammer`.

## Development

Common commands from the repository root:

```bash
pnpm dev
pnpm dev:watch
pnpm dev:tui
pnpm dev:server
pnpm dev:once
pnpm typecheck
pnpm test:run
pnpm build
pnpm db:generate
pnpm db:migrate
pnpm papierklammer --help
```

## Documentation

Useful starting points in this repository:

- [Fork control-plane spec](PAPERCLIP_FORK_SPEC.md)
- [Architecture report against upstream](PAPERCLIP_ARCHITECTURE_REPORT.md)
- [Implementation spec](doc/SPEC-implementation.md)
- [Agent runtime guide](docs/agents-runtime.md)
- [Architecture overview](docs/start/architecture.md)
- [Orchestrator console notes](orchestrator-console.md)

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.

## License and attribution

This repository remains MIT-licensed and builds directly on upstream [Paperclip](https://github.com/paperclipai/paperclip). Credit for the original product model, baseline architecture, and open-source foundation belongs with the upstream project.
