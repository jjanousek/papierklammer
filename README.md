<h1 align="center">Papierklammer</h1>

<p align="center">
  <strong>An opinionated fork of <a href="https://github.com/paperclipai/paperclip">Paperclip</a> — a self-hosted control plane for running multi-agent companies.</strong>
</p>

<p align="center">
  <a href="#what-is-papierklammer">What is it?</a> &middot;
  <a href="#how-this-fork-differs-from-upstream-paperclip">Fork differences</a> &middot;
  <a href="#quickstart">Quickstart</a> &middot;
  <a href="#the-three-surfaces">Surfaces</a> &middot;
  <a href="#documentation">Docs</a>
</p>

<p align="center">
  <img src="doc/assets/header.png" alt="Papierklammer" width="720" />
</p>

<!--
  TODO: replace this placeholder with a real screenshot of the GUI dashboard.
  Drop the image in doc/assets/ and update the src below.
-->
<p align="center">
  <img src="doc/assets/dashboard-placeholder.png" alt="Papierklammer dashboard screenshot — placeholder" width="900" />
  <br/>
  <sub><em>Screenshot placeholder — drop your dashboard image into <code>doc/assets/</code> and update the path.</em></sub>
</p>

---

## What is Papierklammer?

Papierklammer is a self-hosted control plane that orchestrates a team of AI agents
the way you would orchestrate a real company: org charts, goals, projects, issues,
budgets, approvals, governance, and an audit trail. It is a Node.js server with a
React board UI, a CLI, and a full-screen terminal UI (TUI).

You bring the agents (Claude Code, Codex, OpenClaw, Cursor, OpenCode, plus any
HTTP/process adapter). Papierklammer decides which agent should pick up which work,
in which workspace, under which budget, and keeps the board state honest while it
all runs.

If you have ever:

- juggled twenty terminal tabs of coding agents and lost track of who is doing what,
- watched an agent silently work in the wrong directory and quietly nuke the wrong files,
- paid a five-figure token bill because nothing capped a runaway loop,
- or wanted "task manager that runs itself" instead of yet another chatbot,

…this is the kind of system Papierklammer (and its upstream, Paperclip) is built for.

