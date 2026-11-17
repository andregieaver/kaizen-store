CREATE TABLE "commerce"."form_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid,
	"kind" text NOT NULL,
	"category" text DEFAULT 'other' NOT NULL,
	"name" jsonb NOT NULL,
	"description" jsonb DEFAULT '{"text":"","byLocale":{}}'::jsonb NOT NULL,
	"lang" text DEFAULT 'en' NOT NULL,
	"content" jsonb NOT NULL,
	"sharing" text DEFAULT 'private' NOT NULL,
	"starter" text,
	"form_id" uuid,
	"hidden_at" timestamp with time zone,
	"hidden_by" uuid,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "form_templates_kind" CHECK ("commerce"."form_templates"."kind" in ('message', 'signup')),
	CONSTRAINT "form_templates_category" CHECK ("commerce"."form_templates"."category" in ('contact', 'sales', 'bookings', 'newsletter', 'feedback', 'events', 'other')),
	CONSTRAINT "form_templates_name" CHECK (jsonb_typeof("commerce"."form_templates"."name") = 'object' and char_length(btrim("commerce"."form_templates"."name" ->> 'text')) between 1 and 80),
	CONSTRAINT "form_templates_description" CHECK (jsonb_typeof("commerce"."form_templates"."description") = 'object' and char_length(coalesce("commerce"."form_templates"."description" ->> 'text', '')) <= 200),
	CONSTRAINT "form_templates_lang" CHECK ("commerce"."form_templates"."lang" ~ '^[a-z]{2,3}$'),
	CONSTRAINT "form_templates_content" CHECK (jsonb_typeof("commerce"."form_templates"."content") = 'object'),
	CONSTRAINT "form_templates_sharing" CHECK ("commerce"."form_templates"."sharing" in ('private', 'stores', 'marketplace')),
	CONSTRAINT "form_templates_kaizen_sharing" CHECK ("commerce"."form_templates"."store_id" is not null or "commerce"."form_templates"."sharing" = 'marketplace'),
	CONSTRAINT "form_templates_starter_one" CHECK ("commerce"."form_templates"."starter" is null or ("commerce"."form_templates"."store_id" is null and "commerce"."form_templates"."starter" ~ '^[a-z]{1,40}$'))
);
--> statement-breakpoint
ALTER TABLE "commerce"."form_templates" ADD CONSTRAINT "form_templates_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."form_templates" ADD CONSTRAINT "form_templates_form_id_forms_id_fk" FOREIGN KEY ("form_id") REFERENCES "commerce"."forms"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."form_templates" ADD CONSTRAINT "form_templates_hidden_by_accounts_id_fk" FOREIGN KEY ("hidden_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."form_templates" ADD CONSTRAINT "form_templates_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."form_templates" ADD CONSTRAINT "form_templates_updated_by_accounts_id_fk" FOREIGN KEY ("updated_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "form_templates_store_idx" ON "commerce"."form_templates" USING btree ("store_id","updated_at");--> statement-breakpoint
CREATE INDEX "form_templates_shared_idx" ON "commerce"."form_templates" USING btree ("sharing","updated_at") WHERE "commerce"."form_templates"."sharing" <> 'private';--> statement-breakpoint
CREATE INDEX "form_templates_form_idx" ON "commerce"."form_templates" USING btree ("form_id");--> statement-breakpoint
CREATE INDEX "form_templates_hidden_by_idx" ON "commerce"."form_templates" USING btree ("hidden_by");--> statement-breakpoint
CREATE INDEX "form_templates_created_by_idx" ON "commerce"."form_templates" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "form_templates_updated_by_idx" ON "commerce"."form_templates" USING btree ("updated_by");--> statement-breakpoint
CREATE UNIQUE INDEX "form_templates_starter" ON "commerce"."form_templates" USING btree ("starter") WHERE "commerce"."form_templates"."starter" is not null;