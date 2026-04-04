# Papierklammer Design System

> Agent orchestrator GUI. TUI-inspired, brutalist, monospace-only.
> Forked from Paperclip, redesigned from scratch.

---

## Philosophy

- TUI aesthetic rendered as a GUI. Think terminal emulator, not web app.
- No border-radius anywhere. Zero. Not on buttons, cards, inputs, badges, nothing.
- No shadows, no gradients, no glow, no blur, no rounded pills.
- No decorative elements. Every pixel is structural or informational.
- Borders are the only spatial dividers. 1px solid lines, always.
- Information density is high. Small font sizes, tight spacing.
- Monospace everything. No sans-serif, no serif, no mixed fonts.

---

## Color System

### Primary palette (pink/rose theme, white text)

```css
:root {
  /* Background ramp (rose/mauve) */
  --bg:         #C4878E;   /* base surface */
  --bg-dark:    #B07078;   /* subtle emphasis, hover states */
  --bg-darker:  #8E5A64;   /* strong emphasis, active tabs, logo bg */
  --bg-deep:    #6B3F48;   /* deepest accent, rarely used */
  --bg-light:   #D4A0A6;   /* lighter surface if needed */
  --bg-lighter: #E2BCC0;   /* lightest, highlights */

  /* Foreground (white with opacity for hierarchy) */
  --fg:         #FFFFFF;                 /* primary text, values, active items */
  --fg-muted:   rgba(255, 255, 255, 0.68);  /* secondary text, inactive sidebar items */
  --fg-dim:     rgba(255, 255, 255, 0.40);  /* tertiary text, labels, timestamps, keys */

  /* Borders (white with opacity) */
  --border:        rgba(255, 255, 255, 0.18);  /* default dividers */
  --border-strong: rgba(255, 255, 255, 0.32);  /* card outlines, input borders */

  /* Semantic status */
  --alive:  #82E88A;   /* running, active, success */
  --warn:   #E8D560;   /* tool calls, warnings, pending */
  --dead:   #FF6060;   /* error, failed, disconnected */
}
```

### Swatch reference

| Name    | Hex       | Use                                     |
|---------|-----------|-----------------------------------------|
| deep    | `#6B3F48` | Deepest accent                          |
| darker  | `#8E5A64` | Logo bg, exec button bg, tier badges    |
| dark    | `#B07078` | Active tab bg, command prefix bg        |
| base    | `#C4878E` | Primary background surface              |
| light   | `#D4A0A6` | Optional lighter surface                |
| lighter | `#E2BCC0` | Optional highlights                     |

### Hierarchy through opacity

Text hierarchy is achieved entirely through white opacity levels, never through font weight changes or color shifts:

- **Primary** (`--fg`, 100% white): Agent names, values, active nav items, headings
- **Secondary** (`--fg-muted`, 68% white): Inactive items, log content, descriptions
- **Tertiary** (`--fg-dim`, 40% white): Labels, keys, timestamps, placeholders, section headers

### Status indicators

Status is shown with 6x6 **square** indicators (never circles):

```css
.status-indicator {
  width: 6px;
  height: 6px;
  display: inline-block;
  /* No border-radius */
}

.status-alive  { background: var(--alive); }
.status-error  { background: var(--dead); }
.status-idle   { border: 1px solid var(--fg-muted); background: transparent; }
```

---

## Typography

### Font

**JetBrains Mono** is the only font. It is used everywhere without exception.

```css
@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&display=swap');

:root {
  --font: 'JetBrains Mono', monospace;
}

* {
  font-family: var(--font);
}
```

### Type scale

| Role                 | Size   | Weight | Transform              | Spacing        | Color        |
|----------------------|--------|--------|------------------------|----------------|--------------|
| Logo                 | 12-13px| 700    | uppercase              | 0.5px          | `--fg`       |
| Section label        | 9-10px | 400    | uppercase              | 1-1.5px        | `--fg-dim`   |
| Tier badge           | 9px    | 400    | none                   | 0              | `--fg`       |
| Sidebar item         | 12px   | 500/400| none                   | 0              | `--fg` / `--fg-muted` |
| Tab                  | 11px   | 400    | none                   | 0              | `--fg-muted` |
| Agent name           | 11-12px| 500    | none                   | 0              | `--fg`       |
| Agent state          | 10px   | 400    | none                   | 0              | `--fg-dim`   |
| Key-value key        | 10px   | 400    | none                   | 0              | `--fg-dim`   |
| Key-value value      | 10px   | 400    | none                   | 0              | `--fg`       |
| Stream / log content | 10px   | 400    | none                   | 0              | `--fg-muted` |
| Metric value         | 15-16px| 500    | none                   | 0              | `--fg`       |
| Metric label         | 9px    | 400    | uppercase              | 1px            | `--fg-dim`   |
| Toolbar button       | 11px   | 400    | none                   | 0              | `--fg-muted` |
| Command input        | 11px   | 400    | none                   | 0              | `--fg`       |
| Status bar           | 10px   | 400    | none                   | 0              | `--fg-dim`   |

