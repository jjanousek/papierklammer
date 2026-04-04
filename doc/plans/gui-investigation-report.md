# GUI Investigation Report — Papierklammer Design System Gaps

**Date**: 2026-04-03  
**Scope**: Full audit of `ui/src/` for bugs, disconnected buttons, missing design system, and theme readiness.

---

## 1. Full Page Inventory

### Routes (from `ui/src/App.tsx` → `boardRoutes()`)

| # | Route | Page Component | Design System Status |
|---|-------|---------------|---------------------|
| 1 | `/dashboard` | Dashboard | ✅ **Fully styled** — custom papierklammer components (TopBar, MetricsStrip, TierColumn, AgentBlock) using `var(--bg)`, `var(--fg)`, etc. |
| 2 | `/agents/*` | Agents | ✅ **Fully styled** — uses design system tokens |
| 3 | `/agents/:agentId` | AgentDetail | ✅ **Fully styled** — uses design system tokens |
| 4 | `/issues` | Issues | ✅ **Fully styled** — uses design system tokens |
| 5 | `/issues/:issueId` | IssueDetail | ✅ **Fully styled** — uses design system tokens |
| 6 | Layout/Sidebar | Layout, Sidebar, SidebarNavItem | ✅ **Fully styled** — uses `var(--bg)`, `var(--fg-muted)`, `var(--border)` |
| 7 | `/projects` | Projects | ⚠️ **Partially styled** — uses shadcn components with CSS variable mapping; standard Tailwind classes |
| 8 | `/projects/:projectId` | ProjectDetail | ⚠️ **Partially styled** — uses `rounded-lg`, `shadow-lg`, `rounded-md` (harmless due to CSS override); has hardcoded colors like `border-amber-500/20 bg-amber-500/5`, `border-red-500/30 bg-red-500/10` |
| 9 | `/routines` | Routines | ⚠️ **Partially styled** — uses standard shadcn; has `shadow-sm` on toggle, `bg-amber-100`, `bg-amber-900/30` |
| 10 | `/routines/:routineId` | RoutineDetail | ⚠️ **Partially styled** — `rounded-lg`, `shadow-sm`, `bg-emerald-500`, `bg-blue-500/5`, `text-emerald-400` |
| 11 | `/goals` | Goals | ⚠️ **Partially styled** — standard shadcn, no hardcoded colors |
| 12 | `/goals/:goalId` | GoalDetail | ⚠️ **Partially styled** — standard shadcn |
| 13 | `/approvals/*` | Approvals | ⚠️ **Partially styled** — uses `bg-yellow-500/20 text-yellow-500` for pending badge |
| 14 | `/approvals/:id` | ApprovalDetail | ⚠️ **Partially styled** — `border-green-300`, `bg-green-50`, `bg-green-700`, `rounded-lg` |
| 15 | `/costs` | Costs | ⚠️ **Partially styled** — uses `bg-emerald-400`, `bg-yellow-400`, `bg-red-400` for budget bars; complex layout using Card components |
| 16 | `/activity` | Activity | ⚠️ **Partially styled** — standard shadcn, minimal hardcoded colors |
| 17 | `/inbox/*` | Inbox | ⚠️ **Partially styled** — `rounded-xl`, `rounded-md`, `bg-red-500/20`, `bg-green-700`, `bg-red-600` |
| 18 | `/company/settings` | CompanySettings | ⚠️ **Partially styled** — `rounded-md`, standard shadcn; `border-destructive/40 bg-destructive/5` |
| 19 | `/skills/*` | CompanySkills | ⚠️ **Partially styled** — standard shadcn with custom layouts |
| 20 | `/company/export/*` | CompanyExport | ⚠️ **Partially styled** — `rounded-md`, `rounded-lg`, `border-amber-500/30 bg-amber-500/5` |
| 21 | `/company/import` | CompanyImport | ⚠️ **Partially styled** — `rounded-md`, `bg-emerald-500/5`, `border-amber-500/30` |
| 22 | `/org` | OrgChart | ⚠️ **Partially styled** — `rounded-lg`, `shadow-sm`, `shadow-md` on org cards; status dots use hardcoded hex colors |
| 23 | `/agents/new` | NewAgent | ⚠️ **Partially styled** — standard shadcn form components |
| 24 | `/design-guide` | DesignGuide | ⚠️ **Partially styled** — uses many hardcoded Tailwind colors (`bg-blue-100`, `bg-violet-100`, `bg-cyan-100`, etc.) |
| 25 | `/companies` | Companies | ⚠️ **Partially styled** — `bg-green-500/10`, `bg-yellow-500/10` |
| 26 | `/instance/settings/general` | InstanceGeneralSettings | ⚠️ **Partially styled** — standard shadcn |
| 27 | `/instance/settings/heartbeats` | InstanceSettings | ⚠️ **Partially styled** — standard shadcn |
| 28 | `/instance/settings/experimental` | InstanceExperimentalSettings | ⚠️ **Partially styled** — `rounded-xl`, `bg-green-600`, `rounded-md` |
| 29 | `/instance/settings/plugins` | PluginManager | ⚠️ **Partially styled** — `rounded-lg`, `bg-green-600`, `bg-amber-500/5`, `bg-red-500/[0.06]` |
| 30 | `/instance/settings/plugins/:id` | PluginSettings | ⚠️ **Partially styled** |
| 31 | `/plugins/:pluginId` | PluginPage | ⚠️ **Partially styled** — `rounded-md` |
| 32 | `/tests/ux/runs` | RunTranscriptUxLab | ⚠️ **Partially styled** — `bg-cyan-500/*`, `border-cyan-500/*` |
| 33 | `/execution-workspaces/:id` | ExecutionWorkspaceDetail | ⚠️ **Partially styled** — `rounded-xl`, `bg-emerald-500/10` |
| 34 | `/projects/:id/workspaces/:id` | ProjectWorkspaceDetail | ⚠️ **Partially styled** — `rounded-xl`, `bg-emerald-500/10` |
| 35 | `/auth` | AuthPage | Not in main layout (standalone) |
| 36 | `/board-claim/:token` | BoardClaimPage | Not in main layout (standalone) |
| 37 | `/cli-auth/:id` | CliAuthPage | Not in main layout (standalone) |
| 38 | `/invite/:token` | InviteLandingPage | Not in main layout — `rounded-lg`, `rounded-md` |
| 39 | `*` | NotFoundPage | ⚠️ — `rounded-lg`, `rounded-md` |

