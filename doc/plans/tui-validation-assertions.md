## Area: Core Architecture (tui-rewrite-core)

### VAL-TUI-CORE-001 — Package metadata is correct
**Description:** The `@papierklammer/orchestrator-tui` package.json declares `type: "module"`, sets `bin.papierklammer-tui` to `dist/index.js`, and has name `@papierklammer/orchestrator-tui`.
**Pass condition:** Vitest reads package.json and asserts `pkg.type === "module"`, `pkg.bin["papierklammer-tui"] === "dist/index.js"`, and `pkg.name === "@papierklammer/orchestrator-tui"`.
**Tool:** vitest
**Evidence:** `cli.test.ts` — assertions on parsed package.json fields match expected values.

### VAL-TUI-CORE-002 — App component renders without crashing
**Description:** Rendering `<App>` with required props (`url`, `apiKey`, `companyId`, `fetchFn`) produces a non-empty terminal frame with no thrown errors.
**Pass condition:** `render(<App …/>)` succeeds and `lastFrame()` returns a non-null, non-empty string.
**Tool:** vitest
**Evidence:** `layout.test.tsx` — `lastFrame()` is asserted to contain known content strings.

### VAL-TUI-CORE-003 — Five layout regions are present in a single frame
**Description:** A single rendered frame must contain the HeaderBar ("Papierklammer"), AgentSidebar ("Agents"), ChatPanel ("Chat"), InputBar ("Type a message"), and StatusBar ("Codex:") regions.
**Pass condition:** `lastFrame()` contains all five marker strings simultaneously.
**Tool:** vitest
**Evidence:** `layout.test.tsx` — "renders all 5 regions in one frame" test asserts `.toContain()` for each marker.

### VAL-TUI-CORE-004 — CLI flag parsing accepts --url, --api-key, --company-id, --help
**Description:** `parseArgs()` correctly extracts `--url`, `--api-key`, `--company-id` values from argv and sets `showHelp` for `--help` / `-h`.
**Pass condition:** `parseArgs(["node", "cmd", "--url", "X"]).flags.url === "X"` (and analogous checks for each flag). `parseArgs(["node", "cmd", "--help"]).showHelp === true`.
**Tool:** vitest
**Evidence:** `cli.test.ts` — individual flag-parsing tests validate each flag.

### VAL-TUI-CORE-005 — CLI defaults to localhost:3100 when no --url
**Description:** When `--url` is omitted and no env var is set, `parseArgs` returns `flags.url === "http://localhost:3100"`.
**Pass condition:** `parseArgs(["node", "cmd"]).flags.url === "http://localhost:3100"`.
**Tool:** vitest
**Evidence:** `cli.test.ts` — "uses default url when --url is not provided" test.

### VAL-TUI-CORE-006 — Ctrl+C exits the app
**Description:** Sending the ASCII `\x03` character (Ctrl+C) via `stdin.write` triggers `useApp().exit()` and the component tree unmounts cleanly.
**Pass condition:** After `stdin.write("\x03")`, the test can call `unmount()` without error.
**Tool:** vitest
**Evidence:** `exit.test.tsx` — "exits the app when Ctrl+C is pressed" test.

### VAL-TUI-CORE-007 — Terminal alternate screen buffer is restored on exit
**Description:** On mount the App writes `\x1b[?1049h` (enter alternate screen); on unmount it writes `\x1b[?1049l` (leave alternate screen). After Ctrl+C triggers exit and unmount, the restore sequence must appear in `process.stdout.write` calls.
**Pass condition:** Spy on `process.stdout.write` captures `"\x1b[?1049l"` in its call history after unmount.
**Tool:** vitest
**Evidence:** `exit.test.tsx` — "restores terminal by disabling alternate screen buffer on exit" test checks `stdoutWriteMock.mock.calls`.

### VAL-TUI-CORE-008 — Company picker shown when no companyId is preselected
**Description:** When `companyId` prop is empty, the App renders a `CompanyPicker` component displaying "Select a company" and lists companies fetched from `/api/companies`, sorted most-recent first.
**Pass condition:** `lastFrame()` contains "Select a company" and the more recently updated company name appears before the older one in the frame string.
**Tool:** vitest
**Evidence:** `layout.test.tsx` — "renders a company picker sorted by recency when no company is preselected" test.

