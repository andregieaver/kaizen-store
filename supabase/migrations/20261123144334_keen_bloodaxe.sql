CREATE TABLE "commerce"."extension_extra_prices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"extension_id" text NOT NULL,
	"unit" text NOT NULL,
	"currency" char(3) NOT NULL,
	"amount_minor" bigint NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "extension_extra_prices_unit" CHECK ("commerce"."extension_extra_prices"."unit" in ('ai_conversation', 'person')),
	CONSTRAINT "extension_extra_prices_amount" CHECK ("commerce"."extension_extra_prices"."amount_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "commerce"."organisation_extra_charges" (
	"organisation_id" uuid NOT NULL,
	"invoice_id" text NOT NULL,
	"mode" text NOT NULL,
	"extension_id" text NOT NULL,
	"unit" text NOT NULL,
	"used" integer NOT NULL,
	"included" integer NOT NULL,
	"quantity" integer NOT NULL,
	"unit_minor" bigint NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"invoice_item_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organisation_extra_charges_pk" PRIMARY KEY("organisation_id","invoice_id","extension_id"),
	CONSTRAINT "organisation_extra_charges_unit" CHECK ("commerce"."organisation_extra_charges"."unit" in ('ai_conversation', 'person')),
	CONSTRAINT "organisation_extra_charges_counts" CHECK ("commerce"."organisation_extra_charges"."used" >= 0 and "commerce"."organisation_extra_charges"."included" >= 0 and "commerce"."organisation_extra_charges"."quantity" >= 0 and "commerce"."organisation_extra_charges"."unit_minor" >= 0 and "commerce"."organisation_extra_charges"."amount_minor" >= 0),
	CONSTRAINT "organisation_extra_charges_period" CHECK ("commerce"."organisation_extra_charges"."period_end" > "commerce"."organisation_extra_charges"."period_start")
);
--> statement-breakpoint
ALTER TABLE "commerce"."organisation_billing" ADD COLUMN "extras_cap_minor" bigint;--> statement-breakpoint
ALTER TABLE "commerce"."extension_extra_prices" ADD CONSTRAINT "extension_extra_prices_extension_id_extensions_id_fk" FOREIGN KEY ("extension_id") REFERENCES "commerce"."extensions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."extension_extra_prices" ADD CONSTRAINT "extension_extra_prices_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."organisation_extra_charges" ADD CONSTRAINT "organisation_extra_charges_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "commerce"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."organisation_extra_charges" ADD CONSTRAINT "organisation_extra_charges_extension_id_extensions_id_fk" FOREIGN KEY ("extension_id") REFERENCES "commerce"."extensions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "extension_extra_prices_one_active" ON "commerce"."extension_extra_prices" USING btree ("extension_id","currency") WHERE "commerce"."extension_extra_prices"."active";--> statement-breakpoint
CREATE INDEX "extension_extra_prices_created_by_idx" ON "commerce"."extension_extra_prices" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "organisation_extra_charges_extension_idx" ON "commerce"."organisation_extra_charges" USING btree ("extension_id");--> statement-breakpoint
ALTER TABLE "commerce"."organisation_billing" ADD CONSTRAINT "organisation_billing_extras_cap" CHECK ("commerce"."organisation_billing"."extras_cap_minor" is null or "commerce"."organisation_billing"."extras_cap_minor" >= 0);