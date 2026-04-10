---
name: rename-worker
description: Handles codebase-wide rename operations (package scopes, env vars, paths, branding)
---

# Rename Worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the WORK PROCEDURE.

## When to Use This Skill

Features that involve renaming package scopes, environment variables, filesystem paths, compatibility aliases, or branding/copy alignment across the monorepo.

## Required Skills

None

## Work Procedure

1. **Read the feature description and the validation contract IDs it fulfills.** Understand exactly which live surfaces are in scope and which legacy tokens, if any, are explicitly allowlisted.

2. **Inspect before editing**:
   - Read the files you plan to touch first.
   - Search only the in-scope live surfaces named by the feature (`package.json`, code, active `skills/`, active `.factory/skills/`, active `scripts/`, generated output sources).
   - Keep scans narrow; do not churn broad docs/history or mission artifacts.

3. **Write or extend verification tests first** (red):
   - Prefer extending the existing rename verification tests in `server/src/__tests__/fork-*.test.ts`.
   - Add focused assertions for the exact live rename guarantees in the feature (skill slugs, headers, help text, storage keys, script labels, etc.).
   - If a repo-wide scan is needed, encode it in a deterministic test or tightly scoped command so allowlisted vendor tokens remain excluded intentionally.
   - Run only the focused verification command first and confirm it fails before implementation.

4. **Perform the rename**:
   - Change shared naming sources before dependent surfaces.
   - Be careful with case sensitivity: `PAPERCLIP` vs `paperclip` vs `Paperclip` may all need different replacements.
   - Treat generated and derived identifiers as first-class rename targets: skill keys, headers, onboarding snippets, labels, filenames, and browser storage keys.
   - Do NOT rename anything in `node_modules/`, `dist/`, or broad historical docs unless the feature explicitly says it is in scope.
   - If the feature touches active skill content, check both bundled `skills/` and active `.factory/skills/`.
   - If package metadata changes require it, run `pnpm install` to update the lockfile.

5. **Run low-process verification** (green):
   - Keep total mission-started Node processes at or below 4.
   - Run one command at a time.
   - Use focused Vitest commands first.
   - Use `.factory/services.yaml` commands for the mission baseline:
     - `pnpm exec vitest run --maxWorkers=1 server/src/__tests__/fork-rename-verification.test.ts server/src/__tests__/fork-path-cli-rename-verification.test.ts server/src/__tests__/fork-env-var-rename-verification.test.ts`
     - `pnpm -r --workspace-concurrency=1 typecheck`
     - `pnpm -r --workspace-concurrency=1 build` when the feature changes shipped runtime behavior broadly
   - Do not run the full `pnpm test:run` suite for this mission unless the orchestrator explicitly changes the process-budget rule.

6. **Manual verification**:
   - Use lightweight probes that match the feature’s contract: `curl` for API/routes, `pnpm papierklammer ... --help` for CLI text, browser checks only when required.
   - For local installer or onboarding checks, prefer temporary directories over real user homes.
   - If you start a local app or helper process, stop it before ending the session.

## Example Handoff

```json
{
  "salientSummary": "Renamed the remaining bundled skill and CLI live surfaces from Paperclip to Papierklammer. Updated skill slugs, served skill markdown, local installer text, and active worker-skill instructions. Focused rename verification tests, low-concurrency typecheck, and targeted help/curl probes all passed.",
  "whatWasImplemented": "Cut over active bundled skill names and operator-visible Paperclip strings across served skill routes, local-cli installer output, and active .factory worker skills. Extended the existing fork rename verification tests to cover the new live skill slugs and active skill-file content, while preserving explicit allowlisted vendor filenames outside mission scope.",
  "whatWasLeftUndone": "",
  "verification": {
    "commandsRun": [
      { "command": "pnpm exec vitest run --maxWorkers=1 server/src/__tests__/fork-rename-verification.test.ts server/src/__tests__/fork-path-cli-rename-verification.test.ts server/src/__tests__/fork-env-var-rename-verification.test.ts", "exitCode": 0, "observation": "Focused rename verification suite passed" },
      { "command": "pnpm -r --workspace-concurrency=1 typecheck", "exitCode": 0, "observation": "No type errors" },
      { "command": "pnpm papierklammer --help", "exitCode": 0, "observation": "Help output showed only Papierklammer branding" },
      { "command": "curl -sf http://127.0.0.1:3100/api/skills/papierklammer", "exitCode": 0, "observation": "Renamed bundled skill fetched successfully" }
    ],
    "interactiveChecks": []
  },
  "tests": {
    "added": [
      { "file": "server/src/__tests__/rename-verification.test.ts", "cases": [
        { "name": "bundled skill routes use papierklammer slugs", "verifies": "live skill discovery rename complete" },
        { "name": "active .factory skill files contain no Paperclip operator copy", "verifies": "active worker-skill rename complete" }
      ]}
    ]
  },
  "discoveredIssues": []
}
```

## When to Return to Orchestrator

- Rename would break a third-party integration or external API contract
- Found references in generated/vendor files where it is unclear whether they are allowlisted (for example compatibility formats such as `.paperclip.yaml`)
- A required validation step cannot be performed without violating the 4-process budget
- pnpm install fails after metadata/package renames (lockfile conflict)
- Hard-cut behavior is ambiguous and a rename may break an external contract that the feature did not explicitly cover
