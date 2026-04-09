# Papierklammer QA Audit — 2026-04-09

## Executive summary

- The audit used one primary QA company, `Papierklammer QA Bootstrap 2026-04-10 1706` (`companyId=379b3817-9e7c-4483-bff0-ab2e908de27c`), and kept browser, API, and TUI work sequential on the single mission-controlled app at `http://localhost:3100`.
- Core browser/API lifecycle flows passed: direct hire, approval-gated hire, blocked pre-approval delegation/invoke, approved-hire delegation, operator review surfaces, TUI launch, and TUI/API identifier reconciliation all produced traceable evidence.
- Four shipped product bugs were confirmed and preserved rather than fixed: the onboarding seeded-flow loop after company creation, the stale localStorage `/dashboard` misroute, TUI shortcut bleed while the issue composer is open, and the TUI `c` company-switch shortcut failing when input focus is active.
- No validation-contract assertion ended `blocked`; prerequisite bugs were captured with evidence and the audit continued through every remaining reachable surface.

## Environment posture and runtime constraints

- Runtime: local dev app on `http://localhost:3100`, `local_trusted/private`, embedded Postgres, one app instance only.
- Mission boundaries honored:
  - no DB reset
  - no Docker
  - no second app instance
  - browser/API/TUI work kept sequential
- Process-budget posture:
  - bootstrap evidence captured `21` node-related processes before QA work and `33` after starting the app
  - later mission init again warned about high ambient Node activity, reinforcing the sequential-only posture
- Evidence:
  - `/Users/aischool/.factory/missions/c506faaa-7d1c-4db2-be71-183035095277/evidence/bootstrap.md`
  - `/Users/aischool/.factory/missions/c506faaa-7d1c-4db2-be71-183035095277/evidence/raw/bootstrap-process-budget.txt`
  - `/Users/aischool/.factory/missions/c506faaa-7d1c-4db2-be71-183035095277/evidence/raw/bootstrap-health.json`

## Audit path taken

1. Started from the existing local runtime and captured `/api/health` plus starting company inventory.
2. Reached the live add-company path, triggered an invalid onboarding path first, then created the dedicated QA company.
3. Preserved the seeded-onboarding defect, then used the same QA company to create fallback bootstrap state (`CEO`, `PAP-1`) so downstream QA remained possible.
4. Reproduced the stale localStorage `/dashboard` misroute.
5. Audited lifecycle flows in the same QA company:
   - direct hire with approvals disabled
   - approval-gated hire with pending → approved transition
   - blocked pre-approval assign/invoke
   - approved-hire delegation and live run correlation
   - dashboard, approvals, inbox, issues, issue detail, agents, and agent detail review
6. Ran post-company TUI checks sequentially:
   - launch picker and QA company resolution
   - issue creation from the TUI with API reconciliation
   - company switching and polling behavior
   - focus/shortcut failure modes
7. Documented one explicit audit exception: for the TUI company-switch test, the flow temporarily switched into pre-existing `Bad Weather Corp` and then returned to the primary QA company; no second QA company was created.

Path note: every shorthand reference like `evidence/...` or `validation-state.json` below resolves under `/Users/aischool/.factory/missions/c506faaa-7d1c-4db2-be71-183035095277/`.

## Validation matrix

