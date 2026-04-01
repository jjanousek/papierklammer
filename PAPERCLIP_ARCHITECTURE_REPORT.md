# Paperclip Architecture Report

**Repository:** https://github.com/paperclipai/paperclip  
**Stars:** 42.7k | **Forks:** 6.5k | **License:** MIT  
**Latest version:** v2026.325.0 (0.3.1 npm)  
**Last commit:** Mar 31, 2026

---

## 1. Tech Stack Summary

| Layer | Technology |
|---|---|
| **Language** | TypeScript (96.6% of codebase) |
| **Runtime** | Node.js 20+ |
| **Package Manager** | pnpm 9.15+ (workspace monorepo) |
| **Server Framework** | Express 5.1 |
| **Frontend Framework** | React 19 + Vite 6 |
| **Database** | PostgreSQL 17 (embedded PGlite for dev, external Postgres for prod) |
| **ORM** | Drizzle ORM 0.38 |
| **UI Component Library** | shadcn/ui (Radix UI primitives + Tailwind CSS 4) |
| **State Management (UI)** | TanStack React Query 5 |
| **Routing (UI)** | React Router Dom 7 |
| **Auth** | Better Auth 1.4.18 |
| **Real-time** | WebSocket (ws 8.19) + SSE |
| **Validation** | Zod 3.24 |
| **Testing** | Vitest 3.0 (unit) + Playwright 1.58 (e2e) |
| **Build** | tsc + Vite (UI), esbuild available |
| **Logging** | Pino 9.6 + pino-http + pino-pretty |
| **Rich text** | MDX Editor / Lexical |
| **Image processing** | Sharp 0.34 |
| **Storage** | Local disk + S3 (aws-sdk v3) |
| **Docker** | Multi-stage Dockerfile, docker-compose for prod |
| **Secrets** | AES-256-GCM local encryption, stub providers for AWS/GCP/Vault |

---

## 2. Project Structure (Monorepo)

```
paperclip/
├── server/                  # Express REST API + orchestration services
│   ├── src/
│   │   ├── adapters/        # Server-side adapter registry/dispatch
│   │   ├── auth/            # Better Auth integration
│   │   ├── middleware/       # Express middleware (CORS, auth, validation)
│   │   ├── routes/          # Express route handlers (REST API)
│   │   ├── services/        # Business logic layer (50+ service files)
│   │   ├── realtime/        # WebSocket/SSE real-time event system
│   │   ├── secrets/         # Secrets management (encryption, providers)
│   │   ├── storage/         # File storage abstraction (local/S3)
│   │   ├── types/           # Server-specific TypeScript types
│   │   ├── onboarding-assets/ # Default onboarding company templates
│   │   ├── app.ts           # Express app setup
│   │   ├── index.ts         # Server entrypoint
│   │   └── config.ts        # Runtime config
│   ├── scripts/             # Dev scripts (watch, etc.)
│   └── package.json
│
├── ui/                      # React + Vite board UI
│   ├── src/                 # React components, pages, hooks
│   ├── public/              # Static assets
│   ├── vite.config.ts
│   └── package.json
│
├── packages/
│   ├── db/                  # @paperclipai/db — Drizzle schema + migrations
│   │   ├── src/
│   │   │   ├── schema/      # ~45 schema files (one per table)
│   │   │   ├── migrations/  # Drizzle migration SQL files
│   │   │   ├── client.ts    # DB client (embedded PG + external PG)
│   │   │   ├── migrate.ts   # Migration runner
│   │   │   ├── seed.ts      # Seed data
│   │   │   └── backup*.ts   # Backup utilities
│   │   └── drizzle.config.ts
│   │
│   ├── shared/              # @paperclipai/shared — Types, constants, validators
│   │   └── src/             # Shared types consumed by server + UI
│   │
│   ├── adapter-utils/       # @paperclipai/adapter-utils — Shared adapter utilities
│   │
│   ├── adapters/            # Agent adapter implementations
│   │   ├── claude-local/    # Claude CLI adapter
│   │   ├── codex-local/     # Codex CLI adapter
│   │   ├── cursor-local/    # Cursor adapter
│   │   ├── gemini-local/    # Gemini CLI adapter
│   │   ├── openclaw-gateway/ # OpenClaw SSE gateway adapter
│   │   ├── opencode-local/  # OpenCode CLI adapter
│   │   └── pi-local/       # Pi CLI adapter
│   │
│   └── plugins/             # Plugin system
│       ├── sdk/             # @paperclipai/plugin-sdk
│       └── examples/        # Example plugins
│
├── cli/                     # CLI tool (paperclipai command)
├── doc/                     # Internal documentation
├── docs/                    # Public documentation (Mintlify)
├── evals/                   # Promptfoo evals
├── scripts/                 # Build/release/utility scripts
├── skills/                  # Skill documents (injected at runtime)
├── tests/                   # E2E tests (Playwright)
├── docker/                  # Docker-specific configs
├── releases/                # Release changelogs
├── report/                  # Report tooling
├── patches/                 # pnpm patches (embedded-postgres)
│
├── package.json             # Root workspace config
├── pnpm-workspace.yaml      # Workspace definition
├── vitest.config.ts         # Root Vitest config (workspace mode)
├── tsconfig.base.json       # Shared TS config
├── tsconfig.json            # Root TS solution config
├── Dockerfile               # Multi-stage production Docker build
├── docker-compose.yml       # Full prod stack (Postgres + server)
├── docker-compose.quickstart.yml  # Quick one-command Docker setup
└── .env.example
```