> **Heads-up:** Papierklammer is a personal fork. If you want the polished,
> community-supported product with Discord, plugin marketplace, telemetry, and
> a stable release cadence, use upstream
> [paperclipai/paperclip](https://github.com/paperclipai/paperclip) instead.
> Papierklammer is for people who specifically want the changes described below.

---

## How this fork differs from upstream Paperclip

Upstream Paperclip is strong on the product model, adapter ecosystem, and operator
surface area. This fork keeps that model intact and changes three things underneath:

1. **The backend control plane** — rebuilt around intents, leases, and execution envelopes so the orchestrator wastes less time on stale or invalid work.
2. **The UI** — redesigned around a brutalist, monospace, TUI-inspired aesthetic. Same pages, very different look.
3. **A first-class TUI** — a full-screen terminal client (`papierklammer-tui`) for operators who live in the terminal.

It also drops a few upstream pieces that did not fit a single-operator setup
(see [What this fork removes](#what-this-fork-removes-trade-offs)).

### At a glance

| Area | Upstream Paperclip | Papierklammer |
| --- | --- | --- |
| **Wakeups** | Agents are woken directly from timers, assignments, and comments. | Work first becomes a durable **intent** in `dispatch_intents`, then passes admission control. |
| **Scheduling** | Wake first, let the runtime sort it out. | A scheduler validates issue state, assignee, dependencies, workspace, budgets, leases, and agent capacity *before* dispatch. |
| **Concurrency** | Best-effort coalescing, stale-run reporting. | **Lease-controlled execution** with TTLs, renewal, expiry, and one active execution path per issue. |
| **Workspace binding** | Project work can drift into a fallback `agent_home` directory. | Project runs **must** resolve to a real project workspace. Missing workspace = run rejected. |
| **Run context** | Inferred at run time. | Each admitted run gets an **immutable execution envelope**. |
| **Recovery** | Stale work is surfaced and often left for manual cleanup. | Reconciler jobs, stale-lease reaping, pickup-failure tracking, and operator endpoints are built in. |
| **Operator surfaces** | React board UI + CLI. | React board UI (redesigned) + CLI + **full-screen TUI** + **Orchestrator Console** chat surface. |
| **Look & feel** | Modern shadcn/Tailwind product UI. | Brutalist, monospace, terminal-inspired (no rounded corners, no shadows, one font). |
| **Telemetry** | Anonymous usage telemetry, opt-out. | **Removed.** No phone-home. |
| **In-product feedback / share** | Yes. | **Removed.** |
| **Routines (cron-like) CLI command** | Yes. | Removed from the CLI surface (still wired in the server). |

### What stays the same

If you already know Paperclip, the high-level model will feel familiar:

- company-scoped agents, goals, projects, issues, approvals, and budgets
- Node.js server, React UI, CLI, and the local adapter model
- bring-your-own runtimes — Codex, Claude Code, OpenCode, Cursor, OpenClaw, plus process and HTTP adapters
- self-hosted deployment with embedded PostgreSQL for local development
- the plugin SDK and the existing example plugins

The fork does **not** replace the Paperclip product model. It changes how work
gets admitted, dispatched, tracked, and recovered — and how it looks while doing it.

---

## What changed in the backend

If you only remember three new ideas, remember these:

- work is queued as an **intent** before it is allowed to run,
- active work is protected by a **lease** with expiry and renewal,
- every admitted run gets a fixed **execution envelope** instead of inferring context on the fly.

### 1. Intent-driven dispatch instead of direct wake-and-hope

Wakes are no longer the main execution primitive. The fork adds a durable
`dispatch_intents` queue. Assignments, mentions, approvals, dependency unblocks,
retries, and timer hints all enter the system as **intents** first. The scheduler
then decides whether that intent should actually become a run.

That means the control plane can:

- dedupe repeated wakes for the same issue,
- prioritize real events over timer noise,
- reject invalid work before it consumes runtime,
- defer work until it is actually safe and ready to run.

### 2. Lease-controlled execution instead of soft ownership

`execution_leases` enforce issue ownership in the runtime, not just in the UI.
A lease is a time-limited claim on a piece of work:

- one issue gets at most one active execution lease at a time,
- dispatched runs have a checkout TTL,
- activity renews the lease,
- expired leases are reaped server-side,
- runs that never properly pick up their work are auto-cancelled.

This is how the fork attacks duplicate execution and stale blockage. Instead of
hoping agents behave, the control plane has an explicit ownership model and an
expiry path.

### 3. Immutable execution envelopes and strict workspace binding

Every admitted run gets an `execution_envelope` row: company, agent, issue, project,
goal, workspace, wake reason, and policy version — frozen at dispatch time.

Project work is **workspace-bound**. If a project workspace cannot be resolved, the
run is rejected instead of silently falling back to a generic home directory. For
anyone who has watched an agent commit work into the wrong checkout, this is the
single biggest behavioral change in the fork.

### 4. Server-side reconciliation instead of stale-state drift

The fork pushes recovery back into the control plane. It adds:

- append-only `control_plane_events` for lifecycle history,
- reconciliation jobs for orphaned runs, stale intents, and ghost `in_progress` state,
- stale-lease reaping tied to run cleanup,
- pickup-failure counters and escalation hooks,
- operator endpoints for stale inspection, cleanup, nudges, and force-unblock actions.

The result: a board that converges toward runtime truth faster, with less operator
babysitting.

### 5. Dependency-aware scheduling

Issue dependencies are tracked in the backend and unresolved dependencies are an
admission gate. When a dependency completes, the control plane enqueues
`dependency_unblocked` intents automatically — runtime stops poking blocked issues
and starts spending on work that just became actionable.

### 6. Warm workspace reuse

A warm workspace pool keeps healthy workspace state in circulation:

- reuse healthy checkouts when possible,
- avoid unnecessary cold starts,
- keep the right checkout sticky for repeated work on the same project,
- keep actively leased workspaces out of the pool.

### 7. Stronger terminal-state enforcement

A run that checks out work but finishes silently can be treated as a policy
violation instead of being counted as success. The server has explicit logic for
checkout deadlines, lease renewal as keepalive, silent-completion detection, and
automatic escalation when a run repeatedly fails to pick up or advance work.

### Backend components added by the fork

If you have worked on upstream Paperclip before, these are the pieces to inspect first:

- `dispatch_intents`, `execution_leases`, `execution_envelopes`, `control_plane_events`, `issue_dependencies` (new tables)
- `scheduler`, `dispatcher`, `lease-manager`, `reconciler` (new services)
- `intent-queue`, `timer-intent-bridge`, `warm-workspace-pool` (new services)
- `orchestrator` recovery API and operator tooling (`server/src/routes/orchestrator.ts`)
- `terminal-state-policy`, `escalation`, `dependency`, `event-log`, `projections` (new services)

Why this is faster in practice:

- timer hints no longer compete equally with meaningful events,
- duplicate work is blocked before it becomes a second run,
- stale ownership expires instead of sitting indefinitely,
- blocked issues stop consuming scheduler attention,
- warm workspaces reduce repeat setup cost,
- board state is repaired automatically instead of waiting on manual cleanup.

The aim is not to make agents think faster. The aim is to stop the orchestrator
from slowing them down.

---

## The three surfaces

Papierklammer exposes the same control plane through three different surfaces.

### 1. The Board (Web UI)

A React board with companies, org charts, goals, projects, issues, approvals,
budgets, costs, plugins, and instance settings. Same product model as upstream,
**redesigned from scratch**:

- TUI-inspired, brutalist, monospace-only,
- no border-radius, no shadows, no gradients,
- borders are the only spatial dividers,
- high information density,
- swappable themes (rose, earth, violet/indigo).

If you liked the modern shadcn look upstream uses, you will probably *not* like the
fork's UI. If you want a board that feels like a terminal pretending to be a web app,
this is the point. See `papierklammer-design-system.md` for the design contract.

### 2. The CLI (`pnpm papierklammer …`)

Same operator commands as upstream Paperclip, plus the orchestrator routes:

```bash
pnpm papierklammer onboard --yes      # one-shot setup
pnpm papierklammer run                # run the local server
pnpm papierklammer doctor             # diagnose a local install
pnpm papierklammer issue …            # inspect/manage issues
pnpm papierklammer agent …            # inspect/manage agents
pnpm papierklammer dashboard          # quick dashboard summary
pnpm papierklammer --help             # full command list
```

### 3. The Orchestrator TUI (`packages/orchestrator-tui`)

A new full-screen terminal UI built on **Ink + React**. It is not a thin CLI wrapper
— it is a real client to the same control plane that the board UI talks to.

```bash
pnpm dev:tui          # run the TUI against your local Papierklammer
# or, after a build:
papierklammer-tui --url http://localhost:3100 --api-key <key>
```

What you get inside the TUI:

- a chat panel against a top-level management agent,
- live agent sidebar and status bar,
- company picker, settings overlay, and help overlay,
- streaming command blocks for agent tool calls,
- error boundary so a bad message does not eat your terminal.

There is also an embedded **Orchestrator Console** package
(`packages/orchestrator-console`) used by the board to host the same chat surface
as a board widget — see `orchestrator-console.md` for the spec.

---

## What this fork removes (trade-offs)

Be honest with yourself before adopting it. This fork is not strictly "better" —
it is **different**, and a few upstream things are gone:

- **No telemetry.** Upstream Paperclip ships anonymous, opt-out telemetry. Papierklammer removes it entirely. Good for privacy, bad if you cared about contributing usage signal back to upstream.
- **No in-product feedback / share flow.** Upstream has a "send feedback" path with redaction; the fork drops it.
- **No `papierklammer routines` CLI command.** The routines feature still exists on the server side, but the dedicated CLI surface from upstream was removed in this fork.
- **No public docs site.** Upstream has a Mintlify-based docs site; this fork only ships the in-repo `doc/` and `docs/` folders.
- **No Discord, no plugin marketplace, no community.** This is a personal fork, not a product.
- **Diverges from upstream.** The control-plane changes are deep enough that pulling in upstream changes is non-trivial. If you care about staying close to mainline Paperclip, do not use this fork.
- **Higher backend complexity.** Intents, leases, envelopes, reconcilers, projections, and a warm workspace pool are real surface area. There are simply more moving parts to understand and operate than upstream has.
- **The new UI is a strong opinion.** Brutalist, monospace, no rounded corners. It is an acquired taste; it is not for everyone.
- **Renamed everywhere.** Package names, env vars, and config directories are `papierklammer*`, not `paperclip*`. State lives under `~/.papierklammer` by default. Existing Paperclip data does not migrate automatically.

If those trade-offs sound bad, use upstream
[paperclipai/paperclip](https://github.com/paperclipai/paperclip) instead. It is
the right project for most people.

---

## Quickstart

### Requirements

- Node.js 20+
- pnpm 9.15+

### Run from a local clone

```bash
git clone <this-fork>
cd papierklammer_droid
pnpm install
pnpm dev
```

This boots:

- the API server at `http://localhost:3100`,
- an embedded PostgreSQL (no setup required),
- the React board UI in dev mode,
- the dev TUI alongside it (use `pnpm dev:server` if you want the server alone).

Quick health checks:

```bash
curl http://localhost:3100/api/health
curl http://localhost:3100/api/companies
```

### Onboarding via the CLI

From the repository root:

```bash
pnpm papierklammer onboard --yes
pnpm papierklammer run
```

By default, local state lives under `~/.papierklammer`.

### Run only the TUI against an existing instance

```bash
pnpm dev:tui
# or after building:
node packages/orchestrator-tui/dist/index.js \
  --url http://localhost:3100 \
  --api-key "$PAPIERKLAMMER_API_KEY"
```

---

## Development

Common commands from the repository root:

```bash
pnpm dev              # full dev (server + UI + TUI)
pnpm dev:watch        # server in watch mode
pnpm dev:tui          # TUI only
pnpm dev:server       # server only
pnpm dev:once         # full dev without file watching
pnpm typecheck        # type check the workspace
pnpm test:run         # run unit tests
pnpm build            # build everything
pnpm db:generate      # generate a Drizzle migration
pnpm db:migrate       # apply migrations
pnpm papierklammer --help
```

---

## Documentation

Useful starting points inside this repository:

- [`PAPERCLIP_FORK_SPEC.md`](PAPERCLIP_FORK_SPEC.md) — the full control-plane spec for the fork (intents, leases, envelopes, reconciler, etc.)
- [`PAPERCLIP_ARCHITECTURE_REPORT.md`](PAPERCLIP_ARCHITECTURE_REPORT.md) — architecture report against upstream Paperclip
- [`papierklammer-design-system.md`](papierklammer-design-system.md) — the brutalist UI design contract
- [`orchestrator-console.md`](orchestrator-console.md) — spec for the embedded Commander chat surface
- [`doc/SPEC-implementation.md`](doc/SPEC-implementation.md) — implementation spec
- [`doc/DEVELOPING.md`](doc/DEVELOPING.md) — development guide
- [`docs/start/architecture.md`](docs/start/architecture.md) — architecture overview
- [`docs/agents-runtime.md`](docs/agents-runtime.md) — agent runtime guide

---

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) before
opening a pull request.

This is a personal fork, so the bar for accepting changes is "does it fit the
control-plane and design opinions described above?" — not strict feature parity
with upstream.

---

## License and attribution

MIT. Papierklammer builds directly on
[paperclipai/paperclip](https://github.com/paperclipai/paperclip). Credit for the
original product model, baseline architecture, plugin SDK, adapter ecosystem, and
open-source foundation belongs with the upstream project.

If Papierklammer is useful to you, the right way to thank somebody for it is to
go star upstream Paperclip first.