| Assertion | Status | Outcome | Evidence |
| --- | --- | --- | --- |
| `VAL-BOOT-001` | `pass` | Health, company inventory, and process-budget posture were captured before deeper QA. | `evidence/bootstrap.md`; `evidence/raw/bootstrap-health.json`; `evidence/raw/bootstrap-companies-before.json`; `evidence/raw/bootstrap-process-budget.txt` |
| `VAL-BOOT-002` | `pass` | Live add-company flow created the QA company; a usable company-scoped state was preserved despite the seeded-flow defect. | `evidence/bootstrap.md`; `evidence/raw/bootstrap-add-company-entry.png`; `evidence/raw/bootstrap-qa-company.json`; `evidence/raw/bootstrap-pap-dashboard-usable-state.png` |
| `VAL-BOOT-003` | `pass` | Stale-company routing anomaly was reproduced on unprefixed `/dashboard`; root `/` recovered correctly. | `evidence/bootstrap.md`; `evidence/raw/bootstrap-stale-company-dashboard-check.png`; `evidence/raw/bootstrap-stale-company-dashboard-body.txt`; `evidence/raw/bootstrap-stale-company-root-check.png` |
| `VAL-BOOT-004` | `pass` | Invalid onboarding path visibly blocked advancement and did not create unintended entities. | `evidence/bootstrap.md`; `evidence/raw/bootstrap-company-step-after-clear.png`; `evidence/raw/bootstrap-companies-before.json`; `evidence/raw/bootstrap-companies-after.json` |
| `VAL-LIFE-001` | `pass` | Direct hire completed immediately with approvals disabled and no approval artifact. | `evidence/lifecycle.md`; `evidence/raw/lifecycle-direct-hire-response.json`; `evidence/raw/lifecycle-approvals-after-direct-hire.json`; `evidence/raw/lifecycle-agents-after-direct-hire.png` |
| `VAL-LIFE-002` | `pass` | Approval-gated hire entered `pending_approval`, created a pending approval, then transitioned to approved. | `evidence/lifecycle.md`; `evidence/raw/lifecycle-approval-hire-response.json`; `evidence/raw/lifecycle-approvals-after-approval-request.json`; `evidence/raw/lifecycle-approval-after-approve.json` |
| `VAL-LIFE-003` | `pass` | Delegated work was correlated across browser and API, including assignee, issue, and run identifiers. | `evidence/lifecycle.md`; `evidence/raw/lifecycle-postapproval-issue-detail.json`; `evidence/raw/lifecycle-issue-live-runs.json`; `evidence/raw/lifecycle-heartbeat-run-final.json`; `evidence/raw/lifecycle-browser-network.txt` |
| `VAL-LIFE-004` | `pass` | Dashboard, approvals, inbox, issues, issue detail, agents, and agent detail were all explicitly reviewed. | `evidence/lifecycle.md`; `evidence/raw/lifecycle-dashboard.png`; `evidence/raw/lifecycle-approvals-list-all.png`; `evidence/raw/lifecycle-inbox-pending.png`; `evidence/raw/lifecycle-issues-list.png`; `evidence/raw/lifecycle-approved-agent-detail-running.png` |
| `VAL-LIFE-005` | `pass` | Pending hire could neither be assigned work nor invoked before approval; both returned `409`. | `evidence/lifecycle.md`; `evidence/raw/lifecycle-preapproval-assign-error.json`; `evidence/raw/lifecycle-preapproval-invoke-error.json`; `evidence/raw/lifecycle-pending-agent-detail.png`; `evidence/raw/lifecycle-browser-network.txt` |
| `VAL-LIFE-006` | `pass` | The same newly approved hire became usable, accepted real work, and completed the delegated issue. | `evidence/lifecycle.md`; `evidence/raw/lifecycle-postapproval-issue-assigned.json`; `evidence/raw/lifecycle-heartbeat-run-final.json`; `evidence/raw/lifecycle-issue-final.json` |
| `VAL-TUIAPI-001` | `pass` | TUI launch opened the company picker and resolved to the intended QA company. | `evidence/tui.md`; `evidence/raw/tui-launch-picker.txt`; `evidence/raw/tui-launch-picker.png`; `evidence/raw/tui-companies-before.json` |
| `VAL-TUIAPI-002` | `pass` | TUI management actions were reconciled to API truth, including the unintended invoke and created QA issue. | `evidence/tui.md`; `evidence/raw/tui-created-issue.txt`; `evidence/raw/tui-created-issue-detail.json`; `evidence/raw/tui-invoked-run-detail.json` |
| `VAL-TUIAPI-003` | `pass` | Shared QA identifiers remained consistent across browser/API/TUI evidence. | `evidence/tui.md`; `evidence/lifecycle.md`; `evidence/raw/tui-created-issue-detail.json`; `evidence/raw/tui-qa-heartbeat-runs-after-actions.json`; `evidence/raw/lifecycle-heartbeat-run-final.json` |
| `VAL-TUIAPI-004` | `pass` | Valid company switching cleared stale context and polling converged, while focus-specific shortcut defects were separately captured. | `evidence/tui.md`; `evidence/raw/tui-switcher-open.txt`; `evidence/raw/tui-bad-weather-after-switch.txt`; `evidence/raw/tui-bad-weather-after-poll.txt`; `evidence/raw/tui-returned-to-qa.txt` |
| `VAL-REPORT-001` | `pass` | This report exists at the required repository path and consolidates the audit artifacts. | `doc/2026-04-09-papierklammer-qa-audit.md` |
| `VAL-REPORT-002` | `pass` | Every reported finding below cites concrete screenshots, terminal captures, request/response snippets, or IDs. | `doc/2026-04-09-papierklammer-qa-audit.md#product-bugs`; `doc/2026-04-09-papierklammer-qa-audit.md#test-blockers--frictions` |
| `VAL-REPORT-003` | `pass` | This report includes a full validation matrix covering every `VAL-*` assertion. | `doc/2026-04-09-papierklammer-qa-audit.md#validation-matrix` |
| `VAL-REPORT-004` | `pass` | Product defects are separated from non-product blockers/frictions, and no unverified area is implied bug-free. | `doc/2026-04-09-papierklammer-qa-audit.md#product-bugs`; `doc/2026-04-09-papierklammer-qa-audit.md#test-blockers--frictions` |
| `VAL-REPORT-005` | `pass` | This report includes a concise executive summary for final handoff. | `doc/2026-04-09-papierklammer-qa-audit.md#executive-summary` |
| `VAL-REPORT-006` | `pass` | The final handoff note names this report and summarizes the key findings for chat delivery. | `/Users/aischool/.factory/missions/c506faaa-7d1c-4db2-be71-183035095277/final-handoff.md` |
| `VAL-CROSS-001` | `pass` | One primary QA company anchored bootstrap, lifecycle, and TUI evidence; the only cross-company exception was the documented switcher test into `Bad Weather Corp`. | `evidence/bootstrap.md`; `evidence/lifecycle.md`; `evidence/tui.md`; `doc/2026-04-09-papierklammer-qa-audit.md#audit-path-taken` |
| `VAL-CROSS-002` | `pass` | Sequential runtime discipline and single-app posture are documented, including the explicit cross-company switch exception. | `evidence/bootstrap.md`; `evidence/lifecycle.md`; `evidence/tui.md`; `doc/2026-04-09-papierklammer-qa-audit.md#environment-posture-and-runtime-constraints` |
| `VAL-CROSS-003` | `pass` | The identifier ledger below preserves company, agent, approval, issue, and run IDs with corroborating evidence. | `doc/2026-04-09-papierklammer-qa-audit.md#identifier-ledger` |
| `VAL-CROSS-004` | `pass` | No assertion ended `blocked`; prerequisite bugs were still tied to evidence and downstream reachable surfaces continued to be exercised. | `doc/2026-04-09-papierklammer-qa-audit.md#blocked-assertion-note`; `evidence/bootstrap.md`; `evidence/tui.md` |

