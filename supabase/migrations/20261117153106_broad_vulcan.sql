CREATE TABLE "commerce"."sending_domains" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid,
	"domain" text NOT NULL,
	"from_local" text DEFAULT 'news' NOT NULL,
	"provider_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"records" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"records_written" boolean DEFAULT false NOT NULL,
	"problem" text,
	"checked_at" timestamp with time zone,
	"verified_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sending_domains_store_key" UNIQUE NULLS NOT DISTINCT("store_id"),
	CONSTRAINT "sending_domains_domain" CHECK ("commerce"."sending_domains"."domain" ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}$' and char_length("commerce"."sending_domains"."domain") <= 253),
	CONSTRAINT "sending_domains_from_local" CHECK ("commerce"."sending_domains"."from_local" ~ '^[a-z0-9]([a-z0-9._-]{0,38}[a-z0-9])?$'),
	CONSTRAINT "sending_domains_status" CHECK ("commerce"."sending_domains"."status" in ('pending', 'verified', 'failed')),
	CONSTRAINT "sending_domains_records" CHECK (jsonb_typeof("commerce"."sending_domains"."records") = 'array' and jsonb_array_length("commerce"."sending_domains"."records") <= 10),
	CONSTRAINT "sending_domains_verified_at" CHECK ("commerce"."sending_domains"."status" <> 'verified' or "commerce"."sending_domains"."verified_at" is not null),
	CONSTRAINT "sending_domains_problem" CHECK ("commerce"."sending_domains"."problem" is null or char_length("commerce"."sending_domains"."problem") between 1 and 500)
);
--> statement-breakpoint
ALTER TABLE "commerce"."sending_domains" ADD CONSTRAINT "sending_domains_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."sending_domains" ADD CONSTRAINT "sending_domains_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sending_domains_created_by_idx" ON "commerce"."sending_domains" USING btree ("created_by");