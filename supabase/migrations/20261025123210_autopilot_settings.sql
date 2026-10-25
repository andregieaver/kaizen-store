CREATE TABLE "commerce"."autopilot_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid,
	"paused" boolean DEFAULT false NOT NULL,
	"levels" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"budgets" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "autopilot_settings_store_key" UNIQUE NULLS NOT DISTINCT("store_id"),
	CONSTRAINT "autopilot_settings_levels" CHECK (jsonb_typeof("commerce"."autopilot_settings"."levels") = 'object'),
	CONSTRAINT "autopilot_settings_budgets" CHECK (jsonb_typeof("commerce"."autopilot_settings"."budgets") = 'object')
);
--> statement-breakpoint
ALTER TABLE "commerce"."autopilot_settings" ADD CONSTRAINT "autopilot_settings_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."autopilot_settings" ADD CONSTRAINT "autopilot_settings_updated_by_accounts_id_fk" FOREIGN KEY ("updated_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "autopilot_settings_updated_by_idx" ON "commerce"."autopilot_settings" USING btree ("updated_by");