## Identifier ledger

### Primary QA company and bootstrap anchors

| Entity | Identifier | Role in audit | Evidence |
| --- | --- | --- | --- |
| QA company | `379b3817-9e7c-4483-bff0-ab2e908de27c` (`PAP`) | Primary audit company across bootstrap, lifecycle, and TUI | `evidence/bootstrap.md`; `evidence/raw/bootstrap-qa-company.json`; `evidence/raw/tui-launch-picker.txt` |
| QA goal | `7818ce84-401f-40fd-aa5c-76dd58f49f78` | Company goal used to anchor created issues | `evidence/bootstrap.md`; `evidence/raw/bootstrap-qa-goals.json`; `evidence/raw/lifecycle-browser-network.txt` |
| Bootstrap fallback agent | `d508e34e-0b40-4b01-850d-b2f1d1bd6a9b` | Fallback CEO created after onboarding seeded-flow failed | `evidence/bootstrap.md`; `evidence/raw/bootstrap-qa-agents.json` |
| Bootstrap issue | `88757a82-2838-467f-86ea-ba5ac13242e6` (`PAP-1`) | Lifecycle delegation target used for the approved hire run | `evidence/bootstrap.md`; `evidence/lifecycle.md`; `evidence/raw/bootstrap-qa-issue-detail.json`; `evidence/raw/lifecycle-issue-final.json` |