### pnpm-workspace.yaml (workspace structure):
```yaml
packages:
  - packages/*
  - packages/adapters/*
  - packages/plugins/*
  - packages/plugins/examples/*
  - server
  - ui
  - cli
```

---

## 3. Database & ORM

### ORM: Drizzle ORM
- Schema defined in `packages/db/src/schema/` (~45+ schema files, one per table)
- Migrations in `packages/db/src/migrations/` (SQL-based, Drizzle-generated)
- Migration commands: `pnpm db:generate` / `pnpm db:migrate`
- Drizzle config reads compiled schema from `dist/schema/*.js`

### Database: PostgreSQL 17
- **Dev mode:** Embedded PostgreSQL (PGlite) — no external DB needed, data at `~/.paperclip/instances/default/db`
- **Prod mode:** External Postgres via `DATABASE_URL` env var
- **Docker:** `postgres:17-alpine` image

### Key Database Tables / Domain Models:

| Entity | Schema File | Purpose |
|---|---|---|
| **companies** | `companies.ts` | Multi-tenant company isolation |
| **agents** | `agents.ts` | AI agent definitions + config |
| **projects** | `projects.ts` | Code projects/repos |
| **goals** | `goals.ts` | Business goals (hierarchical) |
| **issues** | (in schema) | Tasks/issues assigned to agents |
| **issue_comments** | `issue_comments.ts` | Comments on issues |
| **issue_documents** | `issue_documents.ts` | Rich documents attached to issues |
| **issue_attachments** | `issue_attachments.ts` | File attachments |
| **issue_approvals** | `issue_approvals.ts` | Junction: issues ↔ approvals |
| **labels** | `labels.ts` | Issue labels |
| **approvals** | `approvals.ts` | Approval gates for governance |
| **approval_comments** | `approval_comments.ts` | Comments on approvals |
| **heartbeat_runs** | `heartbeat_runs.ts` | Agent execution runs (the "scheduler dispatch") |
| **heartbeat_run_events** | `heartbeat_run_events.ts` | Events within runs |
| **agent_runtime_state** | `agent_runtime_state.ts` | Agent's current runtime state |
| **agent_wakeup_requests** | `agent_wakeup_requests.ts` | Wake-up triggers for agents |
| **agent_task_sessions** | `agent_task_sessions.ts` | Per-task session state (agent, adapter, taskKey) |
| **agent_api_keys** | `agent_api_keys.ts` | Hashed API keys for agent auth |
| **agent_config_revisions** | `agent_config_revisions.ts` | Config change tracking + rollback |
| **cost_events** | `cost_events.ts` | Token/cost tracking per run |
| **budget_policies** | `budget_policies.ts` | Budget limits and policies |
| **budget_incidents** | `budget_incidents.ts` | Budget breach events |
| **finance_events** | `finance_events.ts` | Financial events |
| **routines** | `routines.ts` | Scheduled routine workflows |
| **execution_workspaces** | `execution_workspaces.ts` | Isolated execution environments |
| **project_workspaces** | `project_workspaces.ts` | Project workspace configs |
| **workspace_operations** | `workspace_operations.ts` | Workspace operation log |
| **workspace_runtime_services** | `workspace_runtime_services.ts` | Running services in workspaces |
| **company_skills** | `company_skills.ts` | Skills available to a company |
| **company_secrets** | `company_secrets.ts` | Encrypted secrets |
| **company_secret_versions** | `company_secret_versions.ts` | Secret version history |
| **company_memberships** | `company_memberships.ts` | User ↔ company membership |
| **company_logos** | `company_logos.ts` | Company branding |
| **project_goals** | `project_goals.ts` | Many-to-many: projects ↔ goals |
| **auth** | `auth.ts` | Better Auth tables (user, session, account, verification) |
| **instance_user_roles** | `instance_user_roles.ts` | Instance-level user roles |
| **instance_settings** | `instance_settings.ts` | Instance-wide settings |
| **invites** | `invites.ts` | Invite tokens |
| **join_requests** | `join_requests.ts` | Agent/user join requests |
| **document_revisions** | `document_revisions.ts` | Document version history |
| **assets** | `assets.ts` | Uploaded file metadata |
| **activity_log** | `activity_log.ts` | Audit trail for all mutations |
| **board_api_keys** | `board_api_keys.ts` | Board/operator API keys |
| **cli_auth_challenges** | `cli_auth_challenges.ts` | CLI auth challenge flow |
| **plugins** | `plugins.ts` | Installed plugins |
| **plugin_config** | `plugin_config.ts` | Plugin configuration |
| **plugin_state** | `plugin_state.ts` | Plugin persistent state |
| **plugin_jobs** | `plugin_jobs.ts` | Plugin job queue |
| **plugin_logs** | `plugin_logs.ts` | Plugin log entries |
| **plugin_webhooks** | `plugin_webhooks.ts` | Plugin webhook configs |
| **plugin_entities** | `plugin_entities.ts` | Plugin-managed entities |
| **plugin_company_settings** | `plugin_company_settings.ts` | Per-company plugin settings |

