# Paperclip Fork Spec

Date: 2026-03-22

## Purpose

Define a fork plan for Paperclip that fixes the main control-plane failures
blocking true autonomous development:

- issue-less runs
- project/workspace drift into fallback `agent_home`
- timer noise that looks like progress
- board truth drifting away from repo truth
- stale duplicate runs and dead assignments
- slow execution caused by bad scheduling rather than model quality

This spec treats the problem as a control-plane and systems-reliability problem
first, not as an agent-prompt problem.

## Observed Failure Modes

These were repeatedly observed in live operation:

1. Runs started with missing execution context.
   - `issueId=null`
   - `projectId=null`
   - `projectWorkspaceId=null`

2. Agents executed from the wrong workspace.
   - issue-linked work drifted into fallback `agent_home`
   - project-bound output existed in the repo, but the board could not prove it

3. Heartbeat timers created fake busyness.
   - agents appeared active while no checked-out issue was actually moving
   - managers had to manually cancel stale timer runs before real work could proceed

4. Assignment and run state diverged.
   - an issue could remain `todo` while a run existed
   - an issue could be effectively complete in the repo while still open on the board

5. Wake delivery was too soft.
   - re-waking an assignee did not guarantee checkout, comment, or terminal state
   - there was no strong server-side consequence for ignored or failed pickups

6. Throughput was lost to coordination noise.
   - humans spent time reconciling stale runs and stale tickets instead of sequencing work
   - the org looked busy while effective work throughput remained low

## Design Goals

The fork should optimize for:

1. Truthful execution state
2. Strong project and workspace isolation
3. Strict issue ownership and lease semantics
4. Event-driven work dispatch over timer spray
5. Faster execution through warm workspaces and low scheduler waste
6. Better autonomous recovery when an agent does not pick up or complete work

## Non-Goals

- replacing the current agent adapters entirely
- changing the domain work done by agents
- making the system more permissive
- solving every product problem before restoring reliable execution invariants

## Core Thesis

Paperclip should stop thinking in terms of “wake an agent and hope it works” and
start thinking in terms of “dispatch one valid leased execution contract.”

The main hard invariant for the fork:

An autonomous run may not start unless it is:

- issue-linked
- workspace-bound
- goal-bound
- project-bound
- lease-controlled
- auditable through lifecycle events

Everything else in this spec follows from that.

## Control-Plane Invariants

For any non-ad hoc project execution:

1. Every run must have an execution envelope.
   Required fields:
   - `companyId`
   - `agentId`
   - `issueId`
   - `projectId`
   - `goalId`
   - `workspaceId`
   - `wakeReason`
   - `runKind`
   - `executionPolicyVersion`

2. Every run must be admitted by the scheduler.
   - direct “fire and forget” heartbeat launches are not allowed

3. Every issue may have at most one active execution lease at a time.

4. Every agent may have at most one active autonomous run at a time by default.

5. A project run may not use a fallback workspace.
   - if the declared workspace cannot be mounted, the run is rejected

6. A checked-out issue must leave the run in one of these states:
   - `done`
   - `blocked`
   - `in_review`
   - `in_progress` with required progress comment and active lease renewal

7. Timer wakes are hints, not execution.
   - timers create intents
   - only admitted intents create runs

## Architecture Overview

### Before

Current implied model:

- timer or comment wakes agent
- agent starts directly
- agent infers context
- agent may or may not checkout
- board state is updated opportunistically

### After

Target model:

1. Event creates a dispatch intent
2. Scheduler validates whether the intent is admissible
3. Scheduler allocates an execution lease
4. Dispatcher launches a run with an immutable execution envelope
5. Agent must checkout within a short TTL
6. Agent either progresses and renews lease, or the system auto-cancels/escalates
7. Board state is derived from lifecycle events and lease state

## Proposed Components

### 1. Intent Queue

A durable queue of work intents, not raw wakes.

Intent types:

- `issue_assigned`
- `issue_comment_mentioned`
- `dependency_unblocked`
- `approval_resolved`
- `timer_hint`
- `manager_escalation`
- `retry_after_failure`

Intent fields:

- `intentId`
- `companyId`
- `issueId`
- `projectId`
- `goalId`
- `workspaceId`
- `targetAgentId`
- `intentType`
- `priority`
- `createdAt`
- `notBefore`
- `dedupeKey`
- `sourceEventId`