---

## Area: Codex Client (tui-rewrite-core)

### VAL-TUI-CODEX-001 — Subprocess spawn on construction
**Description:** `new CodexClient({ spawnFn })` immediately calls `spawnFn("codex", ["app-server"], { stdio: ["pipe", "pipe", "inherit"] })`.
**Pass condition:** `spawnFn` mock is called exactly once with the expected arguments.
**Tool:** vitest
**Evidence:** `codex-client.test.ts` — "spawns codex app-server subprocess on construction" test.

### VAL-TUI-CODEX-002 — Initialize handshake sends request and notification
**Description:** `client.initialize()` sends a JSON-RPC request with `method: "initialize"` and `params.clientInfo.name === "papierklammer-tui"`. On receiving the response, it sends an `"initialized"` notification (no `id`).
**Pass condition:** Two messages collected from mock stdin: first has `method === "initialize"` with an `id`, second has `method === "initialized"` with no `id`. The promise resolves with the server's `InitializeResult`.
**Tool:** vitest
**Evidence:** `codex-client.test.ts` — "sends initialize request and initialized notification" test.

### VAL-TUI-CODEX-003 — Initialize error is thrown
**Description:** If the server responds to `initialize` with an error, the promise rejects with an error message containing "Initialize failed:".
**Pass condition:** `await expect(initPromise).rejects.toThrow("Initialize failed:")`.
**Tool:** vitest
**Evidence:** `codex-client.test.ts` — "throws on initialize error" test.

### VAL-TUI-CODEX-004 — Thread creation returns threadId
**Description:** `client.startThread()` sends a `thread/start` JSON-RPC request with `approvalPolicy: "never"` and `sandbox: "workspace-write"` defaults. It resolves with the `thread.id` from the response.
**Pass condition:** Returned threadId matches the mock response value (e.g., `"thr_abc123"`).
**Tool:** vitest
**Evidence:** `codex-client.test.ts` — "starts a thread and returns threadId" test.

### VAL-TUI-CODEX-005 — BaseInstructions injected on thread start
**Description:** When `startThread({ baseInstructions: "..." })` is called, the `thread/start` request params include the `baseInstructions` field alongside `approvalPolicy` and `sandbox`.
**Pass condition:** Captured `thread/start` message has `params.baseInstructions` matching the provided value.
**Tool:** vitest
**Evidence:** `codex-client.test.ts` — "injects baseInstructions on thread start" test.

### VAL-TUI-CODEX-006 — Turn start and delta streaming
**Description:** `client.startTurn(threadId, text)` sends `turn/start` with `input: [{type: "text", text}]`. Server-sent `item/agentMessage/delta` notifications fire the `onDelta` callback with the delta string.
**Pass condition:** `startTurn` resolves with `turn.id` and `turn.status === "inProgress"`. Accumulated deltas array matches the mock delta values sent by the server.
**Tool:** vitest
**Evidence:** `codex-client.test.ts` — "starts a turn and streams deltas via callbacks" test.

### VAL-TUI-CODEX-007 — Turn completion callback fires
**Description:** A `turn/completed` notification from the server fires `callbacks.onTurnCompleted` with the completed turn info.
**Pass condition:** `completedTurn.turn.status === "completed"` and `completedTurn.turn.items` has the expected length.
**Tool:** vitest
**Evidence:** `codex-client.test.ts` — "fires onTurnCompleted callback" test.

### VAL-TUI-CODEX-008 — Multi-turn on the same thread
**Description:** After the first turn completes, a second `startTurn` on the same `threadId` sends a new `turn/start` request with the same `threadId`. Both turns resolve independently.
**Pass condition:** Two `turn/start` messages collected, both with the same `threadId`. Each resolves with a distinct `turn.id`.
**Tool:** vitest
**Evidence:** `codex-client.test.ts` — "supports multi-turn on the same thread" test.

