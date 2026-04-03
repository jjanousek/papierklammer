# Architecture

## TUI (packages/orchestrator-tui/)

React Ink terminal application. Entry: `src/index.tsx` → `src/components/App.tsx`.

### Component Tree
```
App (shell, alternate screen buffer, Ctrl+C handling)
├── CompanyPicker (if no company selected)
├── HeaderBar (top bar: title, connection status, agent/run counts)
├── AgentSidebar (25% width, agent list with status indicators)
├── ChatPanel → MessageList (messages, streaming, thinking)
├── InputBar (text input, disabled during thinking)
├── StatusBar (Codex state, thread ID, model, reasoning effort, fast mode)
├── HelpOverlay (keyboard shortcuts, toggled with ?)
└── SettingsOverlay (current model/reasoning/fast mode, toggled with s)
```

### Hooks
- `useCodex` — wraps CodexClient lifecycle, manages connection/thinking state
- `useChat` — message history, streaming text, command items, callbacks
- `useOrchestratorStatus` — polls GET /api/orchestrator/status for agent data
- `useFocusManager` — Tab cycling between sidebar/input

### Codex Integration
- `codex/client.ts` — spawns `codex app-server`, JSON-RPC over stdio JSONL
- `codex/types.ts` — TypeScript types for JSON-RPC protocol
- `codex/base-instructions.ts` — system prompt describing orchestrator API operations
- Protocol naming detail: JSON-RPC thread/turn params use `serviceTier` (camelCase), while Codex config uses `service_tier` (snake_case)

### Known Issues Being Fixed
- No explicit terminal dimension management (causes layout breaks)
- Stale threadId closure in useCodex sendMessage callback
- Static thinking indicator (ink-spinner installed but unused)
- No message windowing (scroll doesn't work)

## GUI (ui/)

React + Vite SPA. Entry: `ui/src/main.tsx` → `ui/src/App.tsx`.

### Stack
- React 19, Vite, TypeScript
- Tailwind CSS v4 with shadcn/ui primitives
- TanStack Query for data fetching
- Custom router (ui/src/lib/router.ts)

### Design System
- JetBrains Mono monospace only
- Pink/rose palette via CSS custom properties (14 variables)
- No border-radius (enforced globally via `* { border-radius: 0 !important }`)
- No shadows, no gradients
- 6x6 square status indicators

### Component Architecture
- Custom Dashboard components: TopBar, MetricsStrip, TierColumn, AgentBlock, CommandBar
- shadcn/ui primitives restyled: button, input, badge, tabs, dialog, dropdown, select, card
- Layout: Sidebar + CompanyRail + BreadcrumbBar + content area + CommandBar

### Theme System (being added)
- CSS custom properties scoped to `[data-theme="..."]` blocks
- 3 themes: papierklammer (rose), violet-indigo, earth
- Switching via `document.documentElement.setAttribute('data-theme', name)`
- Persisted to localStorage

### Pages
- Core (fully styled): Dashboard, Agents, Issues, AgentDetail, IssueDetail
- Remaining (~28 pages): Use shadcn components with CSS variable bridging but have hardcoded Tailwind colors that bypass the design system
