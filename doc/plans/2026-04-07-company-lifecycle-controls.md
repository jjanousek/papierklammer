# Company Lifecycle Controls Plan

Status: Proposed  
Date: 2026-04-07  
Owner: Product + Server + UI

## 1. Goal

Define and implement safe, explicit company lifecycle controls so that:

- `Pause company` stops all current and future work in the company until resumed.
- `Archive company` behaves like a real retired state, not just a sidebar filter.
- `Delete company` is available in the product UI as a deliberate, irreversible purge flow.

This plan is specifically intended to fix the current archive bug where archived
companies can still produce heartbeats and background work.

## 2. Current State (Repo Reality)

### 2.1 What exists today

- Company statuses already include `active | paused | archived`.
- `companies` already has `pause_reason` and `paused_at`.
- `PATCH /api/companies/:companyId` can already set `status`.
- `POST /api/companies/:companyId/archive` exists.
- `DELETE /api/companies/:companyId` exists.
- The UI exposes only `Archive company`.

### 2.2 What is broken today

- `Archive company` is effectively cosmetic.
- Archived companies are hidden from the sidebar, but are not treated as
  non-runnable by the heartbeat/timer pipeline.
- Timer scheduling, wakeup admission, queued-run claiming, and other execution
  paths gate on agent state and budget state, but not on company archival.
- The existing delete route is a raw database purge and does not first quiesce
  active work.
- There is no explicit company pause/resume product flow even though the status
  exists in the schema.

## 3. Product Decisions

## 3.1 Company lifecycle semantics

Define the canonical meanings of company states:

- `active`
  - Normal state.
  - New work may be admitted.
  - Existing work may continue.

- `paused`
  - Temporary operator-controlled stop.
  - No new work may start.
  - Existing queued/running work must be cancelled as part of the pause action.
  - Board users may still edit tasks, goals, agents, budgets, and settings.
  - Company may be resumed back to `active`.

- `archived`
  - Soft-retired state.
  - Hidden from default navigation and company pickers.
  - No new work may start.
  - Existing queued/running work must be cancelled as part of the archive action.
  - Intended for companies that should remain visible for history/export/delete,
    but should no longer operate.
  - Archived companies remain in the database until explicitly deleted.

- `deleted`
  - Not a persisted status.
  - Permanent purge operation.
  - Irreversible.

## 3.2 Difference between pause and archive

- `Pause` is reversible and operational.
- `Archive` is retirement/hiding plus full execution shutdown.
- Both `pause` and `archive` must stop current and future work.
- The difference is product meaning and UI treatment, not runtime safety.

## 3.3 Delete behavior

- Deletion is board-only.
- Deletion is not the normal way to stop a company.
- Deletion is allowed only through an explicit confirmation flow in the UI.
- The canonical product flow should require the company to be `paused` or
  `archived` before delete is allowed.
- Delete must not remain a silent raw purge that can be triggered against an
  actively running company.

## 4. Execution Invariants

These invariants must hold after this work lands:

1. A company in `paused` state cannot start new work.
2. A company in `archived` state cannot start new work.
3. Pausing a company cancels all queued/running company work.
4. Archiving a company cancels all queued/running company work before the
   archive transition completes.
5. Resume is only valid from `paused -> active`.
6. Delete is only valid when the company has been explicitly quiesced first
   (`paused` or `archived`).
7. All lifecycle transitions are auditable.

## 5. Scope of “Work”

For this feature, “work” means all operational execution paths that cause agent
activity or downstream execution side effects, including:

- queued and running `heartbeat_runs`
- `agent_wakeup_requests`
- queued/admitted `dispatch_intents`
- timer-driven heartbeat hints
- issue-assignment-triggered wakeups
- manual wakeups / manual “run now” style invocations
- routine-triggered execution that creates or wakes work

Board data management is still allowed while a company is paused:

- editing issues
- editing goals
- editing projects
- editing agents
- changing budgets/settings

Archived companies may remain readable and exportable. Product-side write
restrictions beyond execution shutdown are optional for this phase and can be
decided separately.

## 6. API Design

## 6.1 Lifecycle routes

Introduce dedicated company lifecycle routes and make them canonical:

- `POST /api/companies/:companyId/pause`
- `POST /api/companies/:companyId/resume`
- `POST /api/companies/:companyId/archive`
- `POST /api/companies/:companyId/delete`

Rationale:

- `PATCH /api/companies/:companyId` is insufficient because lifecycle changes
  need coordinated side effects.
- Dedicated routes make the operational behavior explicit and auditable.
- The existing raw `DELETE /api/companies/:companyId` route should no longer be
  the product-facing entry point.

## 6.2 Route semantics

### Pause

