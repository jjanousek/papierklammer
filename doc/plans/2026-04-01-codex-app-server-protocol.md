# Codex App-Server Protocol Specification

> Research output — everything needed to implement a client from scratch.
> Based on codex-cli v0.117.0, official docs, and generated TypeScript schema.

## 1. Overview

`codex app-server` is a **bidirectional JSON-RPC 2.0** server that exposes the Codex agent harness to external clients. It is implemented in Rust and ships as part of the `@openai/codex` npm package. The `"jsonrpc":"2.0"` header is **omitted** on the wire.

## 2. Spawning the Server

```bash
# Default: stdio transport (JSONL over stdin/stdout, one message per line)
codex app-server

# WebSocket transport (experimental)
codex app-server --listen ws://127.0.0.1:4500

# With config overrides
codex app-server -c model="o3" -c 'sandbox_permissions=["disk-full-read-access"]'
```

### Spawn from Node.js
```typescript
import { spawn } from "node:child_process";
import readline from "node:readline";

const proc = spawn("codex", ["app-server"], {
  stdio: ["pipe", "pipe", "inherit"],  // stdin=pipe, stdout=pipe, stderr=inherit
});
const rl = readline.createInterface({ input: proc.stdout });

const send = (msg: unknown) => {
  proc.stdin.write(`${JSON.stringify(msg)}\n`);
};

rl.on("line", (line) => {
  const msg = JSON.parse(line);
  // Handle responses and notifications
});
```

### Environment Variables
- `OPENAI_API_KEY` — API key for OpenAI models (or use the auth RPC methods)
- `RUST_LOG` — log filtering/verbosity (e.g. `error`, `info`, `debug`)
- `LOG_FORMAT=json` — emit structured JSON logs to stderr

### Graceful Shutdown
- **stdio**: server exits when stdin closes
- **WebSocket**: Ctrl+C → stops accepting connections → waits for turns → disconnects → exits

## 3. Message Format

### Request (client → server)
```json
{ "method": "thread/start", "id": 10, "params": { "model": "gpt-5.4" } }
```

### Response (server → client, echoes `id`)
```json
{ "id": 10, "result": { "thread": { "id": "thr_123" } } }
```
```json
{ "id": 10, "error": { "code": 123, "message": "Something went wrong" } }
```

### Notification (server → client, no `id`)
```json
{ "method": "turn/started", "params": { "turn": { "id": "turn_456" } } }
```

### Client Notification (client → server, no `id`)
```json
{ "method": "initialized" }
```

## 4. Connection Lifecycle

### Step 1: Initialize (mandatory, once per connection)
```json
→ { "method": "initialize", "id": 0, "params": {
    "clientInfo": {
      "name": "paperclip",
      "title": "Paperclip Control Plane",
      "version": "1.0.0"
    },
    "capabilities": {
      "experimentalApi": true,
      "optOutNotificationMethods": []
    }
  }
}
← { "id": 0, "result": {
    "userAgent": "codex/0.117.0",
    "codexHome": "/Users/me/.codex",
    "platformFamily": "unix",
    "platformOs": "macos"
  }
}
→ { "method": "initialized" }
```

Any request before `initialize` → `"Not initialized"` error.
Second `initialize` → `"Already initialized"` error.

### Step 2: Authenticate (if needed)
```json
→ { "method": "account/read", "id": 1, "params": { "refreshToken": false } }
← { "id": 1, "result": { "account": null, "requiresOpenaiAuth": true } }

→ { "method": "account/login/start", "id": 2, "params": { "type": "apiKey", "apiKey": "sk-..." } }
← { "id": 2, "result": { "type": "apiKey" } }
← { "method": "account/login/completed", "params": { "loginId": null, "success": true, "error": null } }
← { "method": "account/updated", "params": { "authMode": "apikey" } }
```

### Step 3: Start a Thread
```json
→ { "method": "thread/start", "id": 10, "params": {
    "model": "gpt-5.4",
    "cwd": "/path/to/project",
    "approvalPolicy": "never",
    "sandbox": "workspaceWrite",
    "personality": "friendly"
  }
}
← { "id": 10, "result": { "thread": { "id": "thr_123", "preview": "", "ephemeral": false, "modelProvider": "openai", "createdAt": 1730910000 } } }
← { "method": "thread/started", "params": { "thread": { "id": "thr_123", ... } } }
```

