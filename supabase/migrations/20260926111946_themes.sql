CREATE TABLE "commerce"."store_themes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"name" text NOT NULL,
	"base" text NOT NULL,
	"settings" jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "store_themes_name_length" CHECK (length("commerce"."store_themes"."name") between 1 and 60),
	CONSTRAINT "store_themes_base" CHECK ("commerce"."store_themes"."base" in ('minimal', 'warm'))
);
--> statement-breakpoint
ALTER TABLE "commerce"."stores" ADD COLUMN "theme" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."store_themes" ADD CONSTRAINT "store_themes_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."store_themes" ADD CONSTRAINT "store_themes_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "store_themes_name_idx" ON "commerce"."store_themes" USING btree ("store_id",lower("name"));--> statement-breakpoint
CREATE INDEX "store_themes_created_by_idx" ON "commerce"."store_themes" USING btree ("created_by");