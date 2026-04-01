# Codex App-Server Protocol Reference

Copied from research for worker reference. See full doc at:
/Users/aischool/work/papierklammer_droid/doc/plans/2026-04-01-codex-app-server-protocol.md

## Quick Reference

### Spawn
```typescript
const proc = spawn("codex", ["app-server"], {
  stdio: ["pipe", "pipe", "inherit"]
});
```

### Message format (no "jsonrpc" field on wire)
```
→ { "method": "initialize", "id": 0, "params": { "clientInfo": { "name": "papierklammer-tui", "version": "1.0.0" }, "capabilities": {} } }
← { "id": 0, "result": { "userAgent": "codex/0.117.0", ... } }
→ { "method": "initialized" }
```

### Thread lifecycle
```
→ thread/start { model, cwd, approvalPolicy, sandbox, baseInstructions }
← response { thread: { id } }
→ turn/start { threadId, input: [{ type: "text", text: "..." }] }
← notifications: item/agentMessage/delta, item/started, item/completed, turn/completed
```

### Key streaming notifications
- `item/agentMessage/delta` — { delta: "text chunk" }
- `item/started` — { item: { type, id } }
- `item/completed` — { item: { type, id, text?, ... } }
- `turn/completed` — { turn: { id, status, items, error } }
- `item/commandExecution/outputDelta` — { delta: "output chunk" }

### Interrupt
```
→ turn/interrupt { threadId, turnId }
```
