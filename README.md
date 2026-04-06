# Papierklammer

Papierklammer is an open-source control plane for AI-agent companies. It combines a Node.js server, web UI, CLI, and terminal operator tooling for managing company-scoped agents, issues, approvals, budgets, and execution workflows.

> **Fork notice**
>
> Papierklammer is a fork of [Paperclip](https://github.com/paperclipai/paperclip). This repository builds on the upstream Paperclip codebase under the same MIT license and preserves upstream attribution. Papierklammer is an evolving fork, not a ground-up reimplementation.

## Why Papierklammer is different

Papierklammer is not just a renamed Paperclip build. This fork adds substantive operator-facing control surfaces and orchestration behavior for running AI-agent companies in day-to-day use.

- **Operator-first terminal control plane.** The repo ships both the orchestrator console CLI and a full-screen orchestrator TUI, and `pnpm dev` is wired to bring up the dev server and open the TUI in a second terminal when possible.
- **Interactive terminal management.** The TUI is not only a status screen: it supports approvals, heartbeat invocation, recent/live run inspection, and recovery paths for stuck or failed operator actions.
- **Free-form operator intent becomes company-scoped work.** The orchestrator's base instructions push vague management requests into normal issues in the active company instead of leaving them as chat-only output.
- **Stronger company-scoped orchestration API.** Dedicated operator routes expose status, stale detection and cleanup, issue creation, priority changes, nudges, and unblock/recovery actions around active company work.
- **Richer web review surfaces.** Issue pages show completed-run previews, result text, work products/artifacts, and direct inspect-run links so operators can review outcomes without digging through raw logs first.
- **Deterministic audit/demo workflow.** The repo includes a real tiny CLI demo project, isolated audit instances, and a documented regression loop for repeatable end-to-end orchestration checks.

The fork also carries Papierklammer naming, package-scope, config-path, and environment-variable changes, but those are not the main differentiator.

## What Papierklammer does

Papierklammer is designed for running and supervising teams of AI agents as a company, not just as isolated chat sessions.

- Organize work by company, project, goal, issue, and approval
- Bring your own agents and adapters
- Track activity, budgets, and audit trails
- Coordinate recurring work with heartbeats and scheduled routines
- Run locally with embedded database support for development

## Quickstart

### Requirements

- Node.js 20+
- pnpm 9.15+

### Use the `papierklammer` CLI

If `papierklammer` is already available in your environment, you can start with:

```bash
papierklammer onboard --yes
papierklammer run
```

By default, local state is isolated under `~/.papierklammer`. To update settings later, run:

```bash
papierklammer configure
```

### Run from a local clone

After cloning this repository:

```bash
pnpm install
pnpm dev
```

This starts:

- API server at `http://localhost:3100`
- Web UI on the same origin
- Orchestrator TUI in a second terminal when supported

Quick health checks:

```bash
curl http://localhost:3100/api/health
curl http://localhost:3100/api/companies
```

## Development

Common commands from the repository root:

```bash
pnpm dev              # Server + UI + orchestrator TUI
pnpm dev:watch        # Server/web watch mode without TUI auto-open
pnpm dev:tui          # TUI only
pnpm dev:server       # Server only
pnpm dev:once         # One-shot dev boot
pnpm papierklammer --help
pnpm typecheck        # Workspace type checks
pnpm test:run         # Test suite
pnpm build            # Build all packages
pnpm db:generate      # Generate DB migration
pnpm db:migrate       # Apply DB migration
```

For more detail, see:

- [Development guide](doc/DEVELOPING.md)
- [CLI reference](doc/CLI.md)
- [V1 implementation spec](doc/SPEC-implementation.md)
- [Product context](doc/PRODUCT.md)

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.

## License and attribution

Papierklammer is distributed under the [MIT License](LICENSE).

This repository is a fork of Paperclip, and the upstream MIT attribution in [`LICENSE`](LICENSE) is intentionally preserved. If you redistribute substantial portions of this project, keep the existing license notice and attribution intact.
