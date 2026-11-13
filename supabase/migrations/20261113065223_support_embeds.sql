CREATE TABLE "commerce"."support_embeds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid,
	"host" text NOT NULL,
	"key" text NOT NULL,
	"market" text,
	"privacy_url" text,
	"verified_at" timestamp with time zone,
	"verified_by" text,
	"checked_at" timestamp with time zone,
	"check_problem" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "support_embeds_key" UNIQUE("key"),
	CONSTRAINT "support_embeds_host_key" UNIQUE NULLS NOT DISTINCT("store_id","host"),
	CONSTRAINT "support_embeds_key_shape" CHECK ("commerce"."support_embeds"."key" ~ '^[a-z0-9]{20}$'),
	CONSTRAINT "support_embeds_host_shape" CHECK (length("commerce"."support_embeds"."host") between 4 and 253 and "commerce"."support_embeds"."host" ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])?$'),
	CONSTRAINT "support_embeds_market" CHECK ("commerce"."support_embeds"."market" is null or ("commerce"."support_embeds"."store_id" is not null and length("commerce"."support_embeds"."market") between 2 and 20)),
	CONSTRAINT "support_embeds_privacy_url" CHECK ("commerce"."support_embeds"."privacy_url" is null or ("commerce"."support_embeds"."privacy_url" ~ '^https://' and length("commerce"."support_embeds"."privacy_url") <= 500)),
	CONSTRAINT "support_embeds_verified" CHECK (("commerce"."support_embeds"."verified_at" is null) = ("commerce"."support_embeds"."verified_by" is null) and ("commerce"."support_embeds"."verified_by" is null or "commerce"."support_embeds"."verified_by" in ('page', 'dns'))),
	CONSTRAINT "support_embeds_check_problem" CHECK ("commerce"."support_embeds"."check_problem" is null or "commerce"."support_embeds"."check_problem" in ('unreachable', 'not_found', 'moved'))
);
--> statement-breakpoint
ALTER TABLE "commerce"."support_embeds" ADD CONSTRAINT "support_embeds_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."support_embeds" ADD CONSTRAINT "support_embeds_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "support_embeds_created_by_idx" ON "commerce"."support_embeds" USING btree ("created_by");