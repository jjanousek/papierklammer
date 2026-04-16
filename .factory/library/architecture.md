# Architecture

## Mission focus

This mission is a focused redesign and polish pass for the orchestrator TUI in `packages/orchestrator-tui/`.

The work is centered on four operator-facing concerns:
- message composer and focus behavior
- live chat, tool-call, and reasoning visualization
- shortcut clarity and discoverability
- broad layout/panel polish under real terminal constraints

The zero-company launcher failure discovered during planning is explicitly out of scope. Validation uses a seeded local company instead.

## System surfaces

### 1. Launch and company selection
- `scripts/dev-tui-utils.mjs`, `scripts/dev-tui.mjs`, and `scripts/dev-with-tui.mjs` decide how the TUI resolves health, company selection, and child-process launch.
- The TUI can start in one of two broad modes:
  - directly inside a selected company session
  - in company-selection mode when launch cannot pick a company automatically
- Launch context must stay company-scoped. A selected company name/id must agree with the session the TUI actually renders.

### 2. Session shell and focus model
- `App.tsx` owns the top-level shell: header, management region, chat region, composer, and status bar.
- The session currently mixes multiple interaction concepts:
  - input focus
  - management-region focus
  - modal overlays
  - company switching, which temporarily swaps out the normal company session view
- A key current risk is split draft ownership: `App.tsx` mirrors draft state for shortcut gating while `InputBar.tsx` owns the visible draft. Workers should treat eliminating or making that split explicit as a first-class design concern.
- This mission should leave the keyboard ownership model explicit and predictable. Only one visible region should own interaction at a time.

### 3. Live management state
- The sidebar/issue desk are driven by polling hooks:
  - `useOrchestratorStatus`
  - `usePendingApprovals`
  - `useCompanyIssues`
- Those hooks provide the management truth for the currently selected company.
- Polling updates are allowed to refresh counts and panels while a chat turn is active, but they must not corrupt transcript state or company scoping.

### 4. Chat turn pipeline
- The bottom composer gathers operator input.
- `App.tsx` turns that input into company-scoped orchestrator instructions and sends it through Codex integration.
- The Codex client emits a stream of events covering assistant text, reasoning, tool activity, command output, and turn completion/failure.
- `useChat` holds the session transcript state and transient live-turn state.
- The rendered chat surface is a composition of:
  - transcript history
  - optional live reasoning
  - optional live tool activity
  - live streaming assistant output
- The concrete rendering files that matter most are:
  - `MessageList.tsx` for transcript windowing/scroll behavior
  - `ReasoningPanel.tsx` for live reasoning visibility
  - `CommandBlock.tsx` for tool-call presentation

### 5. Modal workflows
- Help, settings, issue composer, and company switching are modal interaction layers over the base session.
- These overlays must:
  - capture their own keys
  - block conflicting background mutations
  - restore the operator to a coherent prior context on dismiss
- The issue composer is special because it is both modal and mutating: success must feed back into the work queue and transcript.
- Company switching is also special because `CompanyPicker.tsx` plus `key={selectedCompanyId}` remounting in `App.tsx` effectively replaces the active company session tree when a switch is confirmed.

## Cross-surface invariants

### Company scope is the primary invariant
- Header label, polled management data, issue creation, turn instructions, and any session reset behavior must all point to the same selected company.
- Switching companies must clear stale transcript/thread context from the previous company.

### Focus and shortcuts must agree
- Visible focus state, live key routing, help text, and overlay hints must all describe the same interaction model.
- If a shortcut only works in a specific region or overlay, the UI must make that discoverable.

### Transcript truthfulness matters more than implementation simplicity
- The operator should be able to understand what happened from the terminal transcript alone.
- Reasoning, tool activity, streaming output, failures, and interruptions must appear in ways that do not mislead the operator about current state.

### The shell must survive stress
- Narrow widths, stacked layouts, long command output, long issue queues, temporary API failures, and Codex-process failures must not collapse the full-screen shell.
- Header, management panels, transcript, composer, and status should remain interpretable even under degraded conditions.

## High-risk areas for this mission

- split ownership of draft/focus state between top-level session logic and input components
- chat chronology when narration, reasoning, and multiple tool calls interleave
- hidden or conflicting shortcuts across sidebar, issue desk, chat, and overlays
- company switching because it replaces the active company session tree
- layout behavior when transcript/tool output grows taller than the visible viewport
- keeping background polls truthful without disrupting an in-flight turn

## Worker guidance

- Treat `validation-contract.md` as the definition of done for all operator-visible behavior.
- Prefer architectural fixes that make focus ownership, transcript ordering, and company scoping explicit instead of layering more special cases onto existing heuristics.
- When a change affects runtime interaction, verify it both with package tests and with a PTY-backed `tuistory` run.
- Keep launch/validation assumptions local-trusted and seeded-company only for this mission.
