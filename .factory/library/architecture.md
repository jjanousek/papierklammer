# Architecture

## Mission focus

This mission is a hard live-brand rename. It removes remaining `Paperclip` / `paperclipai` naming from active code plus active skills/scripts and cuts over those live contracts to `Papierklammer` without keeping compatibility aliases.

The mission does not target broad docs/history cleanup. It targets the shipped runtime, agent skill distribution, CLI/operator surfaces, active scripts, and the shared identifiers that tie them together.

## System areas

### 1. Runtime and UI/API layer
- The local app on `http://127.0.0.1:3100` serves both the Express API and the web UI.
- Runtime branding appears in:
  - root HTML shell and server-emitted branding helpers
  - UI page copy and navigation/help links
  - browser persistence keys such as selected-company/view/draft state
  - lightweight generated text/assets exposed by routes
  - HTTP-facing identifiers such as session/trace/header naming
- Shared constants and validators under `packages/shared/` influence both server and UI behavior, so renames here ripple widely.

### 2. Skill distribution layer
- Bundled skills live under `skills/` and are served by `/api/skills/*`.
- Project worker skills live under `.factory/skills/` and are part of the active agent workflow for this repo.
- `packages/adapter-utils/` and `server/src/services/company-skills.ts` derive bundled skill identities, keys, and installable names.
- Agent skill state is exposed through `/api/agents/:id/skills` and `/api/agents/:id/skills/sync`.
- Local adapter install flows write skills into adapter-specific home directories; those flows must agree with the served skill inventory.

### 3. CLI and operator-script layer
- The root operator surface is the `papierklammer` CLI in `cli/src/index.ts`.
- Operator-facing wording also lives in subcommands (`onboard`, `doctor`, `run`, `configure`, `env`, `db:backup`, `worktree`, client commands).
- Active operational wrappers live in `scripts/` and `package.json` scripts, including smoke/setup helpers and worktree/dev tooling.
- These surfaces often generate labels, prefixes, filenames, and next-step instructions; rename drift commonly survives here.

### 4. TUI and generated/export surfaces
- The shipped TUI package (`packages/orchestrator-tui`, published as `papierklammer-tui`) is a live operator surface and can still leak legacy runtime strings even if package naming is already renamed.
- Company portability/export flows generate user-facing files, readmes, manifests, links, and sidecar references. Those generated artifacts are live product output, not historical docs.
- Generated text/assets from server routes or export helpers must be treated as rename targets when they are user-visible.

### 5. Adapter and OpenClaw bridge layer
- Adapter registries and adapter-specific guidance live across `packages/adapters/**`, server routes, and CLI/UI surfaces.
- OpenClaw is a special cross-surface bridge: onboarding text, generated manifests, skill references, filenames, config keys, and wake/run headers must all agree.
- The rename must be coherent across normal local adapters and OpenClaw-specific flows.

## Cross-surface contracts

The highest-risk contracts are the ones repeated in multiple places:

- bundled skill slugs and frontmatter names
- runtime skill keys and desired/installed skill snapshots (for example `papierklammer/paperclip/<slug>`)
- CLI command names and help text
- HTTP trace/header and config names (for example `X-Paperclip-Run-Id`, `paperclipApiUrl`)
- onboarding/manifests/install instructions
- generated artifact prefixes, labels, and filenames
- browser storage keys starting with `paperclip`

If any one layer is renamed without the others, the product becomes internally inconsistent even when individual files compile.

## Rename decision matrix

### Must rename now
- Active user-visible `Paperclip` / `paperclipai` branding in code, skills, scripts, generated assets, and operator flows
- Live skill route/path/install names such as `/api/skills/paperclip` and `skills/paperclip`
- Runtime/config/header names such as `X-Paperclip-Run-Id`, `paperclipApiUrl`, and legacy `paperclip:` runtime keys
- Browser persistence keys beginning with `paperclip`
- OpenClaw-facing legacy filenames/session/config names when they are part of the shipped flow

### Intentionally preserved or allowlisted only when explicitly required
- Vendor/spec filenames and schema names that are intentionally outside this mission’s live rename scope, such as `.paperclip.yaml`, when they remain part of a published compatibility format

### Needs explicit worker caution
- Generated portability/export output: workers must inspect whether the user-visible artifact content is live branding that should change even if the filename/schema is allowlisted
- Existing verification tests already capture some allowed legacy path cases; workers should extend those tests rather than assuming every `paperclip` token is automatically in scope

## Mission invariants

- Hard cut only: no compatibility aliases for legacy Paperclip names.
- Package scope and primary binary rename are already done (`@papierklammer/*`, `papierklammer`, `papierklammer-tui`); remaining risk is concentrated in runtime strings, skill identities, generated artifacts, storage keys, and API/header names.
- In scope: live code, active `skills/`, active `.factory/skills/`, active `scripts/`, and shipped operator/runtime surfaces.
- Out of scope: broad docs/history/spec rewrites, archived validation artifacts, and tests except where they are needed to verify the rename.
- Keep validation and implementation low-process: no more than four mission-started Node processes at once, no overlapping dev servers, and shut down temporary processes promptly.
- Reuse port `3100` for app validation when needed; do not start parallel app instances.

## Risk concentrations

- Shared/runtime constants that look internal but leak into API/web/CLI output
- Browser local-storage keys that can silently preserve old naming
- Served bundled skill paths and the code that derives runtime skill keys
- `agent local-cli` installation behavior versus the skill inventory served over HTTP
- CLI help/next-step text and script-generated labels/prefixes
- OpenClaw onboarding, filenames, config keys, and run-trace/header naming
- Residual rename tokens in active `.factory/skills/` that many agents rely on
- Generated portability/export artifacts and live TUI/operator strings

## Worker guidance

- Treat the validation contract as the source of truth for what must be observable after the rename.
- Prefer changing shared naming sources first, then dependent surfaces.
- When a rename touches generated or derived identifiers, verify both the source definition and an observable output path.
- Reuse and extend the existing rename verification tests where possible; they already encode parts of the fork’s expected naming model.
- Keep scans tightly scoped to active live surfaces so workers do not churn historical docs or mission artifacts.
