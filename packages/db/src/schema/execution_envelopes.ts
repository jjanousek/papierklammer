import { pgTable, uuid, text, timestamp, index } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { heartbeatRuns } from "./heartbeat_runs.js";
import { agents } from "./agents.js";
import { issues } from "./issues.js";
import { projects } from "./projects.js";
import { goals } from "./goals.js";

export const executionEnvelopes = pgTable(
  "execution_envelopes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id").notNull().references(() => heartbeatRuns.id),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    agentId: uuid("agent_id").notNull().references(() => agents.id),
    issueId: uuid("issue_id").notNull().references(() => issues.id),
    projectId: uuid("project_id").references(() => projects.id),
    goalId: uuid("goal_id").references(() => goals.id),
    workspaceId: uuid("workspace_id"),
    wakeReason: text("wake_reason").notNull(),
    runKind: text("run_kind").notNull(),
    executionPolicyVersion: text("execution_policy_version").notNull().default("1"),
    workspaceBindingMode: text("workspace_binding_mode").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    runIdx: index("execution_envelopes_run_idx").on(table.runId),
    companyIdx: index("execution_envelopes_company_idx").on(table.companyId),
    agentIdx: index("execution_envelopes_agent_idx").on(table.agentId),
    issueIdx: index("execution_envelopes_issue_idx").on(table.issueId),
  }),
);