### Step 4: Start a Turn (send user input)
```json
→ { "method": "turn/start", "id": 30, "params": {
    "threadId": "thr_123",
    "input": [{ "type": "text", "text": "Summarize this repo." }]
  }
}
← { "id": 30, "result": { "turn": { "id": "turn_456", "status": "inProgress", "items": [], "error": null } } }
```

### Step 5: Stream Events (keep reading)
```
← { "method": "turn/started", "params": { "turn": { "id": "turn_456" } } }
← { "method": "item/started", "params": { "item": { "type": "agentMessage", "id": "item_1", "text": "", "phase": null }, "threadId": "thr_123", "turnId": "turn_456" } }
← { "method": "item/agentMessage/delta", "params": { "threadId": "thr_123", "turnId": "turn_456", "itemId": "item_1", "delta": "Here's a summary..." } }
← { "method": "item/completed", "params": { "item": { "type": "agentMessage", "id": "item_1", "text": "Here's a summary of the repo..." }, "threadId": "thr_123", "turnId": "turn_456" } }
← { "method": "turn/completed", "params": { "threadId": "thr_123", "turn": { "id": "turn_456", "status": "completed", "items": [...], "error": null } } }
```

## 5. Complete RPC Method Reference

### Client → Server Requests

| Method | Purpose |
|--------|---------|
| `initialize` | Handshake with client metadata and capabilities |
| **Thread Management** | |
| `thread/start` | Create a new thread/conversation |
| `thread/resume` | Reopen an existing thread by ID |
| `thread/fork` | Branch a thread into a new thread ID |
| `thread/list` | Page through stored threads (cursor pagination) |
| `thread/loaded/list` | List thread IDs currently in memory |
| `thread/read` | Read a stored thread without resuming |
| `thread/archive` | Move thread to archived directory |
| `thread/unarchive` | Restore archived thread |
| `thread/unsubscribe` | Unsubscribe from thread events |
| `thread/name/set` | Set/update thread display name |
| `thread/metadata/update` | Patch stored thread metadata |
| `thread/compact/start` | Trigger conversation history compaction |
| `thread/rollback` | Drop last N turns from context |
| `thread/shellCommand` | Run unsandboxed shell command against thread |
| `thread/backgroundTerminals/clean` | Terminate background terminals (experimental) |
| **Turn Management** | |
| `turn/start` | Send user input, begin agent generation |
| `turn/steer` | Append input to in-flight turn |
| `turn/interrupt` | Cancel an in-flight turn |
| **Review** | |
| `review/start` | Start automated code review |
| **Command Execution** | |
| `command/exec` | Run a sandboxed command without a thread |
| `command/exec/write` | Write stdin to running command |
| `command/exec/resize` | Resize running PTY |
| `command/exec/terminate` | Terminate running command |
| **Model & Features** | |
| `model/list` | List available models |
| `experimentalFeature/list` | List feature flags with metadata |
| `experimentalFeature/enablement/set` | Patch runtime feature enablement |
| `collaborationMode/list` | List collaboration mode presets |
| **Skills & Plugins** | |
| `skills/list` | List available skills |
| `skills/config/write` | Enable/disable skills |
| `plugin/list` | List plugins |
| `plugin/read` | Read plugin details |
| `plugin/install` | Install a plugin |
| `plugin/uninstall` | Uninstall a plugin |
| `app/list` | List available apps/connectors |
| **Filesystem** | |
| `fs/readFile`, `fs/writeFile`, `fs/createDirectory`, `fs/getMetadata`, `fs/readDirectory`, `fs/remove`, `fs/copy`, `fs/watch`, `fs/unwatch` | Filesystem operations |
| **Auth** | |
| `account/read` | Check auth state |
| `account/login/start` | Begin login (apiKey, chatgpt, chatgptDeviceCode, chatgptAuthTokens) |
| `account/login/cancel` | Cancel pending login |
| `account/logout` | Sign out |
| `account/rateLimits/read` | Fetch ChatGPT rate limits |
| **Config** | |
| `config/read` | Read effective config |
| `config/value/write` | Write single config key |
| `config/batchWrite` | Atomic multi-key config write |
| `config/mcpServer/reload` | Hot-reload MCP server config |
| `configRequirements/read` | Read admin requirements |
| **MCP** | |
| `mcpServer/oauth/login` | Start MCP OAuth flow |
| `mcpServerStatus/list` | List MCP server status |
| **Other** | |
| `feedback/upload` | Submit feedback report |
| `externalAgentConfig/detect` | Detect migratable agent configs |
| `externalAgentConfig/import` | Import external agent configs |