### Lifecycle identifiers

| Entity | Identifier | Role in audit | Evidence |
| --- | --- | --- | --- |
| Direct-hire agent | `f046aeba-8e8e-472e-94ca-55ce383e00d8` | Direct hire with approvals disabled | `evidence/lifecycle.md`; `evidence/raw/lifecycle-direct-hire-response.json`; `evidence/raw/lifecycle-agents-after-direct-hire.json` |
| Approval-gated agent | `8bb087f2-eed7-4b7b-85f0-2869f0a159ae` | Pending → approved hire used for real delegation | `evidence/lifecycle.md`; `evidence/raw/lifecycle-approved-agent.json`; `evidence/raw/lifecycle-approved-agent-final.json` |
| Approval | `6335fed6-1f7f-424c-98ff-5af8b638bb48` | Hire approval resolved from pending to approved | `evidence/lifecycle.md`; `evidence/raw/lifecycle-approval-after-approve.json` |
| Assignment-triggered run | `76f4af3c-cfac-4fe1-afdd-0e42cb68a016` | Real post-approval run against `PAP-1` | `evidence/lifecycle.md`; `evidence/raw/lifecycle-heartbeat-run.json`; `evidence/raw/lifecycle-heartbeat-run-final.json` |
| Wakeup request | `45a900fd-bbd9-4a11-bcbc-7d54190cc3d4` | Wakeup request observed in the lifecycle run payload | `evidence/lifecycle.md`; `evidence/raw/lifecycle-heartbeat-run.json` |
| Active lease | `4ff5386a-3543-40e7-961f-7b46fc9b62df` | Lease captured during the running-state lifecycle check | `evidence/lifecycle.md`; `evidence/raw/lifecycle-heartbeat-run.json` |

### Browser-network rerun identifiers

| Entity | Identifier | Role in audit | Evidence |
| --- | --- | --- | --- |
| Network-rerun direct-hire agent | `401c3c12-e7de-411b-abdd-e06e992c8294` | Browser-originated direct-hire request trace | `evidence/raw/lifecycle-browser-network.txt` |
| Network-rerun approval-gated agent | `7b130b76-b2a8-4b86-9748-7371126c24fb` | Browser-originated pending/approved hire request trace | `evidence/raw/lifecycle-browser-network.txt` |
| Network-rerun approval | `653aaef2-08df-46cb-9206-569b902b2631` | Approval API trace for browser request capture | `evidence/raw/lifecycle-browser-network.txt` |
| Network-rerun issue | `256e0b8f-d537-40ad-a175-5201e43f90e4` (`PAP-3`) | Browser request trace for delegated issue path | `evidence/raw/lifecycle-browser-network.txt` |
| Network-rerun run | `9f395fea-72ac-4b9e-8d37-be114b078002` | Assignment-triggered run in the focused network rerun | `evidence/raw/lifecycle-browser-network.txt` |

### TUI identifiers

| Entity | Identifier | Role in audit | Evidence |
| --- | --- | --- | --- |
| TUI-created QA issue | `63812deb-c4b4-431c-96ed-3a6b90e11531` (`PAP-2`) | Real issue created from the TUI during composer audit | `evidence/tui.md`; `evidence/raw/tui-created-issue-detail.json`; `evidence/raw/tui-qa-issues-after-create.json` |
| TUI unintended invoke run | `c95ca771-2074-49e6-a496-731359ec000b` | Run triggered by composer shortcut bleed | `evidence/tui.md`; `evidence/raw/tui-invoked-run-detail.json`; `evidence/raw/tui-qa-heartbeat-runs-after-actions.json` |
| Switch-test company | `80fd2e4b-756e-4e54-92a0-8f55e3b65043` (`BAD`) | Pre-existing company used only for the explicit TUI switcher exception | `evidence/tui.md`; `evidence/raw/tui-bad-weather-after-switch.txt`; `evidence/raw/tui-bad-agents-baseline.json` |
| Input-focus side-effect issue | `51c1813d-f03e-4830-9e07-2be8572312f4` (`BAD-2`) | Accidental issue created when `c` was pressed with input focus | `evidence/tui.md`; `evidence/raw/tui-bad-created-issue-detail.json`; `evidence/raw/tui-bad-issues-after-chat.json` |

