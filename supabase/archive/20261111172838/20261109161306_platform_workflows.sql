CREATE TABLE "commerce"."platform_workflow_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_id" uuid NOT NULL,
	"event" text NOT NULL,
	"subject_id" uuid,
	"event_key" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"matched" boolean,
	"outcome" jsonb,
	"claimed_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "platform_workflow_runs_once_key" UNIQUE("workflow_id","event_key"),
	CONSTRAINT "platform_workflow_runs_status" CHECK ("commerce"."platform_workflow_runs"."status" in ('pending', 'done', 'failed', 'capped'))
);
--> statement-breakpoint
CREATE TABLE "commerce"."platform_workflows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"trigger" text NOT NULL,
	"schedule" jsonb,
	"conditions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"actions" jsonb NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"tested_version" integer,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_workflows_name" CHECK (char_length("commerce"."platform_workflows"."name") between 1 and 80),
	CONSTRAINT "platform_workflows_trigger" CHECK ("commerce"."platform_workflows"."trigger" in ('request.received', 'store.created', 'store.opened', 'plan.started', 'plan.changed', 'plan.cancelled', 'plan.payment_failed', 'report.received', 'schedule')),
	CONSTRAINT "platform_workflows_on_when_tested" CHECK (not "commerce"."platform_workflows"."enabled" or coalesce("commerce"."platform_workflows"."tested_version" = "commerce"."platform_workflows"."version", false))
);
--> statement-breakpoint
ALTER TABLE "commerce"."platform_workflow_runs" ADD CONSTRAINT "platform_workflow_runs_workflow_id_platform_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "commerce"."platform_workflows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."platform_workflows" ADD CONSTRAINT "platform_workflows_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."platform_workflows" ADD CONSTRAINT "platform_workflows_updated_by_accounts_id_fk" FOREIGN KEY ("updated_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "platform_workflow_runs_due_idx" ON "commerce"."platform_workflow_runs" USING btree ("created_at") WHERE "commerce"."platform_workflow_runs"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "platform_workflow_runs_workflow_idx" ON "commerce"."platform_workflow_runs" USING btree ("workflow_id","created_at");--> statement-breakpoint
CREATE INDEX "platform_workflows_trigger_idx" ON "commerce"."platform_workflows" USING btree ("trigger") WHERE "commerce"."platform_workflows"."enabled";--> statement-breakpoint
CREATE INDEX "platform_workflows_created_by_idx" ON "commerce"."platform_workflows" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "platform_workflows_updated_by_idx" ON "commerce"."platform_workflows" USING btree ("updated_by");