### VAL-TUI-CODEX-009 — Auto-reconnect on subprocess crash
**Description:** When the subprocess exits with a non-zero code and `autoReconnect` is true, the client spawns a new process after `reconnectDelayMs`, re-initializes, and fires `onConnected`.
**Pass condition:** `spawnFn` called twice total. `onDisconnected` fires on crash, `onConnected` fires after reconnect delay + re-initialize.
**Tool:** vitest
**Evidence:** `codex-client.test.ts` — "auto-reconnects on subprocess exit" test.

### VAL-TUI-CODEX-010 — No reconnect after destroy
**Description:** After `client.destroy()`, a subprocess exit does not trigger a new spawn.
**Pass condition:** `spawnFn` called only once (initial), no further calls after destroy + exit event + timer advance.
**Tool:** vitest
**Evidence:** `codex-client.test.ts` — "does not auto-reconnect when destroyed" test.

### VAL-TUI-CODEX-011 — Destroy sends SIGTERM
**Description:** `client.destroy()` calls `proc.kill("SIGTERM")` on the child process and rejects all pending requests.
**Pass condition:** `mockProc.kill` called with `"SIGTERM"`. Any pending `initialize()` promise rejects with "Codex subprocess exited".
**Tool:** vitest
**Evidence:** `codex-client.test.ts` — "destroy sends SIGTERM to subprocess" and "rejects pending requests on destroy" tests.

### VAL-TUI-CODEX-012 — isConnected state transitions
**Description:** `client.isConnected` is `false` before `initialize()` completes and `true` after a successful initialize handshake.
**Pass condition:** `client.isConnected === false` before init, `client.isConnected === true` after init response.
**Tool:** vitest
**Evidence:** `codex-client.test.ts` — "isConnected is false before initialize" and "isConnected is true after initialize" tests.

### VAL-TUI-CODEX-013 — Malformed JSONL lines are ignored
**Description:** Non-JSON lines written to the subprocess stdout do not throw or crash the client. Subsequent valid messages are processed normally.
**Pass condition:** After writing `"not valid json\n"` to stdout, the client still initializes successfully.
**Tool:** vitest
**Evidence:** `codex-client.test.ts` — "ignores malformed JSONL lines" test.

### VAL-TUI-CODEX-014 — Item started and completed callbacks
**Description:** Server-sent `item/started` and `item/completed` notifications fire the corresponding callbacks with correct item type and id.
**Pass condition:** `onItemStarted` receives `item.type === "agentMessage"` and `item.id` matching. `onItemCompleted` fires with the finalized item.
**Tool:** vitest
**Evidence:** `codex-client.test.ts` — "fires onItemStarted and onItemCompleted callbacks" test.

### VAL-TUI-CODEX-015 — Command output delta callback
**Description:** Server-sent `item/commandExecution/outputDelta` notification fires `onCommandOutput` with delta text and itemId.
**Pass condition:** `output.delta` and `output.itemId` match the mock notification values.
**Tool:** vitest
**Evidence:** `codex-client.test.ts` — "fires onCommandOutput callback" test.

---

## Area: Chat (tui-rewrite-core)

### VAL-TUI-CHAT-001 — User messages display with "You:" prefix
**Description:** When the ChatPanel receives a message with `role: "user"`, it renders the text preceded by "You:" in the terminal frame.
**Pass condition:** `lastFrame()` contains both `"You:"` and the message text.
**Tool:** vitest
**Evidence:** `chat.test.tsx` — "renders user messages with You: prefix" test.

### VAL-TUI-CHAT-002 — Assistant messages display with "Orchestrator:" prefix
**Description:** When the ChatPanel receives a message with `role: "assistant"`, it renders the text preceded by "Orchestrator:".
**Pass condition:** `lastFrame()` contains both `"Orchestrator:"` and the message text.
**Tool:** vitest
**Evidence:** `chat.test.tsx` — "renders assistant messages with Orchestrator: prefix" test.

