CREATE TABLE "commerce"."design_variations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"preset_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"theme" jsonb NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "design_variations_key" CHECK ("commerce"."design_variations"."key" ~ '^[a-z0-9][a-z0-9-]{0,39}$'),
	CONSTRAINT "design_variations_name" CHECK (length(btrim("commerce"."design_variations"."name")) between 1 and 40),
	CONSTRAINT "design_variations_theme" CHECK (jsonb_typeof("commerce"."design_variations"."theme") = 'object' and octet_length("commerce"."design_variations"."theme"::text) <= 300000)
);
--> statement-breakpoint
ALTER TABLE "commerce"."design_preset_versions" DROP CONSTRAINT "design_preset_versions_snapshot";--> statement-breakpoint
ALTER TABLE "commerce"."design_presets" DROP CONSTRAINT "design_presets_snapshot";--> statement-breakpoint
ALTER TABLE "commerce"."platform_theme_installs" ADD COLUMN "variation" text;--> statement-breakpoint
ALTER TABLE "commerce"."store_theme_installs" ADD COLUMN "variation" text;--> statement-breakpoint
ALTER TABLE "commerce"."design_variations" ADD CONSTRAINT "design_variations_preset_id_design_presets_id_fk" FOREIGN KEY ("preset_id") REFERENCES "commerce"."design_presets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."design_variations" ADD CONSTRAINT "design_variations_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."design_variations" ADD CONSTRAINT "design_variations_updated_by_accounts_id_fk" FOREIGN KEY ("updated_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "design_variations_key_idx" ON "commerce"."design_variations" USING btree ("preset_id","key");--> statement-breakpoint
CREATE INDEX "design_variations_created_by_idx" ON "commerce"."design_variations" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "design_variations_updated_by_idx" ON "commerce"."design_variations" USING btree ("updated_by");--> statement-breakpoint
ALTER TABLE "commerce"."design_preset_versions" ADD CONSTRAINT "design_preset_versions_snapshot" CHECK (jsonb_typeof("commerce"."design_preset_versions"."snapshot") = 'object' and "commerce"."design_preset_versions"."snapshot" ->> 'v' in ('1', '2') and octet_length("commerce"."design_preset_versions"."snapshot"::text) <= 2000000);--> statement-breakpoint
ALTER TABLE "commerce"."design_presets" ADD CONSTRAINT "design_presets_snapshot" CHECK (jsonb_typeof("commerce"."design_presets"."snapshot") = 'object' and "commerce"."design_presets"."snapshot" ->> 'v' in ('1', '2') and octet_length("commerce"."design_presets"."snapshot"::text) <= 2000000);