`POST /api/companies/:companyId/pause`

Behavior:

- validate board access and company access
- if already paused, return current company
- if archived, reject with `409`
- mark company `status=paused`
- set `pauseReason=manual`
- set `pausedAt=now`
- cancel all queued/running work for the company
- cancel/suppress all pending wakeups/intents that would otherwise produce work
- write `company.paused` activity

### Resume

`POST /api/companies/:companyId/resume`

Behavior:

- validate board access and company access
- only allowed from `paused`
- set `status=active`
- clear `pauseReason`
- clear `pausedAt`
- do not automatically recreate cancelled work
- future work may be admitted normally after resume
- write `company.resumed` activity

### Archive

`POST /api/companies/:companyId/archive`

Behavior:

- validate board access and company access
- if already archived, return current company
- perform the same quiesce/cancel sweep as pause
- set `status=archived`
- preserve `pauseReason` as `manual` or set a dedicated archival reason only if
  we decide to extend pause reasons later
- set `pausedAt` if not already set
- write `company.archived` activity

### Delete

`POST /api/companies/:companyId/delete`

Request body:

- `confirmationText`

Behavior:

- validate board access and company access
- require company currently `paused` or `archived`
- require exact confirmation text match against company name
- re-check that there are no queued/running runs after the quiesce sweep
- perform permanent deletion
- write `company.deleted` activity before final row removal if practical, or
  write an instance-level audit event through a separate sink if company-scoped
  logging cannot survive the delete

Compatibility note:

- existing `DELETE /api/companies/:companyId` should either:
  - delegate internally to the same guarded delete implementation, or
  - be removed from normal client usage and treated as legacy/internal-only

## 7. Runtime Enforcement Plan

## 7.1 Centralize the “can this company run work?” decision

Add one shared server-side helper as the single source of truth, for example:

- `getCompanyExecutionBlock(companyId)`
- or `assertCompanyRunnable(companyId)`

This helper should block when:

- company status is `paused`
- company status is `archived`
- company no longer exists

It should return structured reason text so callers can surface consistent
errors, similar to current budget invocation blocks.

## 7.2 Call sites that must use the company execution gate

The company execution gate must be applied to all paths that admit or start
work, including at minimum:

- timer intent creation
- wakeup admission
- queued run claiming
- start-next-queued-run logic
- manual run endpoints
- issue assignment wakeups
- routine dispatch
- any scheduler path that promotes queued work into execution

The fix should prefer one shared helper rather than many slightly different
status checks.

## 7.3 Quiesce helper

Add a dedicated lifecycle helper, for example:

- `quiesceCompanyWork(companyId, reason)`

It should:

- cancel queued `heartbeat_runs`
- cancel running `heartbeat_runs` best-effort
- cancel queued/deferred `agent_wakeup_requests`
- reject or cancel queued/admitted `dispatch_intents`
- prevent promotion of deferred issue execution after the transition

This helper should be used by both `pause` and `archive`.

## 8. UI Plan

## 8.1 Company settings danger zone

Replace the current single archive action with three explicit lifecycle
controls in Company Settings:

- `Pause company` / `Resume company`
- `Archive company`
- `Delete company`

Recommended behavior:

- `Pause company` shown when status is `active`
- `Resume company` shown when status is `paused`
- `Archive company` shown when not archived
- `Delete company` always visually available in danger zone, but disabled unless
  company is `paused` or `archived`

## 8.2 Confirmation UX

### Pause

Simple confirmation dialog:

- explain that all current and future company work will stop
- mention that work can be resumed later

### Archive

Simple confirmation dialog:

- explain that the company will be hidden from default navigation
- explain that all current and future company work will stop
- explain that data stays in the database

### Delete

Strong confirmation dialog:

- summarize that deletion is permanent
- summarize what will be removed
- require typing the company name to confirm
- only enable submit when confirmation matches exactly

## 8.3 Company badges and filtering

- Paused companies remain visible in the UI and switchers, with a paused badge.
- Archived companies remain hidden from default switchers/sidebar lists.
- Archived companies should still be reachable through direct routes or a
  dedicated archived section if desired later.

## 9. Activity and Audit

Add or standardize activity actions:

- `company.paused`
- `company.resumed`
- `company.archived`
- `company.deleted`

Lifecycle activities should capture:

- actor
- prior status
- next status
- cancellation counts where useful
- delete confirmation metadata excluding sensitive text beyond what is needed

## 10. Data Model Notes

Current schema already supports most of this:

- `companies.status`
- `companies.pauseReason`
- `companies.pausedAt`

No new company lifecycle column is strictly required for the first pass.

Optional additions that are not required for this plan:

- `archivedAt`
- richer structured delete audit storage