Rules:

- duplicate intents collapse by `dedupeKey`
- timer hints never bypass intent validation
- closed, cancelled, or unassigned issues invalidate queued intents

### 2. Scheduler

The scheduler decides whether an intent becomes a run.

Admission checks:

- issue still open
- assignee still matches target agent
- required project/goal/workspace still exist
- no active lease on the issue
- no active autonomous run on the target agent
- issue dependency gates satisfied
- budget and quota constraints allow execution

Scheduler outputs:

- `admitted`
- `rejected`
- `deferred`
- `superseded`

### 3. Lease Manager

Execution is controlled by leases, not by best-effort agent compliance.

Lease types:

- `issue_execution_lease`
- `agent_execution_lease`
- optional later: `workspace_mutation_lease`

Lease fields:

- `leaseId`
- `leaseType`
- `issueId`
- `agentId`
- `runId`
- `expiresAt`
- `renewedAt`
- `state`

Rules:

- issue lease TTL starts at run dispatch
- checkout must happen within `checkoutTtlSec`
- no checkout before TTL expiry means auto-cancel plus escalation event
- in-progress work requires periodic lease renewal
- lease expiry without heartbeat/comment/update triggers reconciliation

### 4. Dispatcher

The dispatcher launches the agent process with an immutable execution envelope.

Injected context:

- execution envelope JSON
- signed workspace mount contract
- expected issue status at dispatch
- expected assignee at dispatch
- allowed tool / adapter policy

The agent may not mutate:

- `workspaceId`
- `projectId`
- `issueId`
- `goalId`

### 5. Event Log + Projections

Issue and run state should be derived from events, not only from mutable row
state.

Required events:

- `intent_created`
- `intent_deduped`
- `intent_admitted`
- `intent_rejected`
- `run_started`
- `run_cancelled`
- `run_failed`
- `run_completed`
- `lease_allocated`
- `lease_renewed`
- `lease_expired`
- `checkout_acquired`
- `checkout_conflict`
- `issue_status_changed`
- `issue_comment_created`
- `workspace_resolution_failed`
- `auto_escalation_created`

The product UI may still use materialized views, but those views should be
rebuilt from the event log.

## Data Model Changes

### New Table: `dispatch_intents`

Key fields:

- `id`
- `company_id`
- `issue_id`
- `project_id`
- `goal_id`
- `workspace_id`
- `target_agent_id`
- `intent_type`
- `priority`
- `status`
- `dedupe_key`
- `source_event_id`
- `created_at`
- `not_before`
- `resolved_at`

### New Table: `execution_leases`

Key fields:

- `id`
- `lease_type`
- `issue_id`
- `agent_id`
- `run_id`
- `state`
- `granted_at`
- `renewed_at`
- `expires_at`
- `released_at`
- `release_reason`

### New Table: `execution_envelopes`

Key fields:

- `run_id`
- `company_id`
- `agent_id`
- `issue_id`
- `project_id`
- `goal_id`
- `workspace_id`
- `wake_reason`
- `run_kind`
- `execution_policy_version`
- `workspace_binding_mode`
- `created_at`

### New Table: `control_plane_events`

Append-only.

Key fields:

- `id`
- `company_id`
- `aggregate_type`
- `aggregate_id`
- `event_type`
- `payload_json`
- `created_at`

### Run Table Changes

Add:

- `intent_id`
- `execution_envelope_version`
- `dispatch_admitted_at`
- `checkout_acquired_at`
- `workspace_resolution_status`
- `workspace_resolution_error`
- `run_class`

### Issue Table Changes

Add projected fields:

- `active_execution_lease_id`
- `active_run_id`
- `last_reconciled_at`
- `pickup_fail_count`
- `last_pickup_failure_at`
- `truth_source_version`

## Workspace Binding Model

This is one of the most important fixes.

### Current Failure

Runs may execute from fallback `agent_home` or some local default path even when
the issue belongs to a specific project workspace.

### Proposed Behavior

At dispatch time:

1. Resolve workspace from issue -> project -> workspace
2. Verify workspace exists and is available
3. Create a signed workspace binding contract
4. Launch the adapter only with that binding

