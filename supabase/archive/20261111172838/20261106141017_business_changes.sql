CREATE TABLE "commerce"."store_business_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"status" text DEFAULT 'planned' NOT NULL,
	"starts_on" date NOT NULL,
	"legal_name" text NOT NULL,
	"business_form" text NOT NULL,
	"organisation_number" text,
	"vat_registered" boolean DEFAULT false NOT NULL,
	"vat_number" text,
	"postal_address" text,
	"prefixes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"before" jsonb,
	"series_start" jsonb,
	"applied_at" timestamp with time zone,
	"refreshed_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "store_business_changes_status" CHECK ("commerce"."store_business_changes"."status" in ('planned', 'applied', 'cancelled')),
	CONSTRAINT "store_business_changes_form" CHECK ("commerce"."store_business_changes"."business_form" in ('enk', 'as', 'asa', 'nuf', 'da', 'ans', 'sa', 'other')),
	CONSTRAINT "store_business_changes_legal_name" CHECK ("commerce"."store_business_changes"."legal_name" = btrim("commerce"."store_business_changes"."legal_name") and char_length("commerce"."store_business_changes"."legal_name") between 1 and 200),
	CONSTRAINT "store_business_changes_applied" CHECK (("commerce"."store_business_changes"."status" = 'applied') = ("commerce"."store_business_changes"."applied_at" is not null)),
	CONSTRAINT "store_business_changes_vat" CHECK ("commerce"."store_business_changes"."vat_number" is null or "commerce"."store_business_changes"."vat_registered"),
	CONSTRAINT "store_business_changes_prefixes" CHECK (jsonb_typeof("commerce"."store_business_changes"."prefixes") = 'object')
);
--> statement-breakpoint
ALTER TABLE "commerce"."store_business_changes" ADD CONSTRAINT "store_business_changes_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."store_business_changes" ADD CONSTRAINT "store_business_changes_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "store_business_changes_planned_key" ON "commerce"."store_business_changes" USING btree ("store_id") WHERE "commerce"."store_business_changes"."status" = 'planned';--> statement-breakpoint
CREATE INDEX "store_business_changes_store_idx" ON "commerce"."store_business_changes" USING btree ("store_id","starts_on");--> statement-breakpoint
CREATE INDEX "store_business_changes_due_idx" ON "commerce"."store_business_changes" USING btree ("starts_on") WHERE "commerce"."store_business_changes"."status" = 'planned';--> statement-breakpoint
CREATE INDEX "store_business_changes_created_by_idx" ON "commerce"."store_business_changes" USING btree ("created_by");