## Product bugs

### 1. Onboarding seeded-flow loops after company creation instead of finishing bootstrap

- **Affected surfaces:** web onboarding, bootstrap flow
- **Severity / reliability:** high / reproduced
- **Reproduction steps:**
  1. Open the live add-company flow from the existing board runtime.
  2. Complete the valid company creation path.
  3. Re-open `/<issuePrefix>/onboarding`.
  4. Select the recommended Codex option and attempt to continue bootstrap.
- **Observed behavior:** the company and goal are created, but the onboarding flow does not complete the expected seeded agent/task state and instead loops back to the company step.
- **Expected behavior:** after company creation, onboarding should advance to a stable seeded company state with the expected initial agent/task setup instead of returning to company naming.
- **Evidence references:**
  - `evidence/bootstrap.md`
  - `evidence/raw/bootstrap-pap-onboarding-route.png`
  - `evidence/raw/bootstrap-pap-agent-codex-selected.png`
  - `evidence/raw/bootstrap-pap-task-after-agent-create.png`
  - `/var/folders/9g/n5_xn26s65jb1hq4886h646w0000gp/T/droid-bg-1775754109097.out`
- **Linked identifiers:** `companyId=379b3817-9e7c-4483-bff0-ab2e908de27c`, `goalId=7818ce84-401f-40fd-aa5c-76dd58f49f78`

### 2. Stale localStorage company selection misroutes unprefixed `/dashboard`

- **Affected surfaces:** web routing, company selection persistence
- **Severity / reliability:** medium / reproduced
- **Reproduction steps:**
  1. Set `paperclip.selectedCompanyId` in browser localStorage to a nonexistent UUID.
  2. Navigate to `http://localhost:3100/dashboard`.
  3. Compare with navigation to `http://localhost:3100/`.
- **Observed behavior:** `/dashboard` rewrites to `/dashboard/dashboard` and renders `Company not found` for prefix `DASHBOARD`, while root `/` recovers correctly to the QA company dashboard.
- **Expected behavior:** stale company selection should be rejected and the app should recover to a valid company-scoped destination instead of generating a malformed path.
- **Evidence references:**
  - `evidence/bootstrap.md`
  - `evidence/raw/bootstrap-stale-company-dashboard-check.png`
  - `evidence/raw/bootstrap-stale-company-dashboard-body.txt`
  - `evidence/raw/bootstrap-stale-company-root-check.png`
- **Linked identifiers:** stale localStorage UUID `00000000-0000-0000-0000-000000000404`, recovered `companyId=379b3817-9e7c-4483-bff0-ab2e908de27c`

### 3. TUI issue composer leaks sidebar shortcuts while the overlay is open

- **Affected surfaces:** orchestrator TUI composer, TUI shortcuts, issue creation, heartbeat invoke
- **Severity / reliability:** high / reproduced
- **Reproduction steps:**
  1. Launch the TUI into the QA company.
  2. Open the issue composer with `n`.
  3. Type issue draft text while the composer overlay is open.
  4. Submit the draft.
- **Observed behavior:** while the composer overlay is open, sidebar shortcuts still fire; the typed draft triggers an unintended heartbeat invoke and corrupts the saved issue title/description.
- **Expected behavior:** the composer should exclusively own typed input until submission/cancel, and no background shortcut should mutate agent or issue state.
- **Evidence references:**
  - `evidence/tui.md`
  - `evidence/raw/tui-issue-composer.txt`
  - `evidence/raw/tui-created-issue.txt`
  - `evidence/raw/tui-created-issue-detail.json`
  - `evidence/raw/tui-invoked-run-detail.json`
- **Linked identifiers:** `issueId=63812deb-c4b4-431c-96ed-3a6b90e11531` (`PAP-2`), `runId=c95ca771-2074-49e6-a496-731359ec000b`, `agentId=8bb087f2-eed7-4b7b-85f0-2869f0a159ae`

### 4. TUI `c` company-switch shortcut fails when input focus is active and mutates the wrong company

