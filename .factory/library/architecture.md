# Architecture

## Mission focus

This mission hardens the **entire onboarding journey** for the Papierklammer web application:

- first-run entry and route recovery
- bootstrap/auth gating
- new-company onboarding
- existing-company add-agent onboarding
- invite/join onboarding
- import as an onboarding-adjacent bootstrap path

The mission may redesign UI and copy where it improves comprehension, but it should preserve the product decision that **Agent comes first** unless a feature explicitly proves a better sequence.

## Primary user-facing surfaces

### 1. Entry and route recovery
- `ui/src/App.tsx` decides whether the operator sees a bootstrap gate, auth gate, first-run entry page, or company-scoped board surface.
- `ui/src/lib/onboarding-route.ts` determines whether the current route should open onboarding and whether it is global first-run onboarding or company-prefixed add-agent onboarding.
- Empty-state entry matters as much as explicit `/onboarding`; users arrive through `/`, direct deep links, stale remembered routes, and company-prefixed URLs.

### 2. Onboarding shell and dialog state
- The visible onboarding experience is split between route-level entry surfaces and the globally mounted `OnboardingWizard`.
- The mission must treat “one perceivable onboarding shell at a time” as a product invariant, even if the implementation still uses route state plus dialog state internally.
- Close/reopen, refresh, and browser history must keep route state, company context, and wizard state aligned.

### 3. New-company onboarding mutations
- The intended new-company flow is `Agent -> Company -> Task -> Launch`.
- Mutation boundary today is not fully deferred to Launch:
  - the Company step creates the company, optional goal, and CEO agent
  - Launch creates the onboarding project, starter issue, and wakeup/run side effect
- Validation and implementation must therefore distinguish:
  - pre-mutation steps
  - post-company-mutation but pre-launch states
  - post-launch states
- Exactly-once behavior across retries, refreshes, and failures is a central correctness risk.

### 4. Existing-company add-agent onboarding
- `/:companyPrefix/onboarding` is not first-run bootstrap; it is a company-scoped augmentation flow.
- The intended flow is `Agent -> Task -> Launch` with no Company step.
- The critical invariants are:
  - company scope comes from the route and never silently drifts
  - the flow never regresses into first-company/bootstrap messaging
  - approval-gated hiring is visible and truthful

### 5. Invite and join lifecycle
- Company-side invite generation begins in settings surfaces.
- Joiners land on `/invite/:token` and choose a human or agent path depending on invite configuration.
- Operators finish the flow through Inbox approval/rejection.
- Human joins end in company access; agent joins end in approval-gated API-key claim.
- Invite generation, landing copy, pending approval, and claim are one user journey even though they span UI and API surfaces.
- Mutation stages must stay distinct:
  - invite generation creates a shareable artifact
  - join submission creates a pending request, not access
  - approval resolves that request
  - only then can human access or agent claim succeed

### 6. Import as onboarding-adjacent bootstrap
- Import must either work as a true first-run alternative or be clearly presented as a separate onboarding-adjacent bootstrap path.
- The import lifecycle is:
  - pick source
  - pick target
  - preview
  - resolve conflicts/select content
  - apply
  - switch to imported company context
- Preview fidelity matters: apply must honor selected files, rename/skip choices, and adapter overrides exactly once.
- Source selection, target selection, preview, and conflict-resolution are non-mutating. `Apply` is the mutation boundary.

## Cross-surface invariants

### Company context is canonical
- Unprefixed routes, prefixed routes, remembered selection, and visible company cues must all point to the same intended company.
- Invalid or stale company context must recover safely, not silently target another company.

### One onboarding shell at a time
- Users may enter through route pages or in-app CTAs, but they should only perceive one onboarding experience at once.
- Background content must never compete visually with the active onboarding workflow.

### Bootstrap/auth gates take precedence
- Bootstrap/auth gates outrank onboarding and board content.
- Blocking states must stay singular and must not leak onboarding chrome or partial board surfaces behind them.

### Agent-first must be understandable
- The UI may keep Agent first, but it must explain why the order exists.
- Disabled controls must point to visible prerequisites rather than contradicting the current step order.

### Mutation boundaries must be explicit and idempotent
- New-company onboarding creates company-level entities before Launch.
- Add-agent onboarding creates the new agent before Launch.
- Retry/failure/close/reopen behaviors must therefore prove both:
  - zero mutation when blocked before the mutation boundary
  - no duplication after the mutation boundary

### Operator-vs-joiner responsibility must stay legible
- Invite flows must always make it obvious which steps belong to the operator, which belong to the joiner, and when approval is still pending.

## High-risk areas for this mission

- route-level onboarding entry plus modal wizard overlap
- stale dialog state versus route-derived company scope
- documented seeded-flow loop after company creation
- stale remembered company selection after onboarding changes context
- duplicate mutations from retry/double-submit during company creation or launch
- add-agent flows inheriting first-company/CEO bootstrap copy
- approval-gated hiring or invite claim states presenting false success
- import preview/apply mismatch after source/target changes

## Worker guidance

- Prioritize broken flow recovery and correctness before UX polish or moderate redesign.
- Prefer fixes that make route state, company scope, and onboarding shell ownership more explicit rather than layering more special cases onto stale state.
- Preserve agent-first order unless the assigned feature explicitly authorizes a change and proves the new sequence is clearer.
- Validate every user-visible change with `agent-browser` screenshots.
- When a feature claims failure-path assertions, collect before/after API evidence proving zero mutation or exactly-once mutation.
- Mission constraints still apply while implementing architecture fixes: no Docker, reuse the local `3100` surface, and never keep more than 3 mission-started Node processes alive at once.
- Do not broaden the mission into unrelated board or TUI work.
