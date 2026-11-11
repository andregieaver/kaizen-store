CREATE TABLE "commerce"."sandboxes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"source_store_id" uuid,
	"pass_hash" text NOT NULL,
	"state" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"first_change_at" timestamp with time zone,
	"first_publish_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	CONSTRAINT "sandboxes_store_id_unique" UNIQUE("store_id"),
	CONSTRAINT "sandboxes_state" CHECK ("commerce"."sandboxes"."state" in ('open', 'expired', 'kept', 'purged')),
	CONSTRAINT "sandboxes_pass_hash" CHECK ("commerce"."sandboxes"."pass_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "sandboxes_time" CHECK ("commerce"."sandboxes"."expires_at" <= "commerce"."sandboxes"."created_at" + interval '30 days'),
	CONSTRAINT "sandboxes_ended" CHECK (("commerce"."sandboxes"."state" = 'open') = ("commerce"."sandboxes"."ended_at" is null))
);
--> statement-breakpoint
ALTER TABLE "commerce"."platform_settings" ADD COLUMN "sandbox_on" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."platform_settings" ADD COLUMN "sandbox_daily_cap" integer DEFAULT 300 NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."platform_settings" ADD COLUMN "sandbox_source" uuid;--> statement-breakpoint
ALTER TABLE "commerce"."stores" ADD COLUMN "sandbox" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."sandboxes" ADD CONSTRAINT "sandboxes_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."sandboxes" ADD CONSTRAINT "sandboxes_source_store_id_stores_id_fk" FOREIGN KEY ("source_store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sandboxes_open_idx" ON "commerce"."sandboxes" USING btree ("expires_at") WHERE "commerce"."sandboxes"."state" = 'open';--> statement-breakpoint
CREATE INDEX "sandboxes_created_idx" ON "commerce"."sandboxes" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "sandboxes_source_idx" ON "commerce"."sandboxes" USING btree ("source_store_id");--> statement-breakpoint
ALTER TABLE "commerce"."platform_settings" ADD CONSTRAINT "platform_settings_sandbox_source_store_starters_id_fk" FOREIGN KEY ("sandbox_source") REFERENCES "commerce"."store_starters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "platform_settings_sandbox_source_idx" ON "commerce"."platform_settings" USING btree ("sandbox_source");--> statement-breakpoint
ALTER TABLE "commerce"."platform_settings" ADD CONSTRAINT "platform_settings_sandbox_daily_cap" CHECK ("commerce"."platform_settings"."sandbox_daily_cap" between 0 and 10000);--> statement-breakpoint
ALTER TABLE "commerce"."stores" ADD CONSTRAINT "stores_sandbox_address" CHECK (not "commerce"."stores"."sandbox" or "commerce"."stores"."slug" like 'try-%');--> statement-breakpoint
ALTER TABLE "commerce"."stores" ADD CONSTRAINT "stores_sandbox_not_template" CHECK (not ("commerce"."stores"."sandbox" and ("commerce"."stores"."is_template" or "commerce"."stores"."starter")));--> statement-breakpoint
ALTER TABLE "commerce"."sandboxes" ENABLE ROW LEVEL SECURITY;
