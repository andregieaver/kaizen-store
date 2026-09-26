CREATE TABLE "commerce"."store_domains" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"hostname" text NOT NULL,
	"token" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"checks" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"checked_at" timestamp with time zone,
	"activated_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "store_domains_status" CHECK ("commerce"."store_domains"."status" in ('pending', 'active')),
	CONSTRAINT "store_domains_primary_active" CHECK (not "commerce"."store_domains"."is_primary" or "commerce"."store_domains"."status" = 'active'),
	CONSTRAINT "store_domains_hostname" CHECK ("commerce"."store_domains"."hostname" ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$' and length("commerce"."store_domains"."hostname") <= 253)
);
--> statement-breakpoint
ALTER TABLE "commerce"."platform_settings" ADD COLUMN "domains_deploy_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "commerce"."store_domains" ADD CONSTRAINT "store_domains_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."store_domains" ADD CONSTRAINT "store_domains_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "store_domains_store_hostname_idx" ON "commerce"."store_domains" USING btree ("store_id","hostname");--> statement-breakpoint
CREATE UNIQUE INDEX "store_domains_active_hostname_idx" ON "commerce"."store_domains" USING btree ("hostname") WHERE "commerce"."store_domains"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "store_domains_primary_idx" ON "commerce"."store_domains" USING btree ("store_id") WHERE "commerce"."store_domains"."is_primary";--> statement-breakpoint
CREATE INDEX "store_domains_hostname_idx" ON "commerce"."store_domains" USING btree ("hostname");--> statement-breakpoint
CREATE INDEX "store_domains_created_by_idx" ON "commerce"."store_domains" USING btree ("created_by");