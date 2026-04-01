CREATE TABLE "control_plane_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dispatch_intents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"issue_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"goal_id" uuid,
	"workspace_id" uuid,
	"target_agent_id" uuid NOT NULL,
	"intent_type" text NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"dedupe_key" text,
	"source_event_id" text,
	"not_before" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "execution_envelopes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"issue_id" uuid NOT NULL,
	"project_id" uuid,
	"goal_id" uuid,
	"workspace_id" uuid,
	"wake_reason" text NOT NULL,
	"run_kind" text NOT NULL,
	"execution_policy_version" text DEFAULT '1' NOT NULL,
	"workspace_binding_mode" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "execution_leases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lease_type" text NOT NULL,
	"issue_id" uuid,
	"agent_id" uuid NOT NULL,
	"run_id" uuid,
	"state" text DEFAULT 'granted' NOT NULL,
	"company_id" uuid NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"renewed_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"released_at" timestamp with time zone,
	"release_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "control_plane_events" ADD CONSTRAINT "control_plane_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatch_intents" ADD CONSTRAINT "dispatch_intents_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatch_intents" ADD CONSTRAINT "dispatch_intents_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatch_intents" ADD CONSTRAINT "dispatch_intents_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatch_intents" ADD CONSTRAINT "dispatch_intents_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatch_intents" ADD CONSTRAINT "dispatch_intents_target_agent_id_agents_id_fk" FOREIGN KEY ("target_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_envelopes" ADD CONSTRAINT "execution_envelopes_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."heartbeat_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_envelopes" ADD CONSTRAINT "execution_envelopes_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_envelopes" ADD CONSTRAINT "execution_envelopes_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_envelopes" ADD CONSTRAINT "execution_envelopes_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_envelopes" ADD CONSTRAINT "execution_envelopes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_envelopes" ADD CONSTRAINT "execution_envelopes_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_leases" ADD CONSTRAINT "execution_leases_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_leases" ADD CONSTRAINT "execution_leases_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_leases" ADD CONSTRAINT "execution_leases_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."heartbeat_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_leases" ADD CONSTRAINT "execution_leases_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "control_plane_events_company_created_idx" ON "control_plane_events" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE INDEX "control_plane_events_entity_type_id_idx" ON "control_plane_events" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "control_plane_events_event_type_idx" ON "control_plane_events" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "dispatch_intents_company_status_idx" ON "dispatch_intents" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "dispatch_intents_issue_idx" ON "dispatch_intents" USING btree ("issue_id");--> statement-breakpoint
CREATE INDEX "dispatch_intents_target_agent_idx" ON "dispatch_intents" USING btree ("target_agent_id");--> statement-breakpoint
CREATE INDEX "dispatch_intents_dedupe_key_idx" ON "dispatch_intents" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "execution_envelopes_run_idx" ON "execution_envelopes" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "execution_envelopes_company_idx" ON "execution_envelopes" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "execution_envelopes_agent_idx" ON "execution_envelopes" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "execution_envelopes_issue_idx" ON "execution_envelopes" USING btree ("issue_id");--> statement-breakpoint
CREATE INDEX "execution_leases_company_state_idx" ON "execution_leases" USING btree ("company_id","state");--> statement-breakpoint
CREATE INDEX "execution_leases_issue_idx" ON "execution_leases" USING btree ("issue_id");--> statement-breakpoint
CREATE INDEX "execution_leases_agent_idx" ON "execution_leases" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "execution_leases_run_idx" ON "execution_leases" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "execution_leases_expires_at_idx" ON "execution_leases" USING btree ("expires_at");