### VAL-TUI-CHAT-003 — Enter key sends message and shows it in chat
**Description:** Typing text in the InputBar and pressing Enter (via `stdin.write("\r")`) adds a user message to the chat panel with "You:" prefix. The input is cleared after send.
**Pass condition:** After typing + Enter, `lastFrame()` contains `"You:"` and the typed text.
**Tool:** vitest
**Evidence:** `chat.test.tsx` — "calls onSubmit with text on Enter and clears input" test.

### VAL-TUI-CHAT-004 — Enter with empty text does not send
**Description:** Pressing Enter without typing any text does not add a message to the chat. The "No messages yet" empty state persists.
**Pass condition:** After Enter with no prior typing, `lastFrame()` still contains `"No messages yet"`.
**Tool:** vitest
**Evidence:** `chat.test.tsx` — "Enter with empty text does not send" test.

### VAL-TUI-CHAT-005 — Streaming text shows blinking cursor (▌)
**Description:** When `streamingText` is non-empty, the ChatPanel renders the text followed by a block cursor character `▌`.
**Pass condition:** `lastFrame()` contains the streaming text and the `"▌"` character.
**Tool:** vitest
**Evidence:** `chat.test.tsx` — "renders streaming text with cursor indicator" test.

### VAL-TUI-CHAT-006 — Thinking indicator shown when isThinking
**Description:** When `isThinking` is `true` and no streaming text is present, the chat shows "thinking..." with an "Orchestrator:" prefix.
**Pass condition:** `lastFrame()` contains `"thinking..."`.
**Tool:** vitest
**Evidence:** `chat.test.tsx` — "renders thinking indicator when isThinking is true" test.

### VAL-TUI-CHAT-007 — Thinking indicator hidden when streaming text is present
**Description:** When `streamingText` is non-empty, the thinking indicator is suppressed even if the component is in a thinking-adjacent state.
**Pass condition:** `lastFrame()` does not contain `"thinking..."` but does contain the streaming text.
**Tool:** vitest
**Evidence:** `chat.test.tsx` — "does not show thinking indicator when streaming text is present" test.

### VAL-TUI-CHAT-008 — Empty state renders "No messages yet"
**Description:** When the ChatPanel has no messages, no streaming text, and is not thinking, it displays "No messages yet".
**Pass condition:** `lastFrame()` contains `"No messages yet"`.
**Tool:** vitest
**Evidence:** `chat.test.tsx` — "renders empty state when no messages" test.

### VAL-TUI-CHAT-009 — Input disabled while thinking
**Description:** After sending a message, while the assistant is "thinking", the InputBar shows "Waiting for response" and does not accept new input.
**Pass condition:** `lastFrame()` contains both `"thinking..."` and `"Waiting for response"`.
**Tool:** vitest
**Evidence:** `chat.test.tsx` — "input is disabled while thinking" test.

### VAL-TUI-CHAT-010 — Message history renders multiple exchanges
**Description:** The MessageList component correctly renders a multi-message history with alternating user and assistant messages in order.
**Pass condition:** `lastFrame()` contains all message texts in the correct sequence.
**Tool:** vitest
**Evidence:** `chat.test.tsx` — "renders message history correctly" test in the MessageList describe block.

### VAL-TUI-CHAT-011 — Chat displays many messages (scroll capacity)
**Description:** When 20 messages are provided, the ChatPanel renders at least the first and last messages, demonstrating the full message list is accessible.
**Pass condition:** `lastFrame()` contains `"Message 0"` and `"Message 19"`.
**Tool:** vitest
**Evidence:** `chat.test.tsx` — "chat displays many messages in history" test.

---

## Area: Agent Status (tui-rewrite-core)

### VAL-TUI-AGENT-001 — Sidebar polls API and displays agents
**Description:** The AgentSidebar, driven by `useOrchestratorStatus`, renders agent names from the mock `/api/orchestrator/status` response with correct names and status indicators.
**Pass condition:** `lastFrame()` contains each agent name (e.g., "CEO", "Dev-1") and the `●` status dot character.
**Tool:** vitest
**Evidence:** `panels.test.tsx` — "renders agents with correct status indicators" test under "Sidebar with API data".