### Formatting conventions

- Section headers and labels: always `text-transform: uppercase` with `letter-spacing: 1-1.5px`
- No bold except logo (700) and active names/metric values (500)
- All text renders white at varying opacity levels for hierarchy

---

## Layout

### Primary structure: Hierarchy columns (left to right)

The main view is a horizontal column layout where position encodes authority.

```
+----------+----------+----------+----------+
| TIER 0   | TIER 1   | TIER 2   | TIER N   |
| Executive| Leads    | Workers  | ...      |
| (leftmost = highest authority)   (right = lowest) |
+----------+----------+----------+----------+
```

#### Tier columns

- Each tier is a vertical column separated by 1px borders
- Tier header shows label + rank badge
- Within each tier, agents stack vertically
- Column flex proportions should reflect content density (executives get breathing room, worker columns can be wider since they hold more agents)

```css
.tier-executive { flex: 3; }
.tier-leads     { flex: 2.5; }
.tier-workers   { flex: 4; }
```

#### Agent sorting within tiers

Agents within each column are sorted by activity:

1. **Active/running** agents first (sorted by elapsed time, longest first)
2. **Waiting/queued** agents second
3. **Idle/completed** agents last (sorted by most recently active first)

Idle agents collapse to a single-line summary:

```
searcher_02          done  3.2s  12 results
```

Active agents expand to show full stream output.

### Top bar

Single-row bar with cells separated by 1px borders. No padding between cells, only internal padding.

```
+-------------------+----------+---------+--------+---+--------------------+
| PAPIERKLAMMER     | pipeline | history | config |   | 2 active  3 idle   |
+-------------------+----------+---------+--------+---+--------------------+
  ^logo (bg-darker)   ^tabs (bg-dark when active)      ^status (right-aligned)
```

### Metrics strip

Horizontal bar directly below the top bar. Equal-width cells, each showing one metric.

```
+-------------+-------------+-------------+-------------+-------------+
| TOTAL TOKENS| AGENTS      | DEPTH       | ELAPSED     | COST        |
| 4,891       | 5           | 3           | 12.4s       | $0.018      |
+-------------+-------------+-------------+-------------+-------------+
```

- Label: 9px uppercase, `--fg-dim`
- Value: 15-16px weight 500, `--fg`

### Command bar

Docked at bottom, full width.

```
+------+-----------------------------------------------+-----+
| EXEC | blog_pipeline --topic 'agentic workflows'     | RUN |
+------+-----------------------------------------------+-----+
  ^bg-dark prefix    ^transparent input                   ^bg-darker button
```

---

## Components

### Agent block (expanded, active)

```
+----------------------------------------------+
| agent_name                              [sq] |  <- a-head: name + status square
+----------------------------------------------+
| model    claude-sonnet-4                     |  <- a-meta: key-value pairs
| reports to  ceo                              |
| tools    web_search, file_read               |
+----------------------------------------------+
| REASONING + ACTIONS                          |  <- a-stream-label: 9px uppercase
| analyzing task: "write blog post..."         |  <- thought: --fg-muted
| need research phase then writing phase       |
| $ delegate research_lead --task="find..."    |  <- tool-call: --warn color
|   ack. research_lead spawned                 |  <- tool-result: --fg-dim, indented
| research_lead reported: 12 sources found     |  <- delegation: --alive color
+----------------------------------------------+
```

### Agent block (collapsed, idle)

Single line within the tier column:

```
| writer_02          idle   --:--              |
```

Or with last result:

```
| searcher_03        done   2.1s  8 results   |
```

### Stream content color coding

| Content type     | Color      | Prefix/format                    |
|------------------|------------|----------------------------------|
| Reasoning/thought| `--fg-muted` | Plain text                     |
| Tool call        | `--warn`   | `$ tool_name args...`            |
| Tool result      | `--fg-dim` | Indented 12px under its call     |
| Delegation event | `--alive`  | `child_name: status message`     |
| Error            | `--dead`   | Error text                       |
| Awaiting         | `--fg-dim` | `--:--  awaiting input`          |

### Tier header

```
+----------------------------------------------+
| WORKERS                          [tier 2]    |
+----------------------------------------------+
```

- Label: 9px uppercase, letter-spacing 1.5px, `--fg-dim`
- Badge: 9px, `background: --bg-darker`, padding 2px 6px

### Tabs

