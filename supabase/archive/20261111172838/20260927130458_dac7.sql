CREATE TABLE "commerce"."host_tax_details" (
	"host_id" uuid PRIMARY KEY NOT NULL,
	"store_id" uuid NOT NULL,
	"kind" text DEFAULT 'individual' NOT NULL,
	"legal_name" text NOT NULL,
	"date_of_birth" date,
	"address" text NOT NULL,
	"country" char(2) NOT NULL,
	"tin" text NOT NULL,
	"tin_country" char(2) NOT NULL,
	"vat_number" text DEFAULT '' NOT NULL,
	"business_number" text DEFAULT '' NOT NULL,
	"iban" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "host_tax_details_kind" CHECK ("commerce"."host_tax_details"."kind" in ('individual', 'entity')),
	CONSTRAINT "host_tax_details_person" CHECK ("commerce"."host_tax_details"."kind" = 'entity' or "commerce"."host_tax_details"."date_of_birth" is not null),
	CONSTRAINT "host_tax_details_business" CHECK ("commerce"."host_tax_details"."kind" = 'individual' or "commerce"."host_tax_details"."business_number" <> '')
);
--> statement-breakpoint
ALTER TABLE "commerce"."booking_resources" ADD COLUMN "property_address" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."booking_resources" ADD COLUMN "land_registry_number" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."host_tax_details" ADD CONSTRAINT "host_tax_details_host_fk" FOREIGN KEY ("store_id","host_id") REFERENCES "commerce"."hosts"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "host_tax_details_store_idx" ON "commerce"."host_tax_details" USING btree ("store_id","host_id");