---

## 4. API Layer

### REST API (Express 5)
- Base path: `/api`
- Server at `http://localhost:3100`

### Route Files (in `server/src/routes/`):
| Route File | Endpoints |
|---|---|
| `health.ts` | `GET /api/health` |
| `companies.ts` | Company CRUD |
| `agents.ts` | Agent CRUD, config, adapter settings |
| `issues.ts` | Issue CRUD, checkout, status transitions |
| `issues-checkout-wakeup.ts` | Issue checkout + agent wakeup |
| `goals.ts` | Goal CRUD |
| `projects.ts` | Project CRUD, workspace config |
| `approvals.ts` | Approval workflows |
| `activity.ts` | Activity log queries |
| `dashboard.ts` | Dashboard summaries |
| `costs.ts` | Cost queries |
| `access.ts` | Invites, join requests, onboarding |
| `authz.ts` | Authorization checks |
| `assets.ts` | File upload/download |
| `secrets.ts` | Secret management |
| `company-skills.ts` | Skill CRUD |
| `execution-workspaces.ts` | Workspace management |
| `routines.ts` | Scheduled routines |
| `plugins.ts` | Plugin management |
| `plugin-ui-static.ts` | Plugin UI static assets |
| `llms.ts` | LLM reflection routes |
| `sidebar-badges.ts` | Badge counts |
| `instance-settings.ts` | Instance settings |
| `org-chart-svg.ts` | SVG org chart generation |

### Auth Model:
- **Board access:** Full-control operator (Better Auth sessions, cookies)
- **Agent access:** Bearer API keys (hashed at rest) or JWT (HS256, per-heartbeat)
- **Company isolation:** All entities scoped to company, enforced in routes/services

### Real-time:
- WebSocket (`ws` library) for live events
- SSE for adapter streaming (e.g., OpenClaw gateway)

---

