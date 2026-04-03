# User Testing

## Validation Surface

### GUI Surface
- Tool: agent-browser
- URL: http://localhost:3100
- Service: `PORT=3100 pnpm dev:once` (background)
- Health check: `curl -sf http://localhost:3100/api/health`
- Capabilities: Screenshot, DOM inspection, computed styles, click navigation, form interaction
- Default company: "Weather Corp" (auto-seeded by PGlite dev mode)

### TUI Surface
- Tool: vitest (unit/integration tests only)
- The TUI renders via React Ink to a terminal — agent-browser cannot interact with it
- All TUI validation is done through Vitest tests with ink-testing-library
- Test command: `pnpm exec vitest run packages/orchestrator-tui/ --max-workers=3`

## Validation Concurrency

### GUI (agent-browser)
- Max concurrent validators: 3
- Rationale: 16GB RAM, ~6GB baseline usage. Dev server ~200MB, each agent-browser ~300MB. 3 validators = 900MB + 200MB = 1.1GB. Budget: (16-6)*0.7 = 7GB. Well within budget.

### TUI (vitest)
- Max concurrent validators: 1 (tests run as single vitest process)
- Rationale: Vitest manages its own parallelism internally

## Known Limitations
- No live agent data in dev environment (agents are seeded but not actively running)
- Dashboard stream content requires live WebSocket transcript data from running agents
- Some assertions about stream content may need fixture seeding via API calls
