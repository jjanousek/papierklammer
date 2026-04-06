# Papierklammer

Papierklammer is an open-source control plane for AI-agent companies. It combines a Node.js server, web UI, CLI, and terminal operator tooling for managing company-scoped agents, issues, approvals, budgets, and execution workflows.

> **Fork notice**
>
> Papierklammer is a fork of [Paperclip](https://github.com/paperclipai/paperclip). This repository builds on the upstream Paperclip codebase under the same MIT license and preserves upstream attribution. Papierklammer is an evolving fork, not a ground-up reimplementation.

## What Papierklammer does

Papierklammer is designed for running and supervising teams of AI agents as a company, not just as isolated chat sessions.

- Organize work by company, project, goal, issue, and approval
- Bring your own agents and adapters
- Track activity, budgets, and audit trails
- Coordinate recurring work with heartbeats and scheduled routines
- Run locally with embedded database support for development

## What is different in Papierklammer?

This fork currently carries these repo-visible differences from upstream Paperclip:

- Public naming is rewritten around `Papierklammer`, including the `papierklammer` CLI and workspace packages under `@papierklammer/*`
- Local config and worktree paths use `.papierklammer` / `~/.papierklammer`, with fork-specific `PAPIERKLAMMER_*` environment variables
- The repository includes dedicated terminal operator surfaces in [`packages/orchestrator-console`](packages/orchestrator-console) and [`packages/orchestrator-tui`](packages/orchestrator-tui)
- `pnpm dev` is set up to start the dev server and open the orchestrator TUI when possible
- The UI includes Papierklammer-specific branding and design-system styling

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
