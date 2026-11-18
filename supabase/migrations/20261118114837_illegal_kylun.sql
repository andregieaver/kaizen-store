CREATE TABLE "commerce"."flow_run_steps" (
	"store_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"step_id" text NOT NULL,
	"outcome" text NOT NULL,
	"suppressed_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "flow_run_steps_run_id_step_id_pk" PRIMARY KEY("run_id","step_id"),
	CONSTRAINT "flow_run_steps_outcome" CHECK ("commerce"."flow_run_steps"."outcome" in ('sent', 'logged', 'failed', 'suppressed')),
	CONSTRAINT "flow_run_steps_reason" CHECK ("commerce"."flow_run_steps"."suppressed_reason" is null or "commerce"."flow_run_steps"."suppressed_reason" in ('cap', 'spacing', 'room', 'paused'))
);
--> statement-breakpoint
CREATE TABLE "commerce"."flow_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"flow_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"subscriber_id" uuid NOT NULL,
	"entry_key" text NOT NULL,
	"path" text,
	"status" text DEFAULT 'running' NOT NULL,
	"wake_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_until" timestamp with time zone,
	"entered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	CONSTRAINT "flow_runs_store_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "flow_runs_entry_key" UNIQUE("flow_id","entry_key"),
	CONSTRAINT "flow_runs_status" CHECK ("commerce"."flow_runs"."status" in ('running', 'goal', 'done', 'stopped')),
	CONSTRAINT "flow_runs_ended" CHECK (("commerce"."flow_runs"."status" = 'running') = ("commerce"."flow_runs"."ended_at" is null))
);
--> statement-breakpoint
CREATE TABLE "commerce"."flow_versions" (
	"store_id" uuid NOT NULL,
	"flow_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"steps" jsonb NOT NULL,
	"goals" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "flow_versions_flow_id_version_pk" PRIMARY KEY("flow_id","version")
);
--> statement-breakpoint
CREATE TABLE "commerce"."flows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"name" text NOT NULL,
	"trigger" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"tested_version" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "flows_store_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "flows_name" CHECK (char_length("commerce"."flows"."name") between 1 and 120),
	CONSTRAINT "flows_trigger" CHECK ("commerce"."flows"."trigger" in ('subscriber.subscribed', 'order.paid', 'checkout.abandoned')),
	CONSTRAINT "flows_on_when_tested" CHECK (not "commerce"."flows"."enabled" or "commerce"."flows"."tested_version" = "commerce"."flows"."version")
);
--> statement-breakpoint
ALTER TABLE "commerce"."flow_run_steps" ADD CONSTRAINT "flow_run_steps_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."flow_run_steps" ADD CONSTRAINT "flow_run_steps_run_fk" FOREIGN KEY ("store_id","run_id") REFERENCES "commerce"."flow_runs"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."flow_runs" ADD CONSTRAINT "flow_runs_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."flow_runs" ADD CONSTRAINT "flow_runs_flow_fk" FOREIGN KEY ("store_id","flow_id") REFERENCES "commerce"."flows"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."flow_runs" ADD CONSTRAINT "flow_runs_subscriber_fk" FOREIGN KEY ("store_id","subscriber_id") REFERENCES "commerce"."marketing_subscribers"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."flow_versions" ADD CONSTRAINT "flow_versions_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."flow_versions" ADD CONSTRAINT "flow_versions_flow_fk" FOREIGN KEY ("store_id","flow_id") REFERENCES "commerce"."flows"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."flows" ADD CONSTRAINT "flows_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "flow_run_steps_store_idx" ON "commerce"."flow_run_steps" USING btree ("store_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "flow_runs_one_running_idx" ON "commerce"."flow_runs" USING btree ("flow_id","subscriber_id") WHERE "commerce"."flow_runs"."status" = 'running';--> statement-breakpoint
CREATE INDEX "flow_runs_due_idx" ON "commerce"."flow_runs" USING btree ("wake_at") WHERE "commerce"."flow_runs"."status" = 'running';--> statement-breakpoint
CREATE INDEX "flow_runs_subscriber_idx" ON "commerce"."flow_runs" USING btree ("store_id","subscriber_id");--> statement-breakpoint
CREATE INDEX "flow_runs_ended_idx" ON "commerce"."flow_runs" USING btree ("ended_at");--> statement-breakpoint
CREATE INDEX "flows_store_trigger_idx" ON "commerce"."flows" USING btree ("store_id","trigger") WHERE "commerce"."flows"."enabled";