### VAL-TUI-AGENT-002 — Agent status text displayed
**Description:** Each agent row shows its status in parentheses: `(idle)`, `(running)`, `(error)`, `(blocked)`.
**Pass condition:** `lastFrame()` contains each status string.
**Tool:** vitest
**Evidence:** `panels.test.tsx` — "renders status text for each agent" test.

### VAL-TUI-AGENT-003 — Empty agent list shows "No agents connected"
**Description:** When the agents array is empty, the sidebar displays "No agents connected".
**Pass condition:** `lastFrame()` contains `"No agents connected"`.
**Tool:** vitest
**Evidence:** `panels.test.tsx` — "shows 'No agents connected' when list is empty" test.

### VAL-TUI-AGENT-004 — Header shows Connected/Disconnected status
**Description:** The HeaderBar displays "Connected" when `connected` is true and "Disconnected" when false.
**Pass condition:** `lastFrame()` contains the correct status string for each state.
**Tool:** vitest
**Evidence:** `panels.test.tsx` — "shows Connected status when connected" and "shows Disconnected status when not connected" tests.

### VAL-TUI-AGENT-005 — Header shows agent count
**Description:** The HeaderBar displays the total agent count (e.g., "5 agents") with correct singular/plural form ("1 agent" vs "2 agents").
**Pass condition:** `lastFrame()` contains the count string. For count=1, `.not.toContain("1 agents")` also passes.
**Tool:** vitest
**Evidence:** `panels.test.tsx` — "shows agent count" and "uses singular form for 1 agent" tests.

### VAL-TUI-AGENT-006 — Header shows active run count
**Description:** The HeaderBar shows the active run count (e.g., "2 active runs" or "1 active run").
**Pass condition:** `lastFrame()` contains the correct run count string.
**Tool:** vitest
**Evidence:** `panels.test.tsx` — "shows active run count" test.

### VAL-TUI-AGENT-007 — Sidebar shows Disconnected when API fails
**Description:** When the fetch fails, the sidebar displays "Disconnected" and the error message.
**Pass condition:** `lastFrame()` contains "Disconnected" and the error text. Multiple "Disconnected" instances appear (header + sidebar).
**Tool:** vitest
**Evidence:** `polish.test.tsx` — API error handling tests in "VAL-TUI-031" section.

### VAL-TUI-AGENT-008 — Scroll indicators for long agent list
**Description:** When the number of agents exceeds `maxVisible`, the sidebar shows scroll indicators: `▼` when more agents below, `▲` when scrolled past the top.
**Pass condition:** With `maxVisible=3` and 10 agents: `lastFrame()` contains `▼` but not `▲`. After scrolling down, both indicators appear.
**Tool:** vitest
**Evidence:** `panels.test.tsx` — "Agent list scrolling" describe block with multiple scroll indicator tests.

---

## Area: Company Management (tui-full-features)

### VAL-TUI-MGMT-001 — BaseInstructions describe available tool calls
**Description:** The `useCodex` hook passes `baseInstructions` to `startThread`, which injects orchestrator tool descriptions into the Codex thread context so the LLM knows what management operations are available.
**Pass condition:** The `thread/start` wire message contains `params.baseInstructions` with a non-empty string value.
**Tool:** vitest
**Evidence:** `codex-client.test.ts` — "injects baseInstructions on thread start" test verifies the field is transmitted on the wire.

### VAL-TUI-MGMT-002 — Tool call command executions rendered in chat
**Description:** When the Codex server sends an `item/completed` notification with `item.type === "commandExecution"`, the command and its output appear in the chat panel as a styled `CommandBlock`.
**Pass condition:** `lastFrame()` contains `"$ <command>"` and the command's output text.
**Tool:** vitest
**Evidence:** `integration.test.tsx` — "command execution blocks appear in chat during streaming" test and `chat.test.tsx` — "renders command blocks within assistant messages" test.

