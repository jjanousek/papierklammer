import { pgTable, uuid, text, timestamp, jsonb, index, bigserial } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const controlPlaneEvents = pgTable(
  "control_plane_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyCreatedIdx: index("control_plane_events_company_created_idx").on(table.companyId, table.createdAt),
    entityIdx: index("control_plane_events_entity_type_id_idx").on(table.entityType, table.entityId),
    eventTypeIdx: index("control_plane_events_event_type_idx").on(table.eventType),
  }),
);
