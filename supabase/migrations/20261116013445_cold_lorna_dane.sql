CREATE TABLE "commerce"."automation_steps" (
	"store_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"position" smallint NOT NULL,
	"delay_days" integer NOT NULL,
	"content" jsonb NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "automation_steps_store_id_kind_position_pk" PRIMARY KEY("store_id","kind","position"),
	CONSTRAINT "automation_steps_kind" CHECK ("commerce"."automation_steps"."kind" in ('welcome', 'after_purchase', 'win_back', 'cross_sell', 'replenish')),
	CONSTRAINT "automation_steps_position" CHECK ("commerce"."automation_steps"."position" between 2 and 3),
	CONSTRAINT "automation_steps_delay" CHECK ("commerce"."automation_steps"."delay_days" between 1 and 60)
);
--> statement-breakpoint
ALTER TABLE "commerce"."automation_sends" DROP CONSTRAINT "automation_sends_kind";--> statement-breakpoint
ALTER TABLE "commerce"."automations" DROP CONSTRAINT "automations_kind";--> statement-breakpoint
ALTER TABLE "commerce"."automations" DROP CONSTRAINT "automations_delay";--> statement-breakpoint
ALTER TABLE "commerce"."automation_sends" ADD COLUMN "step" smallint DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."automation_steps" ADD CONSTRAINT "automation_steps_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."automation_steps" ADD CONSTRAINT "automation_steps_updated_by_accounts_id_fk" FOREIGN KEY ("updated_by") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."automation_steps" ADD CONSTRAINT "automation_steps_automation_fk" FOREIGN KEY ("store_id","kind") REFERENCES "commerce"."automations"("store_id","kind") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "automation_steps_updated_by_idx" ON "commerce"."automation_steps" USING btree ("updated_by");--> statement-breakpoint
ALTER TABLE "commerce"."automation_sends" ADD CONSTRAINT "automation_sends_step" CHECK ("commerce"."automation_sends"."step" between 1 and 3);--> statement-breakpoint
ALTER TABLE "commerce"."automation_sends" ADD CONSTRAINT "automation_sends_kind" CHECK ("commerce"."automation_sends"."kind" in ('welcome', 'after_purchase', 'win_back', 'cross_sell', 'replenish'));--> statement-breakpoint
ALTER TABLE "commerce"."automations" ADD CONSTRAINT "automations_kind" CHECK ("commerce"."automations"."kind" in ('welcome', 'after_purchase', 'win_back', 'cross_sell', 'replenish', 'back_in_stock'));--> statement-breakpoint
ALTER TABLE "commerce"."automations" ADD CONSTRAINT "automations_delay" CHECK (case "commerce"."automations"."kind" when 'welcome' then "commerce"."automations"."delay_days" between 0 and 30 when 'after_purchase' then "commerce"."automations"."delay_days" between 1 and 90 when 'win_back' then "commerce"."automations"."delay_days" between 30 and 730 when 'cross_sell' then "commerce"."automations"."delay_days" between 1 and 90 when 'replenish' then "commerce"."automations"."delay_days" between 7 and 365 else "commerce"."automations"."delay_days" is null end);--> statement-breakpoint
-- Row-level security, no policy: the commerce schema is private to the server.
ALTER TABLE "commerce"."automation_steps" ENABLE ROW LEVEL SECURITY;
