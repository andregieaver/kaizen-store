CREATE TABLE "commerce"."text_styles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"css" text,
	"position" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "text_styles_owner_slug" UNIQUE NULLS NOT DISTINCT("store_id","slug"),
	CONSTRAINT "text_styles_slug" CHECK ("commerce"."text_styles"."slug" ~ '^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$'),
	CONSTRAINT "text_styles_name" CHECK (length(btrim("commerce"."text_styles"."name")) between 1 and 60),
	CONSTRAINT "text_styles_kind" CHECK ("commerce"."text_styles"."kind" in ('gradient', 'highlight', 'outline', 'underline', 'glow', 'colour', 'smallCaps', 'spacedCaps', 'custom')),
	CONSTRAINT "text_styles_css" CHECK ("commerce"."text_styles"."css" is null or length("commerce"."text_styles"."css") <= 2000)
);
--> statement-breakpoint
ALTER TABLE "commerce"."text_styles" ADD CONSTRAINT "text_styles_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."text_styles" ADD CONSTRAINT "text_styles_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."text_styles" ADD CONSTRAINT "text_styles_updated_by_accounts_id_fk" FOREIGN KEY ("updated_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "text_styles_created_by_idx" ON "commerce"."text_styles" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "text_styles_updated_by_idx" ON "commerce"."text_styles" USING btree ("updated_by");