**Note**: The global CSS (`border-radius: 0 !important`, `font-family: var(--font) !important`) means pages using `rounded-*` classes render correctly. The design system gaps are primarily about **hardcoded Tailwind colors** that bypass CSS variables and **shadows**.

---

## 2. Disconnected / Non-functional Buttons

### Dashboard TopBar — "history" and "config" tabs
- **File**: `ui/src/components/TopBar.tsx` (line 4: `const tabs: TopBarTab[] = ["pipeline", "history", "config"]`)
- **File**: `ui/src/pages/Dashboard.tsx` (line 8: `const [activeTab, setActiveTab] = useState<TopBarTab>("pipeline")`)
- **Bug**: The "history" and "config" tabs render and can be clicked (they change the `activeTab` state) but **nothing different renders**. The Dashboard only shows the pipeline view regardless of tab. These are dead buttons.
- **Severity**: HIGH — very visible on the main page.

### AgentBlock — Agent name is NOT clickable for navigation
- **File**: `ui/src/components/AgentBlock.tsx`
- **Bug**: Agent names in Dashboard AgentBlocks do not navigate to the agent detail page. The entire block only toggles expand/collapse. There is no `useNavigate`, no `Link`, no import of `agentUrl`.
- **Severity**: HIGH — specifically requested by user.

---

## 3. Dashboard-Specific Issues