## 5. Scheduler / Dispatch Architecture ("Heartbeat System")

This is the core orchestration engine:

### How it works:
1. **Heartbeat Service** (`server/src/services/heartbeat.ts`) — The central scheduler
2. **Cron Service** (`server/src/services/cron.ts`) — Timer-based heartbeat scheduling
3. **Agent Wakeup Requests** (`agent_wakeup_requests` table) — Event-based triggers
4. **Heartbeat Runs** (`heartbeat_runs` table) — Execution records
5. **Agent Runtime State** (`agent_runtime_state` table) — Tracks what each agent is doing

### Wakeup/Dispatch Flow:
- Agents wake on **scheduled heartbeats** (timer) and **event triggers** (task assignment, @-mentions, approval decisions)
- The heartbeat service **checks out issues** atomically (single-assignee model, no double-work)
- It constructs a **prompt** with goal ancestry, issue context, and skill injections
- It dispatches to the appropriate **adapter** (Claude, Codex, OpenClaw, etc.)
- Adapters spawn local CLI processes or call remote gateways
- **Budget enforcement** is atomic — agents are auto-paused when budget is hit
- **Session continuity** — agents resume same task context across heartbeats

### Key Services (50+ files in `server/src/services/`):
| Service | Purpose |
|---|---|
| `heartbeat.ts` | Core scheduler loop, run dispatch |
| `cron.ts` | Scheduled timer triggers |
| `agents.ts` | Agent CRUD + state management |
| `issues.ts` | Issue lifecycle, checkout semantics |
| `issue-assignment-wakeup.ts` | Wake agent on issue assignment |
| `goals.ts` | Goal hierarchy management |
| `projects.ts` | Project management |
| `companies.ts` | Multi-company management |
| `approvals.ts` | Approval gate enforcement |
| `budgets.ts` | Budget limit enforcement |
| `costs.ts` | Cost tracking/aggregation |
| `finance.ts` | Billing & quota control plane |
| `quota-windows.ts` | Provider quota window tracking |
| `routines.ts` | Scheduled automation workflows |
| `secrets.ts` | Secret resolution at runtime |
| `activity-log.ts` | Audit logging |
| `dashboard.ts` | Dashboard aggregation |
| `live-events.ts` | Real-time event dispatch |
| `access.ts` | Access control service |
| `agent-instructions.ts` | Prompt/instruction bundle assembly |
| `agent-permissions.ts` | Permission checks |
| `company-skills.ts` | Skill management |
| `company-portability.ts` | Export/import companies |
| `execution-workspaces.ts` | Workspace lifecycle |
| `workspace-runtime.ts` | Workspace runtime management |
| `workspace-operations.ts` | Workspace operations |
| `documents.ts` | Issue document management |
| `run-log-store.ts` | Run log persistence |
| `hire-hook.ts` | Post-hire adapter hooks |
| `sidebar-badges.ts` | Badge computation |
| `board-auth.ts` | Board authentication |
| `local-service-supervisor.ts` | Local process supervision |
| `plugin-*.ts` | ~15 plugin system services |

---

## 6. Agent Adapter System

### Architecture:
- Each adapter is its own package under `packages/adapters/<name>/`
- All adapters conform to a common interface defined in `packages/adapter-utils/`
- Adapters are registered in the server via `server/src/adapters/`
- The server's `package.json` depends on all adapter packages as `workspace:*`

### Available Adapters:
| Adapter Package | Type Key | Description |
|---|---|---|
| `claude-local` | `claude_local` | Claude CLI (local) |
| `codex-local` | `codex_local` | Codex CLI (local) |
| `cursor-local` | `cursor_local` | Cursor (local) |
| `gemini-local` | `gemini_local` | Gemini CLI (local) |
| `openclaw-gateway` | `openclaw` | OpenClaw SSE gateway (remote) |
| `opencode-local` | `opencode_local` | OpenCode CLI (local) |
| `pi-local` | `pi_local` | Pi CLI (local) |
| (hermes) | `hermes_local` | Hermes (via npm package `hermes-paperclip-adapter`) |