Binding modes:

- `required_project_workspace`
- `explicit_ad_hoc_workspace`
- `manual_cli_unbound`

For autonomous project work, only `required_project_workspace` is allowed.

If resolution fails:

- do not launch the run
- emit `workspace_resolution_failed`
- post an automatic blocker comment
- optionally create or reopen a manager issue

### Adapter Contract Change

Adapters should receive a resolved absolute `cwd` plus a `workspaceBindingId`.

The adapter should be forbidden from silently substituting another working
directory for issue-linked work.

## Scheduler Rules

### Admission Rules

Reject or defer when:

- issue is closed
- assignee mismatch
- project or workspace missing
- active issue lease exists
- active agent run exists
- dependency unresolved
- issue status is `blocked` with no new context
- retry backoff window active

### Checkout Rules

A dispatched run must checkout within `checkoutTtlSec`.

Recommended default:

- `checkoutTtlSec = 60`

If checkout does not happen:

- cancel run
- release lease
- increment issue pickup failure count
- emit `pickup_timeout`
- escalate when threshold crossed

### Renewal Rules

For a checked-out issue:

- lease renew on comment, status patch, or explicit keepalive
- if no renewal before TTL expiry, mark run stale and reconcile

Recommended default:

- `leaseTtlSec = 300`

### Escalation Rules

Auto-escalate when:

- 2 failed pickups in 15 minutes
- 1 workspace binding failure
- run fails after checkout without comment
- issue remains assigned and untouched after repeated admitted intents

Escalation target:

- assignee’s manager by chain of command
- if none, company CEO / board queue

## Timer Heartbeat Redesign

The current heartbeat model should be demoted.

### Problem

Timers created long-running noise and fake progress.

### Fix

Heartbeat timers become low-priority `timer_hint` intents only.

Rules:

- timer hints do not launch immediately
- timer hints are dropped if any better event already exists for the issue
- timer hints should never create unbound or issue-less runs
- timer hints should be disabled by default for agents with repeated stale-pickup failures

### Recommendation

Default to event-driven wakes:

- assignment
- mention
- dependency unblocked
- approval resolved
- explicit manager wake

Use timers only for:

- manager sweeps
- overdue reconciliation
- stuck-issue audits

## Truthful Board State

This is the second major fix after workspace binding.

### Problem

Board truth drifted from repo truth and run truth.

### Fix

Build issue status projections from:

- issue events
- run events
- lease state

Examples:

- if an issue has an active admitted run with checkout, it projects to
  `in_progress`
- if a run is cancelled for no checkout, the issue stays `todo` but pickup
  failure metadata increments
- if an issue is marked `done`, all active intents and leases are invalidated

### Reconciler

Run a periodic reconciler that:

- closes orphaned active runs
- invalidates stale intents
- clears ghost `in_progress` projections
- compares run state vs issue state
- writes explicit reconciliation events

The reconciler should be cheap and always-on.

## Autonomy Improvements

Once correctness is fixed, autonomy improves naturally.

### Required Terminal-State Policy

If an agent checked out an issue, the run may not end silently.

The server should require one of:

- status change
- assignee comment
- explicit keepalive update

Otherwise:

- mark run failed
- auto-comment with failure classification
- escalate if repeated

### Output Registration

Agents should be able to register outputs explicitly:

- report paths
- plan docs
- generated artifacts
- run directories

This helps board truth track repo truth.

New endpoint:

- `POST /api/issues/{issueId}/artifacts`

Payload:

- `path`
- `kind`
- `summary`
- `producedByRunId`

### Dependency-Aware Dispatch

Allow issues to declare dependencies, and prevent meaningless wakes.

New projected issue states:

- `blocked_on_dependency`
- `ready`

### Parent/Child Contracts

Managers should create subtasks with explicit:

- owner
- workspace
- done gate
- dependency list
- artifact expectations

The system should enforce more of this at creation time.

## Performance Improvements

After correctness, speed comes from reducing wasted execution.

### 1. Warm Workspace Pools

Keep one hot environment per active workspace.

For local execution:

- pre-resolved repo path
- warm `uv` environment
- cached dependency graph

### 2. Sticky Workspace Reuse

Dispatch the same project’s repeated runs onto the same warm execution context
when possible.

