# Architecture — Papierklammer TUI + GUI

## TUI Architecture (packages/orchestrator-tui/)

### Component Tree
```
index.tsx (CLI entry, renders <App>)
└── ErrorBoundary
    └── App (shell: wires hooks together, routes to CompanyPicker or main layout)
        ├── CompanyPicker (shown when no companyId)
        └── MainLayout
            ├── HeaderBar (connection status, agent/run counts)
            ├── Box[row]
            │   ├── AgentSidebar (left 25%, polls API, scrollable agent list)
            │   └── ChatPanel
            │       └── MessageList (messages + streaming + command blocks)
            ├── InputBar (text input, disabled when thinking)
            ├── HelpOverlay (? key toggle, keyboard shortcuts)
            └── StatusBar (Codex state, threadId, model)
```

### Hook Architecture
- `useCodex`: Manages CodexClient lifecycle (create/destroy), exposes sendMessage, isThinking, streamingText, connectionState
- `useChat`: Message history, streaming text accumulation, command item tracking, onDelta/onTurnCompleted/onCommandExecution callbacks
- `useOrchestratorStatus`: Polls GET /api/orchestrator/status, exposes agents, connected, error state
- `useFocusManager`: Tab cycling between sidebar and input, tracks active panel

### Data Flow
1. User types → InputBar.onSubmit → App.handleSubmit → chat.sendMessage() + codex.sendMessage()
2. Codex subprocess receives turn/start → streams deltas → chat.onDelta() accumulates text
3. turn/completed → chat.onTurnCompleted() moves streaming text to message history
4. Background: useOrchestratorStatus polls API → updates sidebar without affecting chat

### Codex Client
- Spawns `codex app-server` as child process
- JSON-RPC over stdin/stdout (JSONL, no "jsonrpc" field)
- Request/response matching by incrementing IDs
- Callbacks for streaming events (delta, item started/completed, turn completed, command output)
- Auto-reconnect on crash (3s delay)

## GUI Architecture (ui/src/)

### Tech Stack
- React 19, Vite 6, Tailwind CSS v4, shadcn/ui (new-york style)
- TanStack React Query for data fetching
- react-router-dom 7 with company-prefix routing
- All colors defined as CSS custom properties in index.css

### Design System (papierklammer-design-system.md)
- Brutalist, TUI-aesthetic, monospace-only (JetBrains Mono)
- Pink/rose palette (#C4878E base)
- Zero border-radius globally
- 1px borders as primary spatial dividers
- No shadows, gradients, spinners, hover bg changes
- Status: 6x6 square indicators (not circles)
- Text hierarchy: white at 100%, 68%, 40% opacity

### Layout Structure
```
CompanyRail (72px, leftmost) | Sidebar (w-60) | Main Content
                                               ├── TopBar (34-36px, logo + tabs)
                                               ├── MetricsStrip (horizontal cells)
                                               ├── TierColumns (Executive | Leads | Workers)
                                               └── CommandBar (36-38px, bottom-docked)
```

### Dashboard Tier Columns
- Agents grouped by hierarchy level into horizontal columns
- Within columns: active first (by elapsed), then waiting, then idle
- Active agents expanded (header + meta + stream), idle collapsed (single line)
- Stream content color coded: reasoning=--fg-muted, tools=--warn, results=--fg-dim, errors=--dead

### API Surface (consumed by GUI)
- 24 API client modules in ui/src/api/ calling /api/* endpoints
- Key endpoints: companies, agents, issues, projects, heartbeats, dashboard, activity, orchestrator
- TanStack Query for caching and refetching