### Adapter Features:
- Each adapter has `agentConfigurationDoc` for LLM reflection
- Adapters receive env vars: `PAPERCLIP_API_KEY`, `PAPERCLIP_APPROVAL_ID`, etc.
- Local adapters spawn CLI subprocesses
- OpenClaw uses SSE streaming
- Adapters parse transcripts for cost/event extraction
- JWT auth per heartbeat run for local adapters

---

## 7. Build / Test / Dev Commands

```sh
# Development
pnpm dev              # Full dev (API + UI, watch mode)
pnpm dev:once         # Full dev without file watching
pnpm dev:server       # Server only
pnpm dev:ui           # UI only (Vite dev server)

# Build
pnpm build            # Build all workspaces
pnpm -r typecheck     # Type checking all packages

# Testing
pnpm test             # Vitest interactive
pnpm test:run         # Vitest single run
pnpm test:e2e         # Playwright e2e tests
pnpm test:e2e:headed  # E2E with browser visible

# Database
pnpm db:generate      # Generate Drizzle migration
pnpm db:migrate       # Apply migrations
pnpm db:backup        # Manual backup

# Other
pnpm check:tokens     # Check for forbidden tokens
pnpm docs:dev         # Dev docs (Mintlify)
pnpm evals:smoke      # Promptfoo evals
```

---

## 8. Plugin System

- Plugin SDK: `packages/plugins/sdk/` (`@paperclipai/plugin-sdk`)
- Example plugins: `packages/plugins/examples/`
- Server services: 15+ `plugin-*.ts` files handling lifecycle, sandboxing, events, jobs, state, tools, streams, webhooks
- DB tables: `plugins`, `plugin_config`, `plugin_state`, `plugin_jobs`, `plugin_logs`, `plugin_webhooks`, `plugin_entities`, `plugin_company_settings`
- Plugins run in sandboxed worker threads
- Plugin UI is served as static assets via `plugin-ui-static.ts`

---

## 9. Key Architectural Patterns

1. **Company-scoped multi-tenancy:** Every entity is scoped to a company. One deployment can run many companies with separate data and audit trails.

2. **Single-assignee task model:** Issues are checked out atomically to one agent. No double-work.

3. **Heartbeat-based scheduling:** Agents don't run continuously by default. They wake on timers and events (task assignment, @-mentions, approval decisions).

4. **Goal-aware execution:** Tasks carry full goal ancestry so agents see the "why," not just a title.

5. **Governance with rollback:** Approval gates enforced, config changes revisioned, rollback support.

6. **Adapter abstraction:** Agents are pluggable. Bring any CLI-based or gateway-based agent.

7. **Embedded everything for dev:** Embedded Postgres, local disk storage, auto-generated secrets keys. Zero external dependencies for development.

8. **Activity logging:** Every mutation is logged for audit trail.

9. **Budget enforcement:** Atomic budget checks, auto-pause on budget breach.

10. **Workspace isolation:** Execution workspaces provide isolated environments for agent runs.

---

## 10. Insights Relevant to Fork Spec Implementation

- **The heartbeat/scheduler is in-process:** It runs as Node.js services within the same Express server process. There is no external job queue (Redis, RabbitMQ, etc.). The `cron.ts` service manages timers, and `heartbeat.ts` handles dispatch logic.

- **No tRPC or GraphQL:** The API is pure REST with Express routes. Validation uses Zod schemas in `packages/shared/`.

- **Drizzle ORM is the sole data layer:** All DB access goes through Drizzle. Schema changes require migration generation (`pnpm db:generate`).

- **The UI is served by the API server in dev:** Vite middleware mode. In production, pre-built UI assets are served as static files.

- **Adapter system is extensible:** Adding a new adapter means creating a new package under `packages/adapters/` and wiring it into the server's dependencies.

- **The CLI (`cli/`) is a separate workspace:** It handles onboarding, configuration, doctor checks, and can also issue CRUD commands against the API.

- **Skills are runtime-injected:** Stored in `company_skills` table, materialized as files, and injected into agent prompts at heartbeat time.

- **Routines provide scheduled automation:** The `routines` table + service allows defining scheduled workflows that create issues or trigger actions on a cron schedule.

- **No external message queue:** All inter-service communication is in-process (function calls + EventEmitter patterns via `live-events.ts`).
