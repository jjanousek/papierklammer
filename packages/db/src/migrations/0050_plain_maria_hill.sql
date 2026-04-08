CREATE TABLE "company_lifecycle_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"actor_type" text DEFAULT 'system' NOT NULL,
	"actor_id" text NOT NULL,
	"action" text NOT NULL,
	"entity_type" text DEFAULT 'company' NOT NULL,
	"entity_id" text NOT NULL,
	"agent_id" uuid,
	"run_id" uuid,
	"details" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "company_lifecycle_events_company_created_idx" ON "company_lifecycle_events" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE INDEX "company_lifecycle_events_entity_type_id_idx" ON "company_lifecycle_events" USING btree ("entity_type","entity_id");