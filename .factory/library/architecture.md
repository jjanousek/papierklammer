# Architecture

## What this mission changes
- Turns company lifecycle state into an operational control plane, not a cosmetic flag.
- Adds coordinated lifecycle transitions for `pause`, `resume`, `archive`, and guarded `delete`.
- Extends onboarding so agent selection drives the rest of the flow, including curated Codex choices and AI-assisted drafting.
- Aligns fork branding so operator-facing and agent-facing text present Papierklammer while preserving explicit compatibility tokens where required.
- Hardens issue-detail identifier handling and cleanup/concurrency behavior so runtime state stays reviewable and consistent.

## Runtime surfaces

### Web UI
- The React board is the operator surface for onboarding, Company Settings, company navigation, issue detail, and skill/invite flows.
- Lifecycle controls live here as deliberate actions with confirmation, not as free-form status edits.
- The UI must keep company selection, archived filtering, paused visibility, and issue-detail routing aligned with backend truth.

### API
- The Express API is the source of truth for company lifecycle transitions, work admission, issue/run state, invite/onboarding text, and skill metadata.
- Company lifecycle behavior is coordinated at this layer: authorization, quiesce, audit logging, and admission blocking must all agree.
- The API also exposes the identifier contracts the UI depends on, especially for issue detail and compatibility skill surfaces.

### Agent/runtime surfaces
- Local agent execution and onboarding-generated instructions are part of the product surface for this mission.
- Real Codex-backed behavior is required for onboarding AI assistance when Codex is selected and available.
- Compatibility skill endpoints may stay stable, but any human-facing instructions emitted by the runtime must reflect fork-native branding and commands.

### Local validation harness
- Validation uses isolated local instances on ports `3100` and `3101` with embedded Postgres and one active validation bundle at a time.
- Browser and API validation are primary; TUI validation is only used when a feature truly touches orchestration/TUI-adjacent behavior.

## Core control flows

### Company lifecycle flow
1. The operator initiates a lifecycle action from a dedicated surface.
2. The backend authorizes the actor, resolves the company, and routes the request through coordinated lifecycle logic rather than a generic update path.
3. `pause` and `archive` quiesce current work, suppress future admission, and record an audit trail.
4. `resume` restores future admission without replaying canceled work.
5. `delete` requires prior quiesce plus explicit confirmation, then permanently removes the company through the guarded path only.

### Work admission flow
1. Work can be proposed from multiple entrypoints: manual wakeups, timer/routine scheduling, issue-side mutations, orchestrator actions, and direct assignment wakeups.
2. Every admission path must pass through a shared company-runnable decision.
3. If the company is paused, archived, or missing, new execution is blocked consistently regardless of entrypoint.
4. If work is admitted, issue ownership, execution leases, and run identity must remain coherent across operator-visible surfaces.

### Onboarding flow
1. On a fresh instance, the operator picks the agent/provider first.
2. That choice determines what models and AI drafting capabilities are available in later onboarding steps.
3. Company and first-task drafts are generated through the selected real provider path when available, then remain editable.
4. If Codex is selected, Codex-backed drafting must use the real Codex path or fail/disable visibly; it must not silently fall back to another provider.
5. Completing onboarding creates the company, agent, initial work, and first wakeup in one coherent sequence, lands the operator on the created issue, and provides the bootstrap instruction context required for the first run to start cleanly.

### Branding and compatibility flow
1. Operators and agents may still encounter stable compatibility tokens such as `paperclip` skill IDs or legacy endpoint names.
2. Those compatibility tokens are protocol/runtime concerns, not the primary product brand.
3. Stable compatibility surfaces that must be preserved intentionally include `/api/skills/paperclip`, `paperclip-create-agent`, and runtime skill canonicalization paths that map compatibility requests into fork-owned namespaces.
4. Human-facing UI, generated docs, onboarding text, and runtime instructions should present Papierklammer unless a literal compatibility token must be shown.

### Issue-detail review flow
1. Operators deep-link into issues by public issue key as often as by UUID-backed internal references.
2. The backend must resolve identifiers consistently for every issue-detail subroute, not just the primary issue fetch.
3. Issue detail, live-run views, company run feeds, and orchestrator status must converge on the same ownership and cleanup state after lifecycle actions or recovery actions.

## State and invariants
- Company lifecycle state is a runtime gate: `paused` and `archived` are non-runnable states.
- Lifecycle mutations are board-only and company-scoped; agent actors and wrong-company callers must be rejected.
- No API or UI entrypoint may bypass coordinated lifecycle side effects through generic update or legacy destructive paths.
- Company-scoped actions stay company-scoped; no lifecycle or issue-detail action may leak across company boundaries.
- Quiesce clears both active work and its visible ownership residue; a company is not truly quiesced if stale issue/run ownership remains.
- Direct assignment wakeups must establish durable execution ownership; the first run after onboarding cannot collapse into orphan cleanup.
- Onboarding-generated text is operator-editable; submitted values must reflect the final visible edits, not hidden draft state.
- Compatibility identifiers may remain stable, but operator-facing branding should be Papierklammer-first.

## Known risk concentrations
- Legacy lifecycle bypasses in generic company update or delete paths.
- Missing admission checks in one-off wakeup producers outside the main scheduler path.
- Lock ordering between quiesce, cleanup, lease release, reconciler work, and stale-run teardown.
- Onboarding flow dependencies between provider/model readiness and AI-assisted drafting.
- Branding drift between UI copy, server-generated text, seeded onboarding assets, and compatibility skill endpoints.
- Public-issue-key handling drift across issue-detail subroutes when identifier resolution is duplicated instead of shared.
- Secondary issue-detail endpoints that must remain aligned include activity, runs, live-runs, active-run, approvals, attachments, work-products, and comments when the page consumes them.

## Worker guidance
- Inspect these touchpoints first for this mission: `server/src/routes/companies.ts`, `server/src/services/companies.ts`, `server/src/services/heartbeat.ts`, `server/src/services/reconciler.ts`, `server/src/routes/issues.ts`, `ui/src/pages/CompanySettings.tsx`, `ui/src/components/OnboardingWizard.tsx`, `ui/src/pages/IssueDetail.tsx`, `packages/adapter-utils/src/server-utils.ts`, and `server/src/routes/access.ts`.
- Treat lifecycle coordination as a cross-cutting backend invariant first, then expose it in the UI.
- When changing admission behavior, inspect all known work producers; do not assume the scheduler path is the only entrypoint.
- When changing onboarding, preserve the end-to-end sequence from agent selection to first wakeup and re-check the first run after a short settle window.
- When changing branding, separate compatibility tokens from human-facing labels and instructions.
- When changing issue-detail behavior, verify all secondary subroutes that the page uses, not just the primary issue fetch.
- Prefer shared resolvers/helpers over duplicated identifier or lifecycle logic.