### 3a. Reasoning Traces / Transcripts in Dashboard
- **File**: `ui/src/components/AgentBlock.tsx` → `StreamLine` component (lines 119-138)
- **Current behavior**: The stream entries display with basic color coding:
  - `reasoning` → `var(--fg-muted)` (white 68% opacity)
  - `tool_call` → `var(--warn)` (yellow) with `$ ` prefix
  - `tool_result` → `var(--fg-dim)` (white 40% opacity), indented
  - `delegation` → `var(--alive)` (green)
  - `error` → `var(--dead)` (red)
- **Issues**:
  1. Tool calls only show the tool name, not what was called (e.g., just "Read" not "Read /path/to/file")
  2. Reasoning text is truncated to 120 chars (`entry.text.slice(0, 120)`) — no way to expand
  3. No visual grouping or separation between different entry types
  4. No click-to-expand for full content
  5. No differentiation between thinking/reasoning and assistant output (both map to "reasoning")
  6. The stream section header "REASONING + ACTIONS" is static text, not interactive

### 3b. Agent Name Navigation
- As noted above, clicking agent names does NOT navigate to `/agents/:agentId`. The click only toggles expand/collapse.

### 3c. Missing Stream Content
- Stream entries are limited to `MAX_STREAM_ENTRIES_PER_AGENT = 8` entries per agent
- `transcriptToStreamEntries()` in Dashboard.tsx only maps: thinking/assistant → reasoning, tool_call, tool_result, stderr → error, system (delegation). It drops `user`, `init`, `result`, and `stdout` entries.
- Tool results are truncated to 120 chars with no way to see more

---

## 4. Theme Integration Analysis

### Current State
- **ThemeContext** exists (`ui/src/context/ThemeContext.tsx`) but only supports `"light" | "dark"` toggle
- The light/dark toggle button is in `Layout.tsx` (bottom of sidebar)
- **CSS** defines only one color scheme (rose/mauve) in `:root` and `.dark` blocks
- There is no `data-theme` attribute mechanism
- No theme selector UI exists

### Theme Definition Files Already Exist
Three theme files are at the repo root (not integrated):
1. `papierklammer-design-system.md` — Rose (default) theme spec
2. `papierklammer-theme-violet-indigo.md` — Defines `[data-theme="violet-indigo"]` CSS variables
3. `papierklammer-theme-earth.md` — Defines `[data-theme="earth"]` CSS variables

### What's Needed for Theme Integration
1. **CSS**: Add `[data-theme="violet-indigo"]` and `[data-theme="earth"]` variable blocks to `ui/src/index.css`, mapping both the custom `--bg/--fg/--alive/--warn/--dead` tokens AND the shadcn bridge variables (`--background`, `--foreground`, `--card`, etc.)
2. **ThemeContext**: Extend type from `"light" | "dark"` to include color themes (e.g., `rose | violet-indigo | earth`). Use `data-theme` attribute on `<html>` element.
3. **Theme Selector UI**: Replace the simple dark/light toggle with a theme picker (dropdown or modal) that offers rose (default), violet-indigo, earth
4. **Persistence**: Store selected theme in localStorage
5. **Scrollbar and misc CSS**: Update scrollbar colors and MDXEditor vars to use theme-aware tokens instead of hardcoded values

---

## 5. Hardcoded Colors Needing Replacement

Pages using Tailwind color classes that bypass the design system:

| File | Hardcoded Colors | Should Use |
|------|-----------------|------------|
| Routines.tsx | `bg-amber-100`, `bg-amber-900/30`, `text-amber-800`, `text-amber-400` | `var(--warn)` with opacity |
| RoutineDetail.tsx | `bg-emerald-500`, `text-emerald-400`, `bg-blue-500/5`, `border-blue-500/30` | `var(--alive)`, `var(--border)` |
| Costs.tsx | `bg-emerald-400`, `bg-yellow-400`, `bg-red-400` | `var(--alive)`, `var(--warn)`, `var(--dead)` |
| Approvals.tsx | `bg-yellow-500/20`, `text-yellow-500` | `var(--warn)` with opacity |
| ApprovalDetail.tsx | `bg-green-50`, `bg-green-700`, `border-green-300` | `var(--alive)` |
| Inbox.tsx | `bg-red-500/20`, `bg-green-700`, `text-red-600`, `text-red-400` | `var(--dead)`, `var(--alive)` |
| OrgChart.tsx | Hardcoded hex in `statusDotColor` (`#22d3ee`, `#4ade80`, `#facc15`, `#f87171`) | `var(--alive)`, `var(--warn)`, `var(--dead)` |
| InstanceExperimentalSettings.tsx | `bg-green-600` | `var(--alive)` |
| PluginManager.tsx | `bg-green-600`, `bg-amber-500/5`, `bg-red-500/[0.06]` | `var(--alive)`, `var(--warn)`, `var(--dead)` |
| Companies.tsx | `bg-green-500/10`, `bg-yellow-500/10` | `var(--alive)`, `var(--warn)` |
| ProjectDetail.tsx | `border-amber-500/20 bg-amber-500/5`, `border-red-500/30 bg-red-500/10` | `var(--warn)`, `var(--dead)` |
| CompanyExport.tsx | `border-amber-500/30 bg-amber-500/5` | `var(--warn)` |
| CompanyImport.tsx | `bg-emerald-500/5`, `border-amber-500/30` | `var(--alive)`, `var(--warn)` |

---

## 6. Shadows Still Present

These violate the "no shadows" design system rule:

| File | Shadow Class |
|------|-------------|
| OrgChart.tsx | `shadow-sm`, `shadow-md` on org chart cards |
| ProjectDetail.tsx | `shadow-lg` on color picker popover |
| Routines.tsx | `shadow-sm` on toggle switch knob |
| RoutineDetail.tsx | `shadow-sm` on toggle switch knob |
| ActiveAgentsPanel.tsx | `shadow-sm` on panel |
| ScrollToBottom.tsx | `shadow-md` on floating button |
| ToastViewport.tsx | `shadow-lg` on toast |
| MarkdownEditor.tsx | `shadow-md` on mention popup |
| AccountingModelCard.tsx | `shadow-sm` on card |

---

## 7. Priority Ranking of Work Items

### P0 — Critical (User-visible bugs on core pages)
1. **Dashboard: Connect "history" and "config" tabs** — Dead buttons on the main page
2. **Dashboard: Agent name click → navigate to agent detail** — Specifically requested
3. **Dashboard: Improve stream content display** — Tool call details, thinking vs. output, expandable content

### P1 — High (Theme system)
4. **Add theme CSS variables** — Integrate `[data-theme="violet-indigo"]` and `[data-theme="earth"]` into `index.css`
5. **Extend ThemeContext** — Support color theme selection (rose/violet-indigo/earth)
6. **Build theme selector UI** — Replace dark/light toggle with full theme picker

### P2 — Medium (Design system consistency across all pages)
7. **Replace hardcoded Tailwind colors** — All pages listed in Section 5 (~15 files)
8. **Remove shadows** — All files listed in Section 6 (~9 components)
9. **OrgChart statusDotColor** — Replace hardcoded hex with CSS variables

### P3 — Low (Nice-to-have polish)
10. **DesignGuide page** — Update to show actual design system tokens instead of hardcoded examples
11. **Standalone pages** (Auth, BoardClaim, CliAuth, InviteLanding) — Apply design system
12. **RunTranscriptUxLab** — Replace cyan hardcoded colors with design system tokens

---

## 8. Summary

- **6 pages** are fully styled with the papierklammer design system
- **~28 pages** use standard shadcn that partially works due to CSS variable mapping but have hardcoded colors
- **2 critical dead buttons** on the Dashboard (history/config tabs)
- **1 critical missing navigation** (agent name → agent detail)
- **~15 files** need hardcoded Tailwind colors replaced with design system variables
- **~9 files** have shadows that violate the design system
- **Theme system** needs CSS variables, extended context, and a selector UI (theme specs already written)