### VAL-TUI-MGMT-003 — LLM can create issues via tool calls
**Description:** When the Codex LLM invokes a tool that executes a command (e.g., `curl` to the API to create an issue), the `item/completed` event with `type: "commandExecution"` surfaces the command and its output in the chat. The TUI does not gate or filter which commands appear — any `commandExecution` item is rendered.
**Pass condition:** A mock `item/completed` with a curl command targeting `/api/…` renders the `$` command block with the server response.
**Tool:** vitest
**Evidence:** `integration.test.tsx` — E2E flow test sends `item/completed` with a curl command and verifies the output appears in chat.

### VAL-TUI-MGMT-004 — Multiple command blocks in one assistant message
**Description:** An assistant message can contain multiple `CommandBlock` items. All are rendered in sequence within the same message bubble.
**Pass condition:** `lastFrame()` contains all `"$ <command>"` strings and all output strings for each command.
**Tool:** vitest
**Evidence:** `chat.test.tsx` — "renders multiple command blocks in one message" test.

### VAL-TUI-MGMT-005 — Pending command items render during streaming
**Description:** While a turn is still in progress, `pendingCommandItems` are rendered inline via `MessageList`, showing commands the LLM has executed before the turn completes.
**Pass condition:** `lastFrame()` contains the pending command's `"$ <command>"` and output text.
**Tool:** vitest
**Evidence:** `chat.test.tsx` — "renders pending command items during streaming" test.

---

## Area: Chat UX (tui-full-features)

### VAL-TUI-UX-001 — Command blocks styled with border
**Description:** The `CommandBlock` component renders with a round border style (using `╭` and `╰` characters) and the command prefixed with `$`.
**Pass condition:** `lastFrame()` contains `"╭"`, `"╰"`, and `"$ <command>"`.
**Tool:** vitest
**Evidence:** `chat.test.tsx` — "renders command block with border" test.

### VAL-TUI-UX-002 — Tab key cycles focus between sidebar and input
**Description:** Pressing Tab toggles `focusTarget` between `"sidebar"` and `"input"`. Each Tab press switches focus, and the cycle wraps.
**Pass condition:** After 1st Tab the sidebar is focused (shows "Agents"), after 2nd Tab the input is focused (shows "Type a message..."), after 3rd Tab the sidebar is focused again.
**Tool:** vitest
**Evidence:** `panels.test.tsx` — "Tab key cycles focus between sidebar and input bar" test.

### VAL-TUI-UX-003 — Arrow keys navigate sidebar selection
**Description:** When the sidebar is focused, pressing `↓` (escape sequence `\u001B[B`) moves the selection index down and `↑` (`\u001B[A`) moves it up. Arrow keys have no effect when the sidebar is not focused.
**Pass condition:** After pressing `↓` and `↑`, agent names remain visible and the selection state changes. When input is focused, arrow keys do not alter sidebar selection.
**Tool:** vitest
**Evidence:** `panels.test.tsx` — "arrow keys move sidebar selection down and up" and "arrow keys do not move selection when sidebar is not focused" tests.

### VAL-TUI-UX-004 — Help overlay toggles with ? key
**Description:** Pressing `?` when the input bar is not focused opens the HelpOverlay displaying "Keyboard Shortcuts" with documented shortcuts (Tab, Enter, Ctrl+C, ↑/↓, ?). Pressing `?` again or `Escape` dismisses it.
**Pass condition:** After `?`, `lastFrame()` contains "Keyboard Shortcuts". After another `?` or Escape, it no longer contains "Keyboard Shortcuts".
**Tool:** vitest
**Evidence:** `polish.test.tsx` — Help overlay tests in "VAL-TUI-033" section.

### VAL-TUI-UX-005 — Help overlay shows all documented shortcuts
**Description:** The HelpOverlay component renders descriptions for all five keyboard shortcuts: "Switch panels", "Send message", "Exit", "Scroll agents", "Toggle this help overlay".
**Pass condition:** `lastFrame()` contains all five description strings.
**Tool:** vitest
**Evidence:** `polish.test.tsx` — "help overlay shows all documented shortcuts" test.

