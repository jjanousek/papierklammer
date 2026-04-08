import { pgTable, uuid, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";

export const companyLifecycleEvents = pgTable(
  "company_lifecycle_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull(),
    actorType: text("actor_type").notNull().default("system"),
    actorId: text("actor_id").notNull(),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull().default("company"),
    entityId: text("entity_id").notNull(),
    agentId: uuid("agent_id"),
    runId: uuid("run_id"),
    details: jsonb("details").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyCreatedIdx: index("company_lifecycle_events_company_created_idx").on(table.companyId, table.createdAt),
    entityIdx: index("company_lifecycle_events_entity_type_id_idx").on(table.entityType, table.entityId),
  }),
);
