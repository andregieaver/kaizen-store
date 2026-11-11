CREATE TABLE "commerce"."customer_tags" (
	"store_id" uuid NOT NULL,
	"email" text NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_tags_store_id_email_key_pk" PRIMARY KEY("store_id","email","key"),
	CONSTRAINT "customer_tags_email" CHECK ("commerce"."customer_tags"."email" = lower("commerce"."customer_tags"."email") and char_length("commerce"."customer_tags"."email") between 3 and 254),
	CONSTRAINT "customer_tags_key" CHECK (char_length("commerce"."customer_tags"."key") between 1 and 40 and "commerce"."customer_tags"."key" = btrim("commerce"."customer_tags"."key")),
	CONSTRAINT "customer_tags_label" CHECK (char_length("commerce"."customer_tags"."label") between 1 and 40 and "commerce"."customer_tags"."label" = btrim("commerce"."customer_tags"."label")),
	CONSTRAINT "customer_tags_label_chars" CHECK ("commerce"."customer_tags"."label" !~ '[,\x01-\x1f\x7f\u202a-\u202e\u2066-\u2069]')
);
--> statement-breakpoint
CREATE TABLE "commerce"."segments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"title" text NOT NULL,
	"rules" jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "segments_store_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "segments_title" CHECK (char_length("commerce"."segments"."title") between 1 and 80 and "commerce"."segments"."title" = btrim("commerce"."segments"."title")),
	CONSTRAINT "segments_rules" CHECK (jsonb_typeof("commerce"."segments"."rules") = 'object' and jsonb_typeof("commerce"."segments"."rules" -> 'conditions') = 'array' and jsonb_array_length("commerce"."segments"."rules" -> 'conditions') <= 20)
);
--> statement-breakpoint
ALTER TABLE "commerce"."customer_tags" ADD CONSTRAINT "customer_tags_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."customer_tags" ADD CONSTRAINT "customer_tags_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."segments" ADD CONSTRAINT "segments_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."segments" ADD CONSTRAINT "segments_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "customer_tags_key_idx" ON "commerce"."customer_tags" USING btree ("store_id","key");--> statement-breakpoint
CREATE INDEX "customer_tags_created_by_idx" ON "commerce"."customer_tags" USING btree ("created_by");--> statement-breakpoint
CREATE UNIQUE INDEX "segments_title_idx" ON "commerce"."segments" USING btree ("store_id",lower("title"));--> statement-breakpoint
CREATE INDEX "segments_created_by_idx" ON "commerce"."segments" USING btree ("created_by");