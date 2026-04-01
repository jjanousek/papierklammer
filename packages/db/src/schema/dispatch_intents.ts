import { pgTable, uuid, text, timestamp, integer, index } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { issues } from "./issues.js";
import { projects } from "./projects.js";
import { goals } from "./goals.js";
import { agents } from "./agents.js";

export const dispatchIntents = pgTable(
  "dispatch_intents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    issueId: uuid("issue_id").notNull().references(() => issues.id),
    projectId: uuid("project_id").notNull().references(() => projects.id),
    goalId: uuid("goal_id").references(() => goals.id),
    workspaceId: uuid("workspace_id"),
    targetAgentId: uuid("target_agent_id").notNull().references(() => agents.id),
    intentType: text("intent_type").notNull(),
    priority: integer("priority").notNull().default(0),
    status: text("status").notNull().default("queued"),
    dedupeKey: text("dedupe_key"),
    sourceEventId: text("source_event_id"),
    notBefore: timestamp("not_before", { withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyStatusIdx: index("dispatch_intents_company_status_idx").on(table.companyId, table.status),
    issueIdx: index("dispatch_intents_issue_idx").on(table.issueId),
    targetAgentIdx: index("dispatch_intents_target_agent_idx").on(table.targetAgentId),
    dedupeKeyIdx: index("dispatch_intents_dedupe_key_idx").on(table.dedupeKey),
  }),
);