### VAL-TUI-UX-006 — StatusBar shows Codex state, threadId, and model
**Description:** The StatusBar component renders the current Codex connection state (disconnected/connected/thinking), and optionally the active threadId and model name.
**Pass condition:** `lastFrame()` contains `"Codex: <state>"`, and when threadId/model are provided, `"Thread: <id>"` and `"Model: <name>"` also appear.
**Tool:** vitest
**Evidence:** `panels.test.tsx` — StatusBar describe block with multiple state tests.

### VAL-TUI-UX-007 — Scroll indicators disappear when all agents fit
**Description:** When the number of agents is less than or equal to `maxVisible`, no scroll indicators (`▲` or `▼`) appear.
**Pass condition:** `lastFrame()` does not contain `"▲"` or `"▼"` when 3 agents are rendered with `maxVisible=5`.
**Tool:** vitest
**Evidence:** `panels.test.tsx` — "does not show scroll indicators when all agents fit" test.

---

## Area: Error Handling (tui-full-features)

### VAL-TUI-ERR-001 — API error shows graceful degradation
**Description:** When the fetch to `/api/orchestrator/status` rejects, the app does not crash. The header shows "Disconnected", the sidebar shows "Disconnected" with the error message, and all five layout regions remain rendered.
**Pass condition:** `lastFrame()` contains "Papierklammer", "Agents", "Chat", "Codex:", "Disconnected", and the error text.
**Tool:** vitest
**Evidence:** `polish.test.tsx` — "app does not crash when API is unreachable" and "shows error message in header when API fails" tests.

### VAL-TUI-ERR-002 — Recovery from API error on next poll
**Description:** After an API failure, if the next poll succeeds, the app transitions back to "Connected" and displays agents.
**Pass condition:** First poll fails → "Disconnected". Second poll succeeds → `lastFrame()` contains "Connected" and agent names.
**Tool:** vitest
**Evidence:** `polish.test.tsx` — "recovers from error when API becomes available" test.

### VAL-TUI-ERR-003 — Codex crash shows disconnected status
**Description:** When the Codex subprocess exits unexpectedly, the StatusBar transitions to "Codex: disconnected".
**Pass condition:** After `mockProc.emit("exit", 1, null)`, `lastFrame()` contains `"Codex: disconnected"`.
**Tool:** vitest
**Evidence:** `polish.test.tsx` — "shows Codex disconnected when subprocess crashes" test.

### VAL-TUI-ERR-004 — Codex crash auto-restart with status message
**Description:** After a Codex subprocess crash, the client auto-reconnects after the reconnect delay (3000ms default), spawns a new process, re-initializes, and transitions back to "Codex: connected".
**Pass condition:** `spawnFn` called twice. After reconnect delay + re-init response, `lastFrame()` contains `"Codex: connected"`.
**Tool:** vitest
**Evidence:** `polish.test.tsx` — "auto-restarts Codex subprocess after crash" test.

### VAL-TUI-ERR-005 — Graceful shutdown sends SIGTERM to Codex
**Description:** When Ctrl+C is pressed and the app exits, the Codex subprocess receives SIGTERM via `destroy()`.
**Pass condition:** `mockProc.kill` called with `"SIGTERM"` after Ctrl+C.
**Tool:** vitest
**Evidence:** `polish.test.tsx` — "Ctrl+C sends SIGTERM to Codex subprocess via destroy" test.

### VAL-TUI-ERR-006 — Terminal restored after graceful shutdown
**Description:** After Ctrl+C and unmount, the alternate screen buffer disable sequence `\x1b[?1049l` is written to stdout.
**Pass condition:** `process.stdout.write` spy captures `"\x1b[?1049l"`.
**Tool:** vitest
**Evidence:** `polish.test.tsx` — "terminal is restored after Ctrl+C" test.

### VAL-TUI-ERR-007 — Codex send error surfaces in chat without crash
**Description:** If `sendMessage` triggers a JSON-RPC error (e.g., `thread/start` failure), the error message is displayed in the chat as an error entry. The TUI remains alive and functional.
**Pass condition:** `lastFrame()` contains the error text (e.g., "Error: thread/start failed:…") and does not contain "thinking...".
**Tool:** vitest
**Evidence:** `integration.test.tsx` — "keeps the TUI alive and surfaces a Codex error when send fails" test.