### Client → Server Notifications

| Method | Purpose |
|--------|---------|
| `initialized` | Acknowledge initialization (must follow `initialize`) |

### Server → Client Notifications (Streaming Events)

| Method | Purpose |
|--------|---------|
| **Thread lifecycle** | |
| `thread/started` | Thread created/resumed |
| `thread/status/changed` | Thread status changed (notLoaded/idle/active/systemError) |
| `thread/archived` | Thread archived |
| `thread/unarchived` | Thread unarchived |
| `thread/closed` | Thread unloaded (last subscriber left) |
| `thread/name/updated` | Thread name changed |
| `thread/tokenUsage/updated` | Token usage update |
| **Turn lifecycle** | |
| `turn/started` | Turn began running |
| `turn/completed` | Turn finished (completed/interrupted/failed) |
| `turn/diff/updated` | Aggregated unified diff updated |
| `turn/plan/updated` | Agent plan updated |
| **Item lifecycle** | |
| `item/started` | New item began (carries full `ThreadItem`) |
| `item/completed` | Item finished (authoritative final state) |
| **Item deltas (streaming)** | |
| `item/agentMessage/delta` | Streamed text chunk for agent message |
| `item/plan/delta` | Streamed plan text |
| `item/reasoning/summaryTextDelta` | Streamed reasoning summary |
| `item/reasoning/summaryPartAdded` | New reasoning summary section |
| `item/reasoning/textDelta` | Raw reasoning text |
| `item/commandExecution/outputDelta` | Command stdout/stderr chunk |
| `item/commandExecution/terminalInteraction` | Terminal interaction event |
| `item/fileChange/outputDelta` | File change tool response |
| `item/mcpToolCall/progress` | MCP tool call progress |
| **Approvals** | |
| `serverRequest/resolved` | Pending approval resolved |
| `item/autoApprovalReview/started` | Auto-approval review started |
| `item/autoApprovalReview/completed` | Auto-approval review completed |
| **Auth** | |
| `account/updated` | Auth mode changed |
| `account/login/completed` | Login attempt finished |
| `account/rateLimits/updated` | Rate limits changed |
| **Other** | |
| `error` | Server error notification |
| `skills/changed` | Skill files changed on disk |
| `app/list/updated` | App list refreshed |
| `fs/changed` | Watched filesystem path changed |
| `model/rerouted` | Model was rerouted |
| `deprecationNotice` | Deprecation warning |
| `configWarning` | Configuration warning |
| `command/exec/outputDelta` | Standalone command output chunk |
| `mcpServer/oauthLogin/completed` | MCP OAuth flow finished |
| `mcpServer/startupStatus/updated` | MCP server startup status |
| `rawResponseItem/completed` | Raw Responses API item (internal) |
| `hook/started`, `hook/completed` | Hook lifecycle |
| `thread/compacted` | Legacy compaction (deprecated, use contextCompaction item) |

### Server → Client Requests (approval prompts)

| Method | Purpose |
|--------|---------|
| `item/commandExecution/requestApproval` | Request approval for command execution |
| `item/fileChange/requestApproval` | Request approval for file changes |
| `item/tool/requestUserInput` | Prompt user with questions for a tool |
| `item/tool/call` | Invoke a client-registered dynamic tool |
| `item/permissions/requestApproval` | Request permission approval |
| `mcpServer/elicitation/request` | MCP server elicitation request |
| `account/chatgptAuthTokens/refresh` | Request fresh external ChatGPT tokens |

## 6. Core Data Types