### 3. Admission Control

Do not start runs that are already obsolete.

Examples:

- issue closed
- assignee changed
- dependency still blocked
- a fresher intent superseded the timer hint

### 4. Small Always-On Reconciliation Jobs

Use lightweight jobs instead of expensive manager babysitting:

- stale lease reaper
- orphan run reaper
- issue projection rebuilder
- superseded intent cleaner

### 5. Better Runtime Metrics

Track:

- admitted intents per minute
- rejected intents by reason
- pickup success rate
- mean checkout latency
- run time spent doing useful issue-linked work
- stale run count
- workspace binding failure count
- reconciliation corrections per hour

## API Changes

### New: Create Intent

`POST /api/intents`

Purpose:

- create a schedulable work intent instead of launching directly

### New: Admit Intent

`POST /api/intents/{intentId}/admit`

Usually internal-only.

### New: Renew Lease

`POST /api/runs/{runId}/lease/renew`

### New: Register Artifacts

`POST /api/issues/{issueId}/artifacts`

### New: Reconcile Issue

`POST /api/issues/{issueId}/reconcile`

Internal/admin path to force a projection rebuild.

### Changed: Wake Agent

Current wake behavior should become:

- create intent
- return intent record
- optionally return immediate rejection reason

It should no longer imply guaranteed run creation.

### Changed: Run Creation

All autonomous run creation should require a complete execution envelope.

### Changed: Checkout

Checkout should validate:

- run still owns active issue lease
- issue status still admissible
- assignee still matches

## Suggested State Machines

### Intent State Machine

- `queued`
- `admitted`
- `deferred`
- `rejected`
- `superseded`
- `consumed`

### Run State Machine

- `starting`
- `awaiting_checkout`
- `running`
- `stale`
- `cancelled`
- `failed`
- `completed`

### Lease State Machine

- `granted`
- `renewed`
- `expired`
- `released`

## Rollout Plan

### Phase 1: Hard Invariants

Ship first:

- mandatory execution envelope
- immutable workspace binding
- one active issue lease
- one active run per agent
- checkout TTL enforcement
- stale run reaper

Exit criteria:

- no new issue-less project runs
- no new project runs with fallback workspace

### Phase 2: Truthful Projections

Ship next:

- event log
- issue/run/lease projections
- reconciliation jobs
- projection-driven board state

Exit criteria:

- open-issue counts match direct issue truth without manual board cleanup

### Phase 3: Pickup Reliability

Ship next:

- pickup failure counters
- automatic escalation
- required terminal-state policy
- dependency-aware dispatch

Exit criteria:

- repeated wakes without checkout become rare and visible

### Phase 4: Throughput

Ship next:

- warm workspace pools
- sticky workspace reuse
- event-driven default wake model
- aggressive timer dedupe

Exit criteria:

- lower median time from assignment to first real progress
- lower stale-run rate

## Success Metrics

Primary:

- percent of project runs with full execution envelope: target `100%`
- percent of project runs with correct workspace binding: target `100%`
- percent of admitted runs that checkout within TTL: target `> 95%`
- issue/run projection mismatch rate: target `< 0.5%`
- stale autonomous run rate: target `< 1%`

Secondary:

- median assignment-to-checkout time
- median assignment-to-first-comment time
- manager reconciliation actions per day
- timer-originated admitted runs as share of total runs
- workspace binding failures per day

## Migration Notes

This fork can be introduced incrementally.

Backward-compatible path:

1. Start writing execution envelopes and events before enforcing them
2. Add leases in shadow mode
3. Project board state from events in parallel with legacy state
4. Turn on hard admission rejection once envelope coverage is complete
5. Turn timer wakes into intents only after event-driven wake paths are stable

## Implementation Notes

If engineering capacity is limited, prioritize in this order:

1. workspace binding hardening
2. execution envelope enforcement
3. lease + checkout TTL
4. stale run reaper
5. event log and truthful projections

That order delivers the biggest reliability gain quickly.

## Practical Product Rule

Paperclip should not be considered autonomous just because agents can write code
or comments. It is autonomous only when the control plane can guarantee:

- the right issue
- in the right workspace
- by the right assignee
- under a real lease
- with truthful observable outcome

That is the standard this fork should implement.