Recommendation: do not add new lifecycle columns unless a clear UI/reporting
need appears during implementation.

## 11. Endpoint and Contract Changes

## 11.1 Shared validators/types

Sync required:

- company lifecycle request schemas for pause/resume/archive/delete
- delete confirmation payload schema
- client API wrappers for new lifecycle routes

## 11.2 Company update route

Recommendation:

- keep `PATCH /api/companies/:companyId` for metadata/settings edits
- stop treating raw `status` changes through generic patch as the preferred
  lifecycle mechanism

If we keep status patch support for backward compatibility, route-level logic
must still funnel through the same lifecycle services when the status changes.

## 12. Implementation Slices

## 12.1 Slice A: Runtime safety fix

Ship first:

- central company execution gate
- quiesce helper
- pause/archive both stop current and future work

This is the actual bug fix.

## 12.2 Slice B: Product lifecycle routes and UI

Then ship:

- pause/resume buttons
- archive button semantics update
- delete button and confirmation dialog

## 12.3 Slice C: Cleanup of legacy delete/status paths

Finally:

- route compatibility cleanup
- test hardening
- docs refresh

## 13. Testing Plan

Add or update tests for:

- pausing a company cancels queued runs
- pausing a company cancels running runs
- pausing a company blocks timer intent creation
- pausing a company blocks manual wakeups
- pausing a company blocks issue-assignment wakeups
- resuming a company allows future work again
- archiving a company performs the same shutdown behavior as pause
- archived companies never admit new work
- delete rejects while company is active
- delete succeeds from paused/archived with correct confirmation
- delete cannot leave live runs behind

UI tests:

- Company Settings shows pause/resume/archive/delete correctly by state
- delete confirmation requires typed company name
- archived companies remain filtered from switchers/sidebar
- paused companies remain visible

## 14. Verification

Before hand-off, verify at minimum:

```sh
pnpm -r typecheck
pnpm test:run
pnpm build
```

Behavioral manual checks:

1. Start a company with at least one active agent run.
2. Pause the company.
3. Confirm all live runs are cancelled and no new work appears.
4. Resume the company.
5. Confirm new work can be admitted again.
6. Archive the company.
7. Confirm it disappears from default navigation and stays non-runnable.
8. Delete a paused or archived test company through the UI confirmation flow.

## 15. File Areas Expected To Change During Implementation

- `server/src/routes/companies.ts`
- `server/src/services/companies.ts`
- `server/src/services/heartbeat.ts`
- `server/src/services/timer-intent-bridge.ts`
- `server/src/services/routines.ts`
- `server/src/services/issue-assignment-wakeup.ts`
- `server/src/services/intent-queue.ts` or scheduler admission layer
- `server/src/services/budgets.ts` or a new shared execution-block helper
- `ui/src/api/companies.ts`
- `ui/src/pages/CompanySettings.tsx`
- relevant tests in `server/src/__tests__` and `ui/src/pages/__tests__`

## 16. Fork Branding and Skills Follow-Up

Papierklammer still carries Paperclip-branded skills and runtime references, and
they do apply to this fork today.

Current examples in-repo:

- `skills/paperclip/SKILL.md`
- `skills/paperclip-create-agent/SKILL.md`
- `skills/paperclip-create-plugin/SKILL.md`
- `packages/adapter-utils/src/server-utils.ts` runtime skill discovery and
  `paperclip` naming helpers
- `server/src/onboarding-assets/ceo/AGENTS.md` references to
  `paperclip-create-agent`

This lifecycle project should explicitly include a fork-alignment review so the
company controls do not ship with stale Paperclip naming or instructions.

Required follow-up:

- decide which skills remain canonical in Papierklammer and which should be
  renamed
- update skill names, descriptions, examples, and API instructions where they
  still describe Paperclip instead of Papierklammer
- update runtime skill discovery / labeling so the product does not present
  “Paperclip” as the managed skill source in a Papierklammer fork unless that is
  intentionally preserved
- update onboarding assets and agent instructions that refer to Paperclip-only
  skill names
- document any backward-compatibility aliases if existing agents still depend on
  `paperclip` skill references

Recommended scope:

- treat this as a rename-and-compatibility pass, not just a string replace
- preserve compatibility for existing installed skills where practical
- prefer explicit alias handling over silent breakage for existing agent configs

## 17. Recommendation

Treat this as a lifecycle-control project, not just an archive bug fix.

If we only patch archive, we will still have:

- no explicit reversible pause control
- an unsafe product story for delete
- duplicated state logic across runtime paths

The right fix is:

1. define lifecycle semantics clearly
2. centralize company execution gating
3. make pause/archive both quiesce work
4. make delete explicit and safe
