import { pgTable, uuid, text, timestamp, index } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { issues } from "./issues.js";
import { agents } from "./agents.js";
import { heartbeatRuns } from "./heartbeat_runs.js";

export const executionLeases = pgTable(
  "execution_leases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    leaseType: text("lease_type").notNull(),
    issueId: uuid("issue_id").references(() => issues.id),
    agentId: uuid("agent_id").notNull().references(() => agents.id),
    runId: uuid("run_id").references(() => heartbeatRuns.id),
    state: text("state").notNull().default("granted"),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
    renewedAt: timestamp("renewed_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    releaseReason: text("release_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyStateIdx: index("execution_leases_company_state_idx").on(table.companyId, table.state),
    issueIdx: index("execution_leases_issue_idx").on(table.issueId),
    agentIdx: index("execution_leases_agent_idx").on(table.agentId),
    runIdx: index("execution_leases_run_idx").on(table.runId),
    expiresAtIdx: index("execution_leases_expires_at_idx").on(table.expiresAt),
  }),
);