---

## Area: Cross-area Flows

### VAL-TUI-CROSS-001 — Full E2E flow: render → type → stream → finalize
**Description:** End-to-end integration test: App renders all regions, Codex subprocess is spawned and initialized, user types a message via stdin, the message appears in chat, Codex streams delta responses that appear with `▌` cursor, and turn completion finalizes the message (cursor removed, "thinking..." removed, full text in history with "Orchestrator:" prefix).
**Pass condition:** Sequential assertions on `lastFrame()` verify: (1) all 5 regions present, (2) Codex spawned, (3) "Codex: connected" after init, (4) user message appears after Enter, (5) "thinking..." shown, (6) streaming text + `▌` after deltas, (7) finalized message without `▌` or "thinking..." after turn/completed.
**Tool:** vitest
**Evidence:** `integration.test.tsx` — "full flow: render → type message → streaming → finalized message" test.

### VAL-TUI-CROSS-002 — Multi-turn conversation uses same thread
**Description:** Two sequential messages are sent by the user. Only one `thread/start` request is issued (for the first message). Both `turn/start` requests share the same `threadId`. Both user messages and both assistant replies appear in the chat history.
**Pass condition:** Wire message analysis: 1 `thread/start`, 2 `turn/start` messages both with the same `threadId`. `lastFrame()` contains both user messages and both assistant answers.
**Tool:** vitest
**Evidence:** `integration.test.tsx` — "multi-turn conversation uses same thread" test.

### VAL-TUI-CROSS-003 — Background status updates don't disrupt chat
**Description:** While the user has an active chat (messages visible), a background poll to `/api/orchestrator/status` returns updated agent data. The sidebar updates (e.g., status changes from "idle" to "running") without clearing or disrupting the chat panel content.
**Pass condition:** After a poll cycle during active chat: `lastFrame()` still contains the user's chat message AND the sidebar shows the updated status (e.g., "(running)").
**Tool:** vitest
**Evidence:** `integration.test.tsx` — "sidebar updates while chat is active without disruption" test.

### VAL-TUI-CROSS-004 — Sidebar updates don't clear streaming text
**Description:** While the Codex client is streaming delta text into the chat, a background API poll updates the sidebar. The streaming text remains visible in the chat panel.
**Pass condition:** After an API poll during streaming: `lastFrame()` contains both the streaming text and the updated sidebar status.
**Tool:** vitest
**Evidence:** `integration.test.tsx` — "sidebar updates do not clear streaming text" test.

### VAL-TUI-CROSS-005 — API error during active chat doesn't crash
**Description:** While the user has sent a chat message, a background API poll fails. The app remains alive: the chat message is still visible, the header shows "Disconnected", and the error message appears in the sidebar.
**Pass condition:** `lastFrame()` contains the user's message, "Disconnected", and the error text.
**Tool:** vitest
**Evidence:** `integration.test.tsx` — "API error during active chat doesn't crash the app" test.

### VAL-TUI-CROSS-006 — Command execution blocks appear during streaming
**Description:** While an assistant turn is in progress (streaming), a `commandExecution` `item/completed` notification renders a CommandBlock inline in the chat panel with the command and output.
**Pass condition:** `lastFrame()` contains `"$ <command>"` and the command output text while the turn is still in progress.
**Tool:** vitest
**Evidence:** `integration.test.tsx` — "command execution blocks appear in chat during streaming" test.

### VAL-TUI-CROSS-007 — useCodex hook state transitions
**Description:** The `useCodex` React hook correctly transitions through connection states: `disconnected` → `connected` (after init) → `thinking` (after sendMessage) → `connected` (after turn completion) → `disconnected` (on subprocess exit).
**Pass condition:** A test harness component renders connection state text. Sequential assertions verify each state transition at the correct point.
**Tool:** vitest
**Evidence:** `useCodex.test.tsx` — "starts as disconnected and transitions to connected after initialize", "creates thread and sends message", and "transitions to disconnected on subprocess exit" tests.