### ThreadItem Types
```typescript
type ThreadItem =
  | { type: "userMessage"; id: string; content: UserInput[] }
  | { type: "agentMessage"; id: string; text: string; phase: MessagePhase | null; memoryCitation: MemoryCitation | null }
  | { type: "plan"; id: string; text: string }
  | { type: "reasoning"; id: string; summary: string[]; content: string[] }
  | { type: "commandExecution"; id: string; command: string; cwd: string; status: CommandExecutionStatus; commandActions: CommandAction[]; aggregatedOutput: string | null; exitCode: number | null; durationMs: number | null; processId: string | null; source: CommandExecutionSource }
  | { type: "fileChange"; id: string; changes: FileUpdateChange[]; status: PatchApplyStatus }
  | { type: "mcpToolCall"; id: string; server: string; tool: string; status: McpToolCallStatus; arguments: JsonValue; result: McpToolCallResult | null; error: McpToolCallError | null }
  | { type: "dynamicToolCall"; id: string; tool: string; arguments: JsonValue; status: DynamicToolCallStatus; contentItems: DynamicToolCallOutputContentItem[] | null; success: boolean | null }
  | { type: "collabAgentToolCall"; id: string; tool: CollabAgentTool; status: CollabAgentToolCallStatus; senderThreadId: string; receiverThreadIds: string[]; prompt: string | null }
  | { type: "webSearch"; id: string; query: string; action: WebSearchAction | null }
  | { type: "imageView"; id: string; path: string }
  | { type: "imageGeneration"; id: string; status: string; result: string }
  | { type: "enteredReviewMode"; id: string; review: string }
  | { type: "exitedReviewMode"; id: string; review: string }
  | { type: "contextCompaction"; id: string }
  | { type: "hookPrompt"; id: string; fragments: HookPromptFragment[] }
```

### UserInput Types
```typescript
type UserInput =
  | { type: "text"; text: string; text_elements: TextElement[] }
  | { type: "image"; url: string }
  | { type: "localImage"; path: string }
  | { type: "skill"; name: string; path: string }
  | { type: "mention"; name: string; path: string }
```

### Turn
```typescript
type Turn = {
  id: string;
  items: ThreadItem[];
  status: "inProgress" | "completed" | "interrupted" | "failed";
  error: TurnError | null; // populated when status === "failed"
};

type TurnError = {
  message: string;
  codexErrorInfo?: CodexErrorInfo;
  additionalDetails?: string;
};
```

### Approval Responses
```typescript
// Command execution approval
type ExecCommandApprovalResponse =
  | "accept" | "acceptForSession" | "decline" | "cancel"
  | { acceptWithExecpolicyAmendment: { execpolicy_amendment: string[] } };

// File change approval
type ApplyPatchApprovalResponse =
  | "accept" | "acceptForSession" | "decline" | "cancel";
```

## 7. Injecting Skills/Instructions

### Via thread/start params
```json
{
  "method": "thread/start", "id": 10,
  "params": {
    "baseInstructions": "You are a helpful assistant for the Paperclip control plane.",
    "developerInstructions": "Always use TypeScript. Follow the project's coding conventions.",
    "personality": "pragmatic"
  }
}
```

### Via turn/start input (invoking a skill)
```json
{
  "method": "turn/start", "id": 30,
  "params": {
    "threadId": "thr_123",
    "input": [
      { "type": "text", "text": "$my-skill Do the thing" },
      { "type": "skill", "name": "my-skill", "path": "/path/to/SKILL.md" }
    ]
  }
}
```

### Via collaborationMode (experimental)
```json
{
  "method": "turn/start", "id": 30,
  "params": {
    "threadId": "thr_123",
    "input": [{ "type": "text", "text": "Fix the bug" }],
    "collaborationMode": {
      "id": "code",
      "settings": { "developer_instructions": null }
    }
  }
}
```

## 8. Cancelling/Interrupting a Turn

```json
→ { "method": "turn/interrupt", "id": 31, "params": {
    "threadId": "thr_123",
    "turnId": "turn_456"
  }
}
← { "id": 31, "result": {} }
← { "method": "turn/completed", "params": {
    "threadId": "thr_123",
    "turn": { "id": "turn_456", "status": "interrupted", "items": [...], "error": null }
  }
}
```

## 9. Generating TypeScript Types

```bash
# Stable API only
codex app-server generate-ts --out ./schemas

# Including experimental fields
codex app-server generate-ts --out ./schemas --experimental

# JSON Schema bundle
codex app-server generate-json-schema --out ./schemas --experimental
```

