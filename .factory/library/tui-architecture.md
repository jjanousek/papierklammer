# TUI Architecture

## Package: packages/orchestrator-tui/

Standalone Ink 6 TUI application for the Papierklammer orchestrator console.

## Component Tree

```
<App url={url} apiKey={apiKey}>
  <FullScreen>
    <Box flexDirection="column" height={rows}>
      <HeaderBar />                          {/* 2 rows: content + border */}
      <Box flexDirection="row" height={contentHeight}>
        <AgentSidebar width="25%" />         {/* Left panel */}
        {helpVisible ? <HelpOverlay /> : settingsVisible ? <SettingsOverlay /> : <ChatPanel />}
      </Box>
      <InputBar />                           {/* 2 rows: border + content */}
      <StatusBar />                          {/* 1 row */}
    </Box>
  </FullScreen>
</App>
```

## Key Hooks

- `useCodex()` — Manages Codex app-server subprocess lifecycle, JSON-RPC protocol, thread/turn state
- `useOrchestratorStatus(client, interval)` — Polls orchestrator status API
- `useChat()` — Chat message state, send/receive, history

## Codex Client (src/codex/)

- `CodexClient` class wrapping child_process.spawn + readline for JSONL parsing
- Methods: `initialize()`, `startThread(opts)`, `startTurn(threadId, input, overrides?)`, `interrupt(threadId, turnId)`
- Events: `onDelta(text)`, `onItemStarted(item)`, `onItemCompleted(item)`, `onTurnCompleted(turn)`
- Auto-reconnect on subprocess crash
- Protocol naming: JSON-RPC uses `serviceTier` for fast mode on `thread/start` and `turn/start`; config files use `service_tier`

## File Structure

```
packages/orchestrator-tui/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── src/
│   ├── index.tsx              # Entry point, CLI parsing, render()
│   ├── components/
│   │   ├── App.tsx            # Root layout
│   │   ├── HeaderBar.tsx      # Company + connection status
│   │   ├── AgentSidebar.tsx   # Agent list with status dots
│   │   ├── ChatPanel.tsx      # Message history + streaming
│   │   ├── MessageList.tsx    # Scrollable message list
│   │   ├── InputBar.tsx       # Text input
│   │   ├── StatusBar.tsx      # Codex state + thread info
│   │   ├── HelpOverlay.tsx    # Keyboard shortcuts overlay
│   │   ├── SettingsOverlay.tsx # Model/reasoning/fast-mode overlay
│   │   └── CommandBlock.tsx   # Rendered command execution
│   ├── hooks/
│   │   ├── useCodex.ts        # Codex subprocess management
│   │   ├── useChat.ts         # Chat state management
│   │   └── useStatus.ts       # API polling
│   ├── codex/
│   │   ├── client.ts          # CodexClient class
│   │   └── types.ts           # JSON-RPC message types
│   └── __tests__/
│       ├── layout.test.tsx
│       ├── sidebar.test.tsx
│       ├── chat.test.tsx
│       ├── codex-client.test.ts
│       └── integration.test.tsx
```
