import { pgTable, uuid, timestamp, primaryKey } from "drizzle-orm/pg-core";
import { issues } from "./issues.js";
import { companies } from "./companies.js";

export const issueDependencies = pgTable(
  "issue_dependencies",
  {
    issueId: uuid("issue_id").notNull().references(() => issues.id),
    dependsOnIssueId: uuid("depends_on_issue_id").notNull().references(() => issues.id),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.issueId, table.dependsOnIssueId] }),
  }),
);
