# Architecture

## Mission focus

This mission does not build new product behavior. It audits the shipped Papierklammer control plane by driving a real operator journey and preserving evidence for a detailed bug report.

The audit follows one dedicated QA company through:
- company creation or company-add flow
- agent hiring
- approval-gated hiring
- issue delegation
- post-company TUI checks
- final bug-report generation

## Runtime surfaces

### Local dev app
- The default local dev app runs on `http://localhost:3100`.
- The Express server serves the API and the web board together in local development.
- Workers should treat this single app instance as the only mission-controlled runtime process unless the orchestrator explicitly changes the plan.
- The approved mission entrypoint is the default dev flow from `.factory/services.yaml` (`PORT=3100 pnpm dev:once`); do not default to `pnpm papierklammer run` in this environment.

### Web UI
- The browser surface is the main operator path for this audit.
- The operator creates or selects the QA company, hires agents, toggles company settings, reviews approvals, triages issues, and inspects issue detail here.
- Browser evidence is the main source for user-visible bugs.

### API
- The API under `/api` is the source of truth for entity identity and state during the audit.
- `companyId`, `agentId`, `approvalId`, `issueId`, issue keys, and any `runId` values should be anchored here and then correlated back to browser and TUI evidence.
- API evidence is used to prove whether an observed UI/TUI problem is a rendering/navigation issue or a real state inconsistency.

### Orchestrator TUI
- The TUI is a post-company surface only.
- It attaches to the existing local app and is used for company selection, status polling, issue desk review, approvals, and management shortcuts such as wake/invoke/unblock or issue creation.
- TUI checks should happen only after the QA company already exists in the local app.

### Audit artifacts
- Mission evidence may live in the mission directory while the final bug report must live in the repository.
- The audit must preserve an identifier ledger and a short handoff note so the final chat summary can point to the markdown report without recomputing findings.
- Required paths for this mission:
  - `/Users/aischool/.factory/missions/c506faaa-7d1c-4db2-be71-183035095277/evidence/bootstrap.md`
  - `/Users/aischool/.factory/missions/c506faaa-7d1c-4db2-be71-183035095277/evidence/lifecycle.md`
  - `/Users/aischool/.factory/missions/c506faaa-7d1c-4db2-be71-183035095277/evidence/tui.md`
  - `/Users/aischool/.factory/missions/c506faaa-7d1c-4db2-be71-183035095277/evidence/raw/`
  - `/Users/aischool/.factory/missions/c506faaa-7d1c-4db2-be71-183035095277/final-handoff.md`
  - `/Users/aischool/work/papierklammer_droid/doc/2026-04-09-papierklammer-qa-audit.md`

## Core audit flows

### Bootstrap flow
1. Start the local dev app on port `3100`.
2. Capture `/api/health` and the starting company inventory.
3. Reach the real company-creation path available in the current state.
4. Establish a usable QA company context or document the blocker with evidence.

### Hire and approval flow
1. In the QA company, exercise one direct-hire path with approvals disabled.
2. Enable board approval for new hires.
3. Exercise one approval-gated hire.
4. Record the pending state, resolve the approval once, and verify whether the approved hire becomes usable for real work.

### Delegation flow
1. Create or update a runnable issue in the QA company.
2. Assign or reassign it to the audited agent.
3. Correlate the same issue and assignee state across browser and API evidence.
4. Record wake/run behavior or the blocker that prevented it.

### TUI reconciliation flow
1. Launch the TUI after the QA company exists.
2. Confirm the TUI opens the intended company or records why it could not.
3. Perform one real management action.
4. Reconcile that action against API or browser truth.

### Reporting flow
1. Consolidate evidence into a repository markdown bug report.
2. Include a validation matrix and identifier ledger.
3. Separate confirmed product bugs from test blockers/frictions.
4. Prepare a short handoff note for the final chat response.

## Invariants for this mission
- The mission is QA-only. Workers should not fix product bugs as part of normal execution.
- One app instance at a time is the default. Avoid overlapping Node-heavy helpers.
- The QA should use one clearly named QA company whenever possible.
- Once bootstrap creates the dedicated QA company for this mission, later features should reuse that same company unless a blocker forces an exception.
- Existing user data must be preserved; do not reset the default instance or delete pre-existing companies unless the user explicitly approves it.
- Downstream assertions may be marked `blocked` only when the prerequisite failure is evidenced and tied back to the earlier blocker.

## Risk concentrations
- Root routing may reuse stale company selection and trigger dashboard/company mismatches.
- Hire approval state may drift from assignment pickers or run controls.
- Issue identity may differ across issue detail, live runs, approvals, and TUI summaries.
- The TUI may retain stale company context when switching or recovering from launch-state issues.
- Because this mission runs against the default local dev setup, pre-existing data can hide or distort first-run assumptions if the audit does not record starting inventory carefully.

## Worker guidance
- Read the mission contract before auditing a surface.
- Prefer black-box evidence over implementation speculation.
- Capture IDs early and reuse them throughout the audit.
- Keep notes about runtime/process posture as you go; do not reconstruct them from memory during reporting.
- If a product bug blocks the next planned flow, capture it immediately, mark downstream work as blocked where appropriate, and continue with any still-reachable surfaces.
