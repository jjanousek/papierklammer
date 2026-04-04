# GUI Redesign — Validation Contract Assertions

> Milestones: `gui-design-foundation`, `gui-core-pages`, `gui-detail-polish`
> Generated: 2026-04-03

---

## 1. Design Foundation (`gui-design-foundation`)

### VAL-GUI-FOUND-001 — JetBrains Mono loaded globally

| Field       | Value |
|-------------|-------|
| **Title**   | JetBrains Mono font is loaded and applied to all elements |
| **Behavior** | Every visible text element (`body`, `button`, `input`, `textarea`, `select`, `h1`–`h6`, `span`, `p`, `td`, `th`, `label`, `a`) must resolve `font-family` to `JetBrains Mono, monospace`. The Google Fonts stylesheet or local `@font-face` for JetBrains Mono must be present in `<head>`. No element may resolve to a sans-serif or serif family. **Pass**: `getComputedStyle(el).fontFamily` starts with `"JetBrains Mono"` for every sampled element. **Fail**: Any element resolves to a non-monospace family. |
| **Tool**    | agent-browser |
| **Evidence** | Screenshot of the Dashboard page. DOM inspection script that iterates `document.querySelectorAll('*')` and asserts every element's computed `fontFamily` starts with `"JetBrains Mono"`. Console output log attached. |

### VAL-GUI-FOUND-002 — Pink/rose background palette applied