- **Affected surfaces:** orchestrator TUI focus handling, company switching, chat input
- **Severity / reliability:** high / reproduced
- **Reproduction steps:**
  1. Switch the TUI into a non-QA company from sidebar focus.
  2. Leave focus in the input bar.
  3. Press `c`, expecting the company switcher to open.
- **Observed behavior:** instead of opening the switcher, the literal `c` is submitted as chat input and creates unintended company-scoped work in the currently selected company.
- **Expected behavior:** the visible company-switch shortcut should either work consistently regardless of focus or be suppressed while input focus is active without mutating state.
- **Evidence references:**
  - `evidence/tui.md`
  - `evidence/raw/tui-bad-weather-chat-finished.txt`
  - `evidence/raw/tui-bad-weather-chat-finished.png`
  - `evidence/raw/tui-bad-created-issue-detail.json`
  - `evidence/raw/tui-bad-issues-after-chat.json`
- **Linked identifiers:** `companyId=80fd2e4b-756e-4e54-92a0-8f55e3b65043` (`BAD`), `issueId=51c1813d-f03e-4830-9e07-2be8572312f4` (`BAD-2`)

## Test blockers / frictions

### No assertion-level blockers remained

- Every `VAL-*` assertion in the contract finished `pass`.
- The bootstrap and TUI defects above were real product bugs, but they did not stop the audit from reaching and evidencing the remaining reachable surfaces.
- Evidence:
  - `evidence/bootstrap.md`
  - `evidence/lifecycle.md`
  - `evidence/tui.md`
  - `validation-state.json` (reporting assertions were pending before this document was written)

### Audit exception: company-switch validation temporarily used a pre-existing non-QA company

- **Type:** audit friction / documented exception
- **Reason:** validating TUI company switching requires more than one company in the picker.
- **Observed behavior:** the audit temporarily switched from the primary QA company into pre-existing `Bad Weather Corp`, captured switch/poll behavior and the input-focus `c` defect there, then returned to the QA company.
- **Why this does not break the single-QA-company rule:** no second QA company was created; bootstrap, lifecycle, and the main TUI management action all remained anchored to the primary QA company.
- **Evidence references:**
  - `evidence/tui.md`
  - `evidence/raw/tui-switcher-open.txt`
  - `evidence/raw/tui-bad-weather-after-switch.txt`
  - `evidence/raw/tui-returned-to-qa.txt`

### Audit friction: lifecycle browser network capture required a focused evidence-only rerun

- **Type:** audit friction / evidence completeness
- **Reason:** the earlier lifecycle evidence had screenshots and API payloads, but the browser-network artifact still contained `No requests captured`.
- **Observed behavior:** a focused, same-company rerun was needed to preserve browser-originated requests for `VAL-LIFE-001`, `VAL-LIFE-002`, `VAL-LIFE-003`, and `VAL-LIFE-005`.
- **Result:** the rerun stayed QA-only, reused the same QA company, and produced `evidence/raw/lifecycle-browser-network.txt`.
- **Evidence references:**
  - `evidence/lifecycle.md#browser-network-evidence-rerun`
  - `evidence/raw/lifecycle-browser-network.txt`

## Blocked assertion note

No assertion is marked `blocked` in this audit. The onboarding and TUI bugs above were captured immediately, tied to evidence, and then the audit continued with all remaining reachable surfaces instead of treating them as untested or silently bug-free.

## Evidence index

- Bootstrap evidence note: `/Users/aischool/.factory/missions/c506faaa-7d1c-4db2-be71-183035095277/evidence/bootstrap.md`
- Lifecycle evidence note: `/Users/aischool/.factory/missions/c506faaa-7d1c-4db2-be71-183035095277/evidence/lifecycle.md`
- TUI evidence note: `/Users/aischool/.factory/missions/c506faaa-7d1c-4db2-be71-183035095277/evidence/tui.md`
- Raw evidence directory: `/Users/aischool/.factory/missions/c506faaa-7d1c-4db2-be71-183035095277/evidence/raw/`
- Final handoff note: `/Users/aischool/.factory/missions/c506faaa-7d1c-4db2-be71-183035095277/final-handoff.md`