Inline in the top bar. No special container, just text with bottom-border on active:

```css
.tab {
  color: var(--fg-muted);
  padding: 2px 0;
  border-bottom: 1px solid transparent;
  cursor: pointer;
}

.tab.active {
  color: var(--fg);
  background: var(--bg-dark);
  /* OR: border-bottom-color: var(--fg); */
}
```

### Buttons

Transparent background, 1px white border. No radius. Uppercase with letter-spacing.

```css
.btn {
  background: transparent;
  border: 1px solid var(--fg);
  color: var(--fg);
  font-family: var(--font);
  font-size: 11px;
  padding: 6px 14px;
  cursor: pointer;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
```

For embedded command buttons (exec, run), use `background: var(--bg-darker)` instead.

### Inputs

Transparent, 1px border, no radius, no background change on focus.

```css
.input {
  background: transparent;
  border: 1px solid var(--border-strong);
  color: var(--fg);
  font-family: var(--font);
  font-size: 11px;
  padding: 6px 10px;
  outline: none;
}

.input::placeholder {
  color: var(--fg-dim);
}
```

---

## Spacing

### General rules

- Borders are the primary spatial divider. Whitespace is secondary.
- Internal padding within cells: 8-14px
- Between key-value lines: 0 (rely on line-height: 1.7-1.8)
- Between stream entries: 2-3px margin-bottom
- Between agent blocks: 0 (separated by border-bottom)
- Metric cell padding: 8px 14px

### Heights

- Top bar: 34-36px
- Metric cells: auto (roughly 44-48px with padding)
- Command bar: 36-38px
- Agent header: auto (roughly 34px with padding)
- Collapsed agent row: single line, ~28px

---

## Interaction patterns

### Agent expansion/collapse

- Clicking a collapsed idle agent expands it to show its last stream output
- Clicking an expanded idle agent collapses it back to single line
- Active agents are always expanded and cannot be collapsed
- Expansion is animated with a simple height transition (no ease-in-out, use linear or step for TUI feel)

### Delegation navigation

- Clicking a `$ delegate agent_name` line in a parent's stream scrolls/highlights the child agent in its tier column
- The `reports to` field in agent meta is clickable and navigates to the parent agent
- This creates two-way navigation across the hierarchy

### Stream auto-scroll

- Each agent's stream section auto-scrolls to bottom as new content arrives
- Scroll lock activates if user manually scrolls up (show a small "new output below" indicator)
- Auto-scroll resumes when user scrolls back to bottom

### Agent reordering

- As agents change state (start running, finish, error), they re-sort within their tier column
- Active agents bubble to top, completed sink to bottom
- Reordering should be animated (translate Y) to avoid disorienting jumps

---

## ASCII/text conventions

### Connectors

When showing flow between tiers in a simplified view, use ASCII:

```
-------> passes to writer
```

Not arrows, not SVG lines, not unicode arrows. Plain ASCII dashes + greater-than.

### Awaiting states

```
--:--  awaiting input
--:--  not yet spawned
```

Use `--:--` as a null timestamp.

### Tool call prefix

Always prefix with `$`:

```
$ web_search "agentic workflows 2026"
$ delegate research_lead --task="find sources"
$ file_write output.md
```

---

## Do not

- Do not use border-radius on anything, ever
- Do not use box-shadow on anything
- Do not use gradients
- Do not use non-monospace fonts
- Do not use icons or emoji for status (use 6x6 squares)
- Do not use colored backgrounds for cards/containers (everything is transparent against --bg)
- Do not use hover effects that change background color (use underline or opacity shift only)
- Do not use rounded toggles, pill badges, or tag chips
- Do not use modal overlays (use inline expansion or new columns)
- Do not use loading spinners (use text: "loading..." or a blinking cursor character)
- Do not use toast notifications (append to the relevant agent's stream)

---

## File reference

```
papierklammer/
  src/
    styles/
      variables.css     # All CSS custom properties from this doc
      reset.css         # Box-sizing, margin reset
      typography.css    # Font import, type scale classes
      components.css    # Agent blocks, tiers, metrics, command bar
    components/
      TopBar.{tsx/vue}
      MetricsStrip.{tsx/vue}
      TierColumn.{tsx/vue}
      AgentBlock.{tsx/vue}
      AgentStream.{tsx/vue}
      CommandBar.{tsx/vue}
      StatusSquare.{tsx/vue}
```

---

## Quick reference: CSS reset for all elements

```css
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
  border-radius: 0;       /* enforce globally */
  font-family: 'JetBrains Mono', monospace;
}

button, input, textarea, select {
  border-radius: 0;       /* override browser defaults */
  -webkit-appearance: none;
  appearance: none;
}
```