Generated types are version-specific (match the codex binary version). Key files:
- `ClientRequest.ts` — all client→server request methods
- `ClientNotification.ts` — client→server notifications (`initialized` only)
- `ServerNotification.ts` — all server→client streaming events
- `ServerRequest.ts` — server→client approval/tool requests
- `v2/ThreadItem.ts` — all item types in the ThreadItem union
- `v2/Turn.ts` — turn shape with status
- `v2/UserInput.ts` — input types for turn/start

**There is no standalone TypeScript SDK for the protocol.** You work with raw JSON-RPC messages. The generated types serve as a type reference.

## 10. Error Handling

### JSON-RPC errors
```json
{ "id": 10, "error": { "code": -32001, "message": "Server overloaded; retry later." } }
```
- `-32001` — backpressure; retry with exponential backoff + jitter
- Standard JSON-RPC error codes for invalid requests, method not found, etc.

### Turn-level errors
Emitted in `turn/completed` when `status: "failed"`:
```json
{ "method": "turn/completed", "params": {
    "turn": {
      "status": "failed",
      "error": {
        "message": "Context window exceeded",
        "codexErrorInfo": { "type": "ContextWindowExceeded" }
      }
    }
  }
}
```

Common `codexErrorInfo` types: `ContextWindowExceeded`, `UsageLimitExceeded`, `HttpConnectionFailed`, `ResponseStreamConnectionFailed`, `ResponseStreamDisconnected`, `ResponseTooManyFailedAttempts`, `BadRequest`, `Unauthorized`, `SandboxError`, `InternalServerError`, `Other`.

### Experimental API errors
```
"<descriptor> requires experimentalApi capability"
```

## 11. Minimal Client Implementation Checklist

1. **Spawn** `codex app-server` with stdio transport
2. **Parse** JSONL from stdout (one JSON message per line)
3. **Send** `initialize` request with `clientInfo`
4. **Send** `initialized` notification (no `id`)
5. **Optionally authenticate** via `account/login/start`
6. **Send** `thread/start` to create a conversation
7. **Send** `turn/start` with user input
8. **Handle notifications**: route by `method` field
   - `item/agentMessage/delta` → append text to UI
   - `item/started` / `item/completed` → track item lifecycle
   - `turn/completed` → turn is done
   - `item/commandExecution/requestApproval` → prompt user or auto-approve
   - `item/fileChange/requestApproval` → prompt user or auto-approve
9. **Send** `turn/interrupt` to cancel if needed
10. **Close** stdin to shut down the server

## 12. Thread Status Types

```typescript
type ThreadStatus =
  | { type: "notLoaded" }
  | { type: "idle" }
  | { type: "systemError" }
  | { type: "active"; activeFlags: ActiveFlag[] }

// activeFlags includes things like "waitingOnApproval"
```

## 13. Config Overrides via CLI

```bash
codex app-server -c model="o3" \
  -c approval_policy="never" \
  -c 'sandbox_permissions=["disk-full-read-access"]' \
  -c shell_environment_policy.inherit=all \
  --enable unified_exec \
  --disable apps
```

## 14. WebSocket Transport (Experimental)

```bash
codex app-server --listen ws://127.0.0.1:4500
```

- One JSON-RPC message per WebSocket text frame
- Health probes: `GET /readyz` (200 OK), `GET /healthz` (200 OK, no Origin)
- Auth modes: `--ws-auth capability-token --ws-token-file /path` or `--ws-auth signed-bearer-token --ws-shared-secret-file /path`
- Client sends `Authorization: Bearer <token>` during WS handshake

## 15. Key Observations for TUI Integration

1. **No SDK wrapper exists** — work directly with spawned process + JSONL
2. **Streaming is notification-based** — `item/agentMessage/delta` gives you incremental text
3. **Approvals are server-initiated requests** — server sends a request with an `id`, client must respond
4. **`approvalPolicy: "never"`** skips all approval prompts (auto-approve everything)
5. **Skills inject via `turn/start` input** — combine `{ type: "text" }` with `{ type: "skill" }` items
6. **`turn/steer`** lets you add context mid-turn without creating a new turn
7. **Thread persistence** is automatic (JSONL on disk); use `thread/resume` to continue
8. **`thread/fork`** branches conversations
9. **`ephemeral: true`** on `thread/start` creates in-memory-only threads
10. **`personality`** values: `"friendly"`, `"pragmatic"`, `"none"`
