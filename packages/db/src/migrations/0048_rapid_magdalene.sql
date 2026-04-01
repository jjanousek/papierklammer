CREATE TABLE "issue_dependencies" (
	"issue_id" uuid NOT NULL,
	"depends_on_issue_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "issue_dependencies_issue_id_depends_on_issue_id_pk" PRIMARY KEY("issue_id","depends_on_issue_id")
);
--> statement-breakpoint
ALTER TABLE "heartbeat_runs" ADD COLUMN "intent_id" uuid;--> statement-breakpoint
ALTER TABLE "heartbeat_runs" ADD COLUMN "envelope_id" uuid;--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "execution_lease_id" uuid;--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "pickup_fail_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "last_pickup_failure_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "last_reconciled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "issue_dependencies" ADD CONSTRAINT "issue_dependencies_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_dependencies" ADD CONSTRAINT "issue_dependencies_depends_on_issue_id_issues_id_fk" FOREIGN KEY ("depends_on_issue_id") REFERENCES "public"."issues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_dependencies" ADD CONSTRAINT "issue_dependencies_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "heartbeat_runs" ADD CONSTRAINT "heartbeat_runs_intent_id_dispatch_intents_id_fk" FOREIGN KEY ("intent_id") REFERENCES "public"."dispatch_intents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "heartbeat_runs" ADD CONSTRAINT "heartbeat_runs_envelope_id_execution_envelopes_id_fk" FOREIGN KEY ("envelope_id") REFERENCES "public"."execution_envelopes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_execution_lease_id_execution_leases_id_fk" FOREIGN KEY ("execution_lease_id") REFERENCES "public"."execution_leases"("id") ON DELETE no action ON UPDATE no action;