| Field       | Value |
|-------------|-------|
| **Title**   | Primary background uses pink/rose palette (#C4878E base) |
| **Behavior** | The root `<body>` or outermost layout container must have a computed `background-color` that matches `#C4878E` (rgb 196, 135, 142) or a closely adjacent value from the design ramp (`#B07078`, `#8E5A64`, `#6B3F48`, `#D4A0A6`, `#E2BCC0`). **Pass**: `getComputedStyle(document.body).backgroundColor` converts to a hex value within the defined palette. **Fail**: Background is white, gray, blue, or any color outside the rose ramp. |
| **Tool**    | agent-browser |
| **Evidence** | Full-page screenshot. Computed `backgroundColor` value logged from the root layout element. |

### VAL-GUI-FOUND-003 — Zero border-radius globally

| Field       | Value |
|-------------|-------|
| **Title**   | No element has border-radius > 0 |
| **Behavior** | Every rendered element must have `border-radius: 0px` on all four corners. This includes buttons, cards, inputs, textareas, badges, avatars, popovers, dialogs, tooltips, selects, dropdowns, and tabs. The global CSS reset `* { border-radius: 0; }` plus form-element overrides must be present. **Pass**: A script iterating all DOM elements finds zero instances where any computed `borderTopLeftRadius`, `borderTopRightRadius`, `borderBottomLeftRadius`, or `borderBottomRightRadius` is not `"0px"`. **Fail**: Any element has a non-zero border-radius. |
| **Tool**    | agent-browser |
| **Evidence** | DOM audit script output listing total elements checked and confirmation of zero violations. Screenshots of buttons, inputs, badges, and cards showing sharp corners. |

### VAL-GUI-FOUND-004 — Status indicators are 6×6 squares

| Field       | Value |
|-------------|-------|
| **Title**   | Status indicators render as 6×6 pixel squares, never circles |
| **Behavior** | All status indicator elements (`.status-indicator` or the `StatusIcon` component output) must have computed `width: 6px`, `height: 6px`, `border-radius: 0px`, and `display: inline-block` (or equivalent). They must not use `border-radius: 50%` or any rounding. Semantic colors must match: alive = `#82E88A`, error = `#FF6060`, idle = transparent with 1px border. **Pass**: Every status indicator instance on the Agents page and Dashboard has the exact dimensions and zero border-radius. **Fail**: Any indicator is circular, larger than 6×6, or uses incorrect colors. |
| **Tool**    | agent-browser |
| **Evidence** | Close-up screenshot of status indicators. Computed style dump for width, height, borderRadius, and backgroundColor of at least 3 indicator instances (alive, error, idle). |

### VAL-GUI-FOUND-005 — Typography scale: uppercase section labels with letter-spacing

| Field       | Value |
|-------------|-------|
| **Title**   | Section labels use uppercase transform and letter-spacing 1–1.5px |
| **Behavior** | All section header/label elements (tier headers, metric labels, sidebar section headers, page section titles) must have `text-transform: uppercase` and `letter-spacing` between `1px` and `1.5px`. Font size must be 9–10px. Color must be `--fg-dim` (rgba(255,255,255,0.40)). **Pass**: At least 5 distinct section labels on the Dashboard are verified to have the correct computed text-transform, letter-spacing, font-size, and color. **Fail**: Any section label is mixed-case, has zero letter-spacing, or uses incorrect sizing/color. |
| **Tool**    | agent-browser |
| **Evidence** | Screenshot highlighting section labels. Computed style values for text-transform, letter-spacing, font-size, and color for each sampled label. |

### VAL-GUI-FOUND-006 — 1px borders as primary spatial dividers

| Field       | Value |
|-------------|-------|
| **Title**   | All spatial division uses 1px solid borders, no shadows or gradients |
| **Behavior** | Layout sections (top bar, metrics strip, tier columns, sidebar, command bar) are separated by `1px solid` borders using `--border` (rgba(255,255,255,0.18)) or `--border-strong` (rgba(255,255,255,0.32)). No element may use `box-shadow` for spatial separation. No element may use gradients. **Pass**: Visual inspection confirms all dividers are 1px borders. A script querying all elements confirms `boxShadow` is `"none"` everywhere. **Fail**: Any element uses box-shadow, gradient, or border-width > 1px for spatial division. |
| **Tool**    | agent-browser |
| **Evidence** | Full-page screenshot of Dashboard. Script output confirming zero non-`"none"` boxShadow values. Border-width spot-checks on tier column dividers, top bar, metrics strip. |

### VAL-GUI-FOUND-007 — CSS custom properties defined

| Field       | Value |
|-------------|-------|
| **Title**   | Design system CSS variables are defined on :root |
| **Behavior** | The following CSS custom properties must be defined and accessible: `--bg`, `--bg-dark`, `--bg-darker`, `--bg-deep`, `--bg-light`, `--bg-lighter`, `--fg`, `--fg-muted`, `--fg-dim`, `--border`, `--border-strong`, `--alive`, `--warn`, `--dead`, `--font`. **Pass**: `getComputedStyle(document.documentElement).getPropertyValue('--bg')` returns a non-empty value for each variable. **Fail**: Any variable is undefined or empty. |
| **Tool**    | agent-browser |
| **Evidence** | Console output logging each CSS variable name and its resolved value. |

---

## 2. UI Primitives (`gui-design-foundation`)

### VAL-GUI-PRIM-001 — Buttons: transparent background with 1px white border

| Field       | Value |
|-------------|-------|
| **Title**   | Standard buttons have transparent background and 1px solid white border |
| **Behavior** | All primary action buttons (not embedded command buttons) must have `background: transparent` (or `rgba(0,0,0,0)`), `border: 1px solid` matching `--fg` (#FFFFFF), `color: --fg`, `font-family: JetBrains Mono`, `font-size: 11px`, `text-transform: uppercase`, `letter-spacing: 0.5px`, and `border-radius: 0px`. **Pass**: At least 3 button instances across different pages match all criteria. **Fail**: Any button has a non-transparent background, rounded corners, or non-monospace font. |
| **Tool**    | agent-browser |
| **Evidence** | Screenshots of buttons on Dashboard and Agents pages. Computed styles for background, border, color, fontFamily, fontSize, textTransform, letterSpacing, borderRadius. |

### VAL-GUI-PRIM-002 — Inputs: transparent background with 1px border

| Field       | Value |
|-------------|-------|
| **Title**   | Input fields have transparent background and 1px border |
| **Behavior** | All `<input>` and `<textarea>` elements must have `background: transparent`, `border: 1px solid` matching `--border-strong`, `color: --fg`, `font-family: JetBrains Mono`, `font-size: 11px`, `border-radius: 0px`, and `appearance: none`. Placeholder text must use `--fg-dim` color. **Pass**: Command bar input and any form inputs on settings/new-agent pages match all criteria. **Fail**: Any input has a non-transparent background, rounded corners, or non-monospace font. |
| **Tool**    | agent-browser |
| **Evidence** | Screenshot of command bar and any form. Computed styles for background, border, fontFamily, borderRadius on each input. Placeholder color verified via `::placeholder` pseudo-element or computed inspection. |

### VAL-GUI-PRIM-003 — Tabs: active state shows correctly

| Field       | Value |
|-------------|-------|
| **Title**   | Tab components show correct active/inactive styling |
| **Behavior** | Inactive tabs must have `color: --fg-muted` and transparent/no background. Active tabs must have either `color: --fg` with `background: --bg-dark` OR `border-bottom: 1px solid --fg`. No border-radius on any tab. Font size must be 11px. **Pass**: On the Dashboard top bar, clicking between tabs changes styling correctly; active tab is visually distinct. **Fail**: Active tab has no visual distinction, uses rounded corners, or incorrect colors. |
| **Tool**    | agent-browser |
| **Evidence** | Screenshot before and after tab click. Computed styles for active and inactive tab (color, background, borderBottom, borderRadius). |

### VAL-GUI-PRIM-004 — Badges: sharp corners, correct typography

| Field       | Value |
|-------------|-------|
| **Title**   | Badge elements have zero border-radius and monospace font |
| **Behavior** | All badge/tag elements (tier badges, status badges, count badges) must have `border-radius: 0px`, `font-family: JetBrains Mono`, and appropriate sizing (9px for tier badges). Tier badges specifically must have `background: --bg-darker`, padding 2px 6px. **Pass**: All badge instances on Dashboard tier headers have correct styles. **Fail**: Any badge has rounded corners or non-monospace font. |
| **Tool**    | agent-browser |
| **Evidence** | Close-up screenshot of tier badges. Computed styles for borderRadius, fontFamily, background, padding. |

### VAL-GUI-PRIM-005 — No loading spinners; text-based loading indicators

| Field       | Value |
|-------------|-------|
| **Title**   | Loading states use text ("loading...") or blinking cursor, not spinners |
| **Behavior** | When data is loading, the UI must show text-based indicators such as `"loading..."` or a blinking cursor character. No CSS animation-based spinners, SVG spinners, or rotating icons are permitted. **Pass**: Throttling network to slow 3G and navigating to Dashboard shows text-based loading. **Fail**: Any spinning/rotating animation is visible during loading. |
| **Tool**    | agent-browser |
| **Evidence** | Screenshot captured during loading state with network throttling. DOM inspection confirming absence of `@keyframes spin` or `animation: spin` on any element. |

---

## 3. Dashboard (`gui-core-pages`)

### VAL-GUI-DASH-001 — Tier-column layout renders agents by hierarchy

| Field       | Value |
|-------------|-------|
| **Title**   | Dashboard renders horizontal tier columns grouping agents by hierarchy |
| **Behavior** | The Dashboard main content area must display a horizontal column layout with distinct tiers: Executive (leftmost), Leads (middle), Workers (rightmost). Each tier is a `flex` column separated by 1px vertical borders. Tier headers show uppercase labels with rank badges. Agents appear within their respective tier columns. **Pass**: With at least 3 agents of different hierarchy levels, the Dashboard shows them in separate tier columns, left-to-right by authority. **Fail**: Agents are shown in a flat grid/list without tier grouping. |
| **Tool**    | agent-browser |
| **Evidence** | Full-width screenshot of Dashboard with multiple agents. DOM structure showing tier column containers with correct flex proportions (executive ~flex:3, leads ~flex:2.5, workers ~flex:4). |

### VAL-GUI-DASH-002 — Metrics strip with monospace values

| Field       | Value |
|-------------|-------|
| **Title**   | Metrics strip shows values in monospace at correct typography scale |
| **Behavior** | A horizontal metrics strip must render directly below the top bar, with equal-width cells separated by 1px borders. Each cell shows a label (9px, uppercase, `--fg-dim`) and a value (15–16px, weight 500, `--fg`). All text is JetBrains Mono. Metrics include at minimum: total tokens, agents, depth, elapsed, cost. **Pass**: Metrics strip is visible with correct layout and typography. **Fail**: Metrics are missing, use incorrect font sizes, or lack border separation. |
| **Tool**    | agent-browser |
| **Evidence** | Screenshot of metrics strip. Computed styles for label (fontSize, textTransform, color) and value (fontSize, fontWeight, color) elements within at least 2 metric cells. |

### VAL-GUI-DASH-003 — Agent blocks expand and collapse

| Field       | Value |
|-------------|-------|
| **Title**   | Idle agent blocks expand on click and collapse on second click |
| **Behavior** | Idle/completed agents render as a single collapsed line (~28px height) showing name, status, and time. Clicking a collapsed idle agent expands it to show stream output and metadata. Clicking again collapses it. Active/running agents are always expanded and cannot be collapsed. Expansion uses a linear or step height transition (no ease-in-out). **Pass**: Clicking an idle agent toggles between collapsed (single-line) and expanded (multi-line with stream) states. Active agents remain expanded. **Fail**: No expand/collapse behavior, or ease-in-out animation is used. |
| **Tool**    | agent-browser |
| **Evidence** | Sequential screenshots: (1) collapsed idle agent, (2) same agent after click (expanded), (3) same agent after second click (collapsed again). Video or frame sequence showing linear/step transition. |

### VAL-GUI-DASH-004 — Stream content color coding

| Field       | Value |
|-------------|-------|
| **Title**   | Agent stream content uses correct color coding for content types |
| **Behavior** | Within an expanded agent's stream section: reasoning/thought text uses `--fg-muted` (rgba(255,255,255,0.68)), tool calls use `--warn` (#E8D560) with `$` prefix, tool results use `--fg-dim` (rgba(255,255,255,0.40)) indented 12px, delegation events use `--alive` (#82E88A), errors use `--dead` (#FF6060). **Pass**: Stream content with mixed types shows correct colors for each type. **Fail**: All stream text is the same color, or colors don't match the design system. |
| **Tool**    | agent-browser |
| **Evidence** | Screenshot of an expanded agent with mixed stream content. Computed `color` values for at least one element of each content type (thought, tool-call, tool-result, delegation if present). |

### VAL-GUI-DASH-005 — Top bar with logo and tabs

| Field       | Value |
|-------------|-------|
| **Title**   | Top bar renders logo and navigation tabs per design system |
| **Behavior** | A single-row top bar (34–36px height) spans the full width. Left cell shows "PAPIERKLAMMER" in 12–13px, weight 700, uppercase, letter-spacing 0.5px, with `--bg-darker` background. Tab cells follow with 1px border separation. Right-aligned status area shows active/idle agent counts. All cells use 1px borders, no padding between cells. **Pass**: Top bar matches the design system layout. **Fail**: Top bar uses different layout, incorrect logo styling, or tab arrangement. |
| **Tool**    | agent-browser |
| **Evidence** | Screenshot of top bar. Computed styles for logo (fontSize, fontWeight, textTransform, letterSpacing, background) and tab cells. Height measurement of the top bar container. |

### VAL-GUI-DASH-006 — Agent sorting within tiers

| Field       | Value |
|-------------|-------|
| **Title**   | Agents within tier columns are sorted by activity state |
| **Behavior** | Within each tier column, agents are ordered: (1) active/running first (sorted by elapsed time, longest first), (2) waiting/queued second, (3) idle/completed last (sorted by most recently active first). **Pass**: With a mix of active and idle agents, active agents appear above idle agents in their respective columns. **Fail**: Agents are in alphabetical or random order regardless of state. |
| **Tool**    | agent-browser |
| **Evidence** | Screenshot of a tier column with both active and idle agents. DOM order inspection showing active agents precede idle agents. |

### VAL-GUI-DASH-007 — Command bar docked at bottom

| Field       | Value |
|-------------|-------|
| **Title**   | Command bar is docked at the bottom of the viewport, full width |
| **Behavior** | A command bar (36–38px height) is pinned to the bottom of the Dashboard view. It shows a prefix cell ("EXEC" with `--bg-dark` background), a transparent input field spanning the remaining width, and a "RUN" button with `--bg-darker` background. All separated by 1px borders. **Pass**: Command bar is visible at the bottom, with correct layout and styling. **Fail**: No command bar, or it's not bottom-docked. |
| **Tool**    | agent-browser |
| **Evidence** | Screenshot showing the bottom portion of the Dashboard with command bar visible. Computed styles for the prefix cell, input, and run button. |

---

## 4. Agents Page (`gui-core-pages`)

### VAL-GUI-AGENTS-001 — Agent list with monospace names and square status indicators

| Field       | Value |
|-------------|-------|
| **Title**   | Agents page shows agent names in monospace with 6×6 square status indicators |
| **Behavior** | Each agent row in the list view must show: agent name in JetBrains Mono (11–12px, weight 500), a 6×6 square status indicator (not a circle) with correct semantic color, and agent state text in `--fg-dim`. **Pass**: All agent rows show monospace names and square indicators with correct colors. **Fail**: Names use non-monospace font, indicators are circles, or colors are incorrect. |
| **Tool**    | agent-browser |
| **Evidence** | Screenshot of the Agents list. Computed styles for agent name (fontFamily, fontSize, fontWeight) and status indicator (width, height, borderRadius, backgroundColor) for at least 2 agents. |

### VAL-GUI-AGENTS-002 — Org view with horizontal tier columns

| Field       | Value |
|-------------|-------|
| **Title**   | Agents org view shows horizontal tier columns matching Dashboard layout |
| **Behavior** | When viewing agents in org/hierarchy mode, the layout must display horizontal tier columns (Executive | Leads | Workers) separated by 1px vertical borders. Same tier column structure as the Dashboard. Tier headers show uppercase labels with rank badges. **Pass**: Org view renders distinct tier columns with agents grouped by hierarchy. **Fail**: Org view uses a tree diagram, flat list, or non-column layout. |
| **Tool**    | agent-browser |
| **Evidence** | Screenshot of Agents page in org view mode. DOM structure showing tier column containers. |

### VAL-GUI-AGENTS-003 — Filter tabs styled per design system

| Field       | Value |
|-------------|-------|
| **Title**   | Agent filter/view tabs use design system tab styling |
| **Behavior** | Filter tabs (e.g., "All", "Active", "Idle", or view toggles like "List"/"Org") must follow the tab styling: inactive = `--fg-muted`, active = `--fg` with `--bg-dark` or bottom border, no border-radius, 11px font size, JetBrains Mono. **Pass**: Filter tabs match design system tab specification. **Fail**: Tabs use pill shapes, non-monospace font, or incorrect colors. |
| **Tool**    | agent-browser |
| **Evidence** | Screenshot of filter tabs in both states. Computed styles for active and inactive tab elements. |

---

## 5. Issues Page (`gui-core-pages`)

### VAL-GUI-ISSUES-001 — Issue rows with monospace text and square status indicators

| Field       | Value |
|-------------|-------|
| **Title**   | Issue list rows show monospace text and square status indicators |
| **Behavior** | Each issue row must display: issue title/ID in JetBrains Mono, a 6×6 square status indicator with semantic color (not a circle), assignee and metadata in monospace. Rows are separated by 1px borders. **Pass**: All issue rows use monospace font and square indicators. **Fail**: Any text is non-monospace, indicators are circular, or row dividers are not 1px borders. |
| **Tool**    | agent-browser |
| **Evidence** | Screenshot of Issues list with multiple issues. Computed styles for issue title (fontFamily), status indicator (width, height, borderRadius), and row borders. |

### VAL-GUI-ISSUES-002 — Kanban cards with sharp corners and rose borders

| Field       | Value |
|-------------|-------|
| **Title**   | Kanban board cards have zero border-radius and rose-palette borders |
| **Behavior** | When viewing issues in kanban mode, each card must have `border-radius: 0px`, `border: 1px solid` using `--border-strong` or similar rose-palette border color. Card background must be transparent (against `--bg`). Card text uses JetBrains Mono. Column headers use uppercase, letter-spacing 1–1.5px. **Pass**: All kanban cards have sharp corners and rose-tinted borders. **Fail**: Any card has rounded corners, shadow, or non-rose border color. |
| **Tool**    | agent-browser |
| **Evidence** | Screenshot of kanban board. Computed styles for card borderRadius, border color, background. Column header text-transform and letter-spacing. |

### VAL-GUI-ISSUES-003 — Search/filter with brutalist styling

| Field       | Value |
|-------------|-------|
| **Title**   | Issue search and filter controls use brutalist design system styling |
| **Behavior** | The search input must have transparent background, 1px border, no border-radius, monospace font. Filter dropdowns/buttons must have sharp corners, transparent backgrounds, 1px borders. No shadows or rounded elements in the filter area. **Pass**: Search input and all filter controls match design system input/button primitives. **Fail**: Search or filter controls have rounded corners, shadows, or non-monospace fonts. |
| **Tool**    | agent-browser |
| **Evidence** | Screenshot of the Issues page header/filter area. Computed styles for the search input and at least one filter control (borderRadius, background, border, fontFamily). |

---

## 6. Agent Detail (`gui-detail-polish`)

### VAL-GUI-AGDET-001 — Agent header with brutalist styling

| Field       | Value |
|-------------|-------|
| **Title**   | Agent detail header uses brutalist design system styling |
| **Behavior** | The agent header must show: agent name (11–12px, weight 500, JetBrains Mono), status indicator (6×6 square), key-value metadata pairs (key in `--fg-dim` 10px, value in `--fg` 10px). No border-radius on any header element. Background transparent against `--bg`. Borders separate sections. **Pass**: Agent detail header matches design system agent block header spec. **Fail**: Header uses non-monospace font, circular indicators, or rounded elements. |
| **Tool**    | agent-browser |
| **Evidence** | Screenshot of agent detail header. Computed styles for name, status indicator, and at least 2 key-value pairs. |

### VAL-GUI-AGDET-002 — Tab bar per design system

| Field       | Value |
|-------------|-------|
| **Title**   | Agent detail tab bar follows design system tab specification |
| **Behavior** | The tab bar on the agent detail page (e.g., "Overview", "Runs", "Config") must follow the same tab styling as described in VAL-GUI-PRIM-003: inactive = `--fg-muted`, active = `--fg` with distinct background or bottom border, no border-radius, 11px monospace. **Pass**: Tabs match the design system. **Fail**: Tabs have rounded corners, non-monospace font, or incorrect active styling. |
| **Tool**    | agent-browser |
| **Evidence** | Screenshot of agent detail tab bar. Computed styles for active and inactive tabs. |

### VAL-GUI-AGDET-003 — Run transcript in terminal style

| Field       | Value |
|-------------|-------|
| **Title**   | Run transcript/stream view renders in terminal-style monospace |
| **Behavior** | The run transcript view must display stream content in JetBrains Mono with the same color coding as VAL-GUI-DASH-004 (reasoning = `--fg-muted`, tool calls = `--warn` with `$` prefix, tool results = `--fg-dim` indented, errors = `--dead`). Background transparent against `--bg`. No border-radius on the transcript container. Line height 1.7–1.8. Stream entries separated by 2–3px margin-bottom. **Pass**: Transcript text uses monospace font with correct stream color coding. **Fail**: Non-monospace font, incorrect colors, or rounded container. |
| **Tool**    | agent-browser |
| **Evidence** | Screenshot of a run transcript with mixed content types. Computed styles for fontFamily, color of each content type, lineHeight, container borderRadius. |

### VAL-GUI-AGDET-004 — Metrics with monospace values

| Field       | Value |
|-------------|-------|
| **Title**   | Agent detail metrics use monospace values with correct typography |
| **Behavior** | Metric values on the agent detail page (e.g., token count, cost, run time) must use JetBrains Mono, 15–16px, weight 500, `--fg` color. Metric labels must be 9px, uppercase, letter-spacing 1px, `--fg-dim` color. **Pass**: All metrics match the design system metric cell specification. **Fail**: Metrics use non-monospace font, incorrect sizes, or incorrect label styling. |
| **Tool**    | agent-browser |
| **Evidence** | Screenshot of agent metrics section. Computed styles for at least 2 metric value elements and their labels. |

---

## 7. Issue Detail (`gui-detail-polish`)

### VAL-GUI-ISSDET-001 — Monospace inline editors

| Field       | Value |
|-------------|-------|
| **Title**   | Inline editors on issue detail use monospace font with brutalist styling |
| **Behavior** | Inline edit fields for issue title, description, and other editable properties must use JetBrains Mono, transparent background, 1px border on focus, no border-radius. When not editing, text displays in monospace at the same position without visible input chrome. **Pass**: Clicking an editable field shows a monospace input with transparent background, 1px border, and sharp corners. **Fail**: Inline editor uses non-monospace font, has rounded corners, or non-transparent background. |
| **Tool**    | agent-browser |
| **Evidence** | Screenshots: (1) issue title in display mode, (2) issue title in edit mode after click. Computed styles of the edit input (fontFamily, background, border, borderRadius). |

### VAL-GUI-ISSDET-002 — Terminal-style comment thread

| Field       | Value |
|-------------|-------|
| **Title**   | Comment thread renders in terminal style with monospace text |
| **Behavior** | Comments on the issue detail page must render in JetBrains Mono with monospace styling. Each comment shows author name in `--fg` (weight 500), timestamp in `--fg-dim`, content in `--fg-muted`. Comments separated by 1px borders. Comment input area follows the input primitive spec (transparent, 1px border, no radius). **Pass**: Comments use monospace font with correct hierarchy colors and border separation. **Fail**: Comments use non-monospace font, have rounded containers, or use card-like styling with shadows. |
| **Tool**    | agent-browser |
| **Evidence** | Screenshot of comment thread with at least 2 comments. Computed styles for author name, timestamp, content text, and the comment input field. |

### VAL-GUI-ISSDET-003 — Brutalist properties panel

| Field       | Value |
|-------------|-------|
| **Title**   | Issue properties panel uses brutalist key-value layout |
| **Behavior** | The properties panel must display fields (status, priority, assignee, etc.) as key-value pairs: key in `--fg-dim` 10px, value in `--fg` 10px, all JetBrains Mono. No rounded dropdowns, pill badges, or card containers. Property rows separated by borders or tight vertical spacing (line-height 1.7–1.8). **Pass**: Properties panel matches the design system key-value pair specification. **Fail**: Properties use non-monospace font, rounded dropdowns, or card-like containers. |
| **Tool**    | agent-browser |
| **Evidence** | Screenshot of the properties panel. Computed styles for key and value elements (fontFamily, fontSize, color). BorderRadius check on any interactive elements (dropdowns, selectors). |

### VAL-GUI-ISSDET-004 — Sharp-cornered attachment area

| Field       | Value |
|-------------|-------|
| **Title**   | Attachment/documents section has zero border-radius |
| **Behavior** | The attachment or documents section on the issue detail page must have `border-radius: 0px` on all containers, buttons, and file cards. Upload buttons follow the button primitive spec (transparent, 1px border). File thumbnails or cards have sharp corners. **Pass**: All attachment area elements have zero border-radius. **Fail**: Any element in the attachment area has rounded corners. |
| **Tool**    | agent-browser |
| **Evidence** | Screenshot of the attachment/documents section. Computed borderRadius for the container, any file cards, and the upload button. |

---

## 8. Layout & Navigation (`gui-detail-polish`)

### VAL-GUI-LAYOUT-001 — Sidebar with monospace nav items

| Field       | Value |
|-------------|-------|
| **Title**   | Sidebar navigation uses monospace font per design system |
| **Behavior** | All sidebar navigation items must use JetBrains Mono, 12px, weight 500 (active) or 400 (inactive). Active items use `--fg` color, inactive use `--fg-muted`. Section headers are 9–10px uppercase with letter-spacing 1–1.5px in `--fg-dim`. Sidebar background is `--bg` or transparent. No rounded hover states; hover uses underline or opacity shift only. Border-right separates sidebar from main content (1px). **Pass**: All sidebar text is monospace with correct sizing and color hierarchy. **Fail**: Sidebar uses non-monospace font, rounded hover effects, or incorrect colors. |
| **Tool**    | agent-browser |
| **Evidence** | Screenshot of sidebar in its default state. Computed styles for active nav item, inactive nav item, and section header (fontFamily, fontSize, fontWeight, color, textTransform, letterSpacing). Hover state screenshot or DOM inspection confirming no border-radius on hover. |

### VAL-GUI-LAYOUT-002 — CompanyRail with square icons

| Field       | Value |
|-------------|-------|
| **Title**   | CompanyRail company icons are square (no border-radius) |
| **Behavior** | The CompanyRail (leftmost vertical rail with company icons) must render all company icons/avatars as squares with `border-radius: 0px`. Active company indicator uses a 1px border highlight, not a rounded selection ring. The rail is separated from the sidebar by a 1px border. **Pass**: All company icons in the rail are square. Active indicator has sharp corners. **Fail**: Any company icon has rounded corners or circular shape. |
| **Tool**    | agent-browser |
| **Evidence** | Screenshot of CompanyRail with multiple companies. Computed borderRadius for company icon elements. Active vs. inactive company indicator styles. |

### VAL-GUI-LAYOUT-003 — Breadcrumbs with monospace separators

| Field       | Value |
|-------------|-------|
| **Title**   | Breadcrumb navigation uses monospace font and ASCII separators |
| **Behavior** | Breadcrumb trail must use JetBrains Mono for all text. Separators must be ASCII characters (e.g., `/`, `>`, or `->`) rather than SVG icons or unicode arrows. Breadcrumb links use `--fg-muted` with the last (current) item in `--fg`. No rounded badges or pill shapes around breadcrumb items. **Pass**: Breadcrumbs are fully monospace with ASCII separators and correct color hierarchy. **Fail**: Non-monospace font, SVG/icon separators, or rounded breadcrumb items. |
| **Tool**    | agent-browser |
| **Evidence** | Screenshot of breadcrumb trail on a detail page. Computed fontFamily for breadcrumb text. Separator character inspection (textContent of separator elements). |

### VAL-GUI-LAYOUT-004 — Command palette / command bar at bottom

| Field       | Value |
|-------------|-------|
| **Title**   | Command bar is consistently available at bottom across pages |
| **Behavior** | The command bar (36–38px) must be visible at the bottom of every page, not just the Dashboard. It maintains the same layout: prefix cell, transparent input, action button, all separated by 1px borders. The bar remains fixed/docked at the viewport bottom. **Pass**: Command bar is present and correctly styled on Dashboard, Agents, and Issues pages. **Fail**: Command bar is missing on any page or has inconsistent styling. |
| **Tool**    | agent-browser |
| **Evidence** | Screenshots of the bottom of Dashboard, Agents, and Issues pages showing the command bar. |

---

## 9. Cross-Area Assertions

### VAL-GUI-CROSS-001 — Dashboard to Agent Detail navigation preserves design system

| Field       | Value |
|-------------|-------|
| **Title**   | Navigating from Dashboard to Agent Detail preserves all design system rules |
| **Behavior** | Starting on the Dashboard, clicking an agent name/block navigates to the Agent Detail page. During and after navigation: (1) no flash of unstyled content, (2) Agent Detail page uses the same rose palette background, (3) all text remains JetBrains Mono, (4) no elements gain border-radius, (5) status indicators remain 6×6 squares, (6) sidebar and layout frame remain consistent. **Pass**: Agent Detail page fully matches design system after navigation from Dashboard. **Fail**: Any design system violation is visible on the Agent Detail page. |
| **Tool**    | agent-browser |
| **Evidence** | Sequential screenshots: (1) Dashboard with agent visible, (2) Agent Detail page after click. Spot-check computed styles on Agent Detail: body background, a text element's fontFamily, a status indicator's dimensions, a button's borderRadius. |

### VAL-GUI-CROSS-002 — Issues to Issue Detail navigation preserves design system

| Field       | Value |
|-------------|-------|
| **Title**   | Navigating from Issues page to Issue Detail preserves all design system rules |
| **Behavior** | Starting on the Issues page, clicking an issue navigates to the Issue Detail page. During and after navigation: (1) no flash of unstyled content, (2) Issue Detail uses the same rose palette background, (3) all text remains JetBrains Mono, (4) no elements gain border-radius, (5) properties panel uses brutalist key-value layout, (6) layout frame remains consistent. **Pass**: Issue Detail page fully matches design system after navigation from Issues. **Fail**: Any design system violation is visible on the Issue Detail page. |
| **Tool**    | agent-browser |
| **Evidence** | Sequential screenshots: (1) Issues list with issue visible, (2) Issue Detail page after click. Spot-check computed styles on Issue Detail: body background, text fontFamily, properties panel layout, comment thread styling. |

### VAL-GUI-CROSS-003 — Consistent font/color/border treatment across all pages

| Field       | Value |
|-------------|-------|
| **Title**   | All pages maintain consistent JetBrains Mono, rose palette, and 1px border treatment |
| **Behavior** | Navigate through all core pages in sequence: Dashboard → Agents → Issues → Agent Detail → Issue Detail. On each page, verify: (1) `document.body` background matches rose palette, (2) a sample of 10 random text elements all resolve to JetBrains Mono, (3) no element has `borderRadius > 0`, (4) no element has non-`"none"` `boxShadow`, (5) all divider borders are 1px. **Pass**: All 5 checks pass on every page. **Fail**: Any check fails on any page. |
| **Tool**    | agent-browser |
| **Evidence** | Per-page summary table showing pass/fail for each of the 5 checks. Script output from each page. Final composite screenshot collage of all 5 pages. |

### VAL-GUI-CROSS-004 — No hover effects that change background color

| Field       | Value |
|-------------|-------|
| **Title**   | Hover states use underline or opacity shift only, never background color changes |
| **Behavior** | Per the design system: "Do not use hover effects that change background color (use underline or opacity shift only)." On the Dashboard sidebar nav items, agent names, issue rows, and buttons, hovering must not cause a background-color change. Hover may add underline or adjust opacity. **Pass**: Hovering over interactive elements shows no background-color change. **Fail**: Any element shows a background-color change on hover. |
| **Tool**    | agent-browser |
| **Evidence** | Screenshots of sidebar nav item, agent name, and button in default and hovered states. Computed `backgroundColor` comparison before and after hover for each element. |

---

## Vitest Component Logic Assertions

### VAL-GUI-FOUND-VT-001 — StatusIcon component renders square indicator

| Field       | Value |
|-------------|-------|
| **Title**   | StatusIcon component renders a square, not a circle |
| **Behavior** | Unit test renders `<StatusIcon status="alive" />`, `<StatusIcon status="error" />`, and `<StatusIcon status="idle" />`. Asserts that the rendered indicator element has no `rounded-full` class, has dimensions of 6px × 6px (via class or inline style), and has appropriate background color class. **Pass**: Test passes for all three status values. **Fail**: Any indicator has a `rounded-full` class or incorrect dimensions. |
| **Tool**    | vitest |
| **Evidence** | Vitest test output showing pass/fail. Test file at `ui/src/components/StatusIcon.test.tsx`. |

### VAL-GUI-DASH-VT-001 — Dashboard groups agents into tier columns

| Field       | Value |
|-------------|-------|
| **Title**   | Dashboard component logic groups agents by hierarchy into tier columns |
| **Behavior** | Unit test renders `<Dashboard />` with mock data containing agents at different hierarchy levels (tier 0, 1, 2). Asserts that the DOM contains separate tier column containers, each containing only agents of the corresponding tier. **Pass**: Agents are distributed into the correct tier containers. **Fail**: All agents appear in a single container or are ungrouped. |
| **Tool**    | vitest |
| **Evidence** | Vitest test output. Test file at `ui/src/pages/Dashboard.test.tsx`. |

### VAL-GUI-DASH-VT-002 — Agent sorting within tier columns by activity state

| Field       | Value |
|-------------|-------|
| **Title**   | Agents within a tier column are sorted active-first, then idle |
| **Behavior** | Unit test provides mock agents with mixed states (running, idle, completed) within the same tier. Asserts that within the rendered tier column, running agents appear before idle agents in DOM order. **Pass**: DOM order matches activity-based sort. **Fail**: Agents appear in incorrect order. |
| **Tool**    | vitest |
| **Evidence** | Vitest test output. Test file at `ui/src/pages/Dashboard.test.tsx`. |

### VAL-GUI-ISSUES-VT-001 — Issue rows render with correct status indicators

| Field       | Value |
|-------------|-------|
| **Title**   | IssueRow component renders square status indicators with correct semantic colors |
| **Behavior** | Unit test renders `<IssueRow />` with issues in different statuses (backlog, in_progress, done, blocked). Asserts each row's status indicator element has no `rounded-full` class and has the correct background color class mapping. **Pass**: All status indicators are square with correct colors. **Fail**: Any indicator is circular or has incorrect color. |
| **Tool**    | vitest |
| **Evidence** | Vitest test output. Test file at `ui/src/components/IssueRow.test.tsx`. |
