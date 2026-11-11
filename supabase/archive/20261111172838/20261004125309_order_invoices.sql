-- Invoices and credit notes for shop orders (D159, docs/wave-1b-invoices.md): the tables and constraints Drizzle can express.
-- The two document tables have been empty since the first schema, so the new NOT NULL columns need no back-fill; the migration
-- says so loudly if that is no longer true (nothing is changed then).
DO $guard$
BEGIN
  IF EXISTS (SELECT 1 FROM commerce.invoices) OR EXISTS (SELECT 1 FROM commerce.credit_notes) THEN
    RAISE EXCEPTION 'order_invoices: commerce.invoices or commerce.credit_notes holds rows, so their new columns cannot be added without a back-fill';
  END IF;
END
$guard$;
--> statement-breakpoint
CREATE TABLE "commerce"."document_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"document_type" text NOT NULL,
	"document_id" uuid NOT NULL,
	"email_message_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_deliveries_key" UNIQUE("store_id","document_type","document_id","email_message_id"),
	CONSTRAINT "document_deliveries_type" CHECK ("commerce"."document_deliveries"."document_type" in ('invoice', 'credit_note'))
);
--> statement-breakpoint
CREATE TABLE "commerce"."document_pdf_state" (
	"store_id" uuid NOT NULL,
	"document_type" text NOT NULL,
	"document_id" uuid NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"last_error" text,
	CONSTRAINT "document_pdf_state_store_id_document_type_document_id_pk" PRIMARY KEY("store_id","document_type","document_id"),
	CONSTRAINT "document_pdf_state_type" CHECK ("commerce"."document_pdf_state"."document_type" in ('invoice', 'credit_note')),
	CONSTRAINT "document_pdf_state_error" CHECK ("commerce"."document_pdf_state"."last_error" is null or length("commerce"."document_pdf_state"."last_error") <= 200)
);
--> statement-breakpoint
CREATE TABLE "commerce"."invoice_settings" (
	"store_id" uuid PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"enabled_from" timestamp with time zone,
	"footer_note" text,
	"email_with_confirmation" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "invoice_settings_footer_note" CHECK ("commerce"."invoice_settings"."footer_note" is null or length("commerce"."invoice_settings"."footer_note") <= 1000)
);
--> statement-breakpoint
DROP INDEX "commerce"."credit_notes_refund_idx";--> statement-breakpoint
DROP INDEX "commerce"."invoices_order_idx";--> statement-breakpoint
ALTER TABLE "commerce"."credit_notes" ADD COLUMN "source" text NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."credit_notes" ADD COLUMN "return_id" uuid;--> statement-breakpoint
ALTER TABLE "commerce"."credit_notes" ADD COLUMN "issued_on" date NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."credit_notes" ADD COLUMN "locale" text NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."credit_notes" ADD COLUMN "net_minor" bigint NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."credit_notes" ADD COLUMN "vat_home_currency" char(3);--> statement-breakpoint
ALTER TABLE "commerce"."credit_notes" ADD COLUMN "vat_home_minor" bigint;--> statement-breakpoint
ALTER TABLE "commerce"."credit_notes" ADD COLUMN "fx_rate" numeric(18, 8);--> statement-breakpoint
ALTER TABLE "commerce"."credit_notes" ADD COLUMN "fx_as_of" date;--> statement-breakpoint
ALTER TABLE "commerce"."credit_notes" ADD COLUMN "fx_source" text;--> statement-breakpoint
ALTER TABLE "commerce"."credit_notes" ADD COLUMN "snapshot" jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."credit_notes" ADD COLUMN "public_token" text;--> statement-breakpoint
ALTER TABLE "commerce"."credit_notes" ADD COLUMN "pdf_path" text;--> statement-breakpoint
ALTER TABLE "commerce"."credit_notes" ADD COLUMN "pdf_sha256" text;--> statement-breakpoint
ALTER TABLE "commerce"."credit_notes" ADD COLUMN "anonymised_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "commerce"."invoices" ADD COLUMN "kind" text DEFAULT 'order' NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."invoices" ADD COLUMN "issued_on" date NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."invoices" ADD COLUMN "supply_date" date NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."invoices" ADD COLUMN "locale" text NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."invoices" ADD COLUMN "net_minor" bigint NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."invoices" ADD COLUMN "vat_kind" text NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."invoices" ADD COLUMN "vat_home_currency" char(3);--> statement-breakpoint
ALTER TABLE "commerce"."invoices" ADD COLUMN "vat_home_minor" bigint;--> statement-breakpoint
ALTER TABLE "commerce"."invoices" ADD COLUMN "fx_rate" numeric(18, 8);--> statement-breakpoint
ALTER TABLE "commerce"."invoices" ADD COLUMN "fx_as_of" date;--> statement-breakpoint
ALTER TABLE "commerce"."invoices" ADD COLUMN "fx_source" text;--> statement-breakpoint
ALTER TABLE "commerce"."invoices" ADD COLUMN "snapshot" jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."invoices" ADD COLUMN "public_token" text;--> statement-breakpoint
ALTER TABLE "commerce"."invoices" ADD COLUMN "pdf_path" text;--> statement-breakpoint
ALTER TABLE "commerce"."invoices" ADD COLUMN "pdf_sha256" text;--> statement-breakpoint
ALTER TABLE "commerce"."invoices" ADD COLUMN "anonymised_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "commerce"."returns" ADD COLUMN "refund_working" jsonb;--> statement-breakpoint
ALTER TABLE "commerce"."document_deliveries" ADD CONSTRAINT "document_deliveries_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."document_deliveries" ADD CONSTRAINT "document_deliveries_email_message_id_email_messages_id_fk" FOREIGN KEY ("email_message_id") REFERENCES "commerce"."email_messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."document_pdf_state" ADD CONSTRAINT "document_pdf_state_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."invoice_settings" ADD CONSTRAINT "invoice_settings_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."invoice_settings" ADD CONSTRAINT "invoice_settings_updated_by_accounts_id_fk" FOREIGN KEY ("updated_by") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_deliveries_email_idx" ON "commerce"."document_deliveries" USING btree ("email_message_id");--> statement-breakpoint
CREATE INDEX "invoice_settings_updated_by_idx" ON "commerce"."invoice_settings" USING btree ("updated_by");--> statement-breakpoint
ALTER TABLE "commerce"."credit_notes" ADD CONSTRAINT "credit_notes_return_fk" FOREIGN KEY ("store_id","return_id") REFERENCES "commerce"."returns"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "credit_notes_return_idx" ON "commerce"."credit_notes" USING btree ("store_id","return_id");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_notes_return_outside_key" ON "commerce"."credit_notes" USING btree ("store_id","return_id") WHERE "commerce"."credit_notes"."source" = 'return_outside';--> statement-breakpoint
CREATE INDEX "credit_notes_issued_idx" ON "commerce"."credit_notes" USING btree ("store_id","issued_on");--> statement-breakpoint
CREATE INDEX "invoices_issued_idx" ON "commerce"."invoices" USING btree ("store_id","issued_on");--> statement-breakpoint
ALTER TABLE "commerce"."credit_notes" ADD CONSTRAINT "credit_notes_refund_key" UNIQUE("store_id","refund_id");--> statement-breakpoint
ALTER TABLE "commerce"."credit_notes" ADD CONSTRAINT "credit_notes_public_token_key" UNIQUE("public_token");--> statement-breakpoint
ALTER TABLE "commerce"."invoices" ADD CONSTRAINT "invoices_order_key" UNIQUE("store_id","order_id");--> statement-breakpoint
ALTER TABLE "commerce"."invoices" ADD CONSTRAINT "invoices_public_token_key" UNIQUE("public_token");--> statement-breakpoint
ALTER TABLE "commerce"."credit_notes" ADD CONSTRAINT "credit_notes_series" CHECK ("commerce"."credit_notes"."series" = 'credit_note');--> statement-breakpoint
ALTER TABLE "commerce"."credit_notes" ADD CONSTRAINT "credit_notes_source" CHECK ("commerce"."credit_notes"."source" in ('refund', 'return_outside'));--> statement-breakpoint
ALTER TABLE "commerce"."credit_notes" ADD CONSTRAINT "credit_notes_source_ref" CHECK (("commerce"."credit_notes"."source" = 'refund' and "commerce"."credit_notes"."refund_id" is not null and "commerce"."credit_notes"."return_id" is null) or ("commerce"."credit_notes"."source" = 'return_outside' and "commerce"."credit_notes"."return_id" is not null and "commerce"."credit_notes"."refund_id" is null));--> statement-breakpoint
ALTER TABLE "commerce"."credit_notes" ADD CONSTRAINT "credit_notes_total" CHECK ("commerce"."credit_notes"."total_minor" > 0 and "commerce"."credit_notes"."total_minor" = "commerce"."credit_notes"."net_minor" + "commerce"."credit_notes"."tax_minor");--> statement-breakpoint
ALTER TABLE "commerce"."credit_notes" ADD CONSTRAINT "credit_notes_vat_home" CHECK (("commerce"."credit_notes"."vat_home_minor" is null) = ("commerce"."credit_notes"."fx_rate" is null) and ("commerce"."credit_notes"."vat_home_minor" is null) = ("commerce"."credit_notes"."vat_home_currency" is null));--> statement-breakpoint
ALTER TABLE "commerce"."credit_notes" ADD CONSTRAINT "credit_notes_fx_source" CHECK ("commerce"."credit_notes"."fx_source" is null or "commerce"."credit_notes"."fx_source" in ('ecb_auto', 'owner'));--> statement-breakpoint
ALTER TABLE "commerce"."credit_notes" ADD CONSTRAINT "credit_notes_public_token" CHECK (("commerce"."credit_notes"."anonymised_at" is null and "commerce"."credit_notes"."public_token" ~ '^crn_[A-Za-z0-9_-]{43}$') or ("commerce"."credit_notes"."anonymised_at" is not null and "commerce"."credit_notes"."public_token" is null));--> statement-breakpoint
ALTER TABLE "commerce"."credit_notes" ADD CONSTRAINT "credit_notes_pdf" CHECK (("commerce"."credit_notes"."pdf_path" is null) = ("commerce"."credit_notes"."pdf_sha256" is null));--> statement-breakpoint
ALTER TABLE "commerce"."credit_notes" ADD CONSTRAINT "credit_notes_snapshot" CHECK (jsonb_typeof("commerce"."credit_notes"."snapshot") = 'object' and "commerce"."credit_notes"."snapshot" ->> 'version' = '1');--> statement-breakpoint
ALTER TABLE "commerce"."invoices" ADD CONSTRAINT "invoices_kind" CHECK ("commerce"."invoices"."kind" = 'order');--> statement-breakpoint
ALTER TABLE "commerce"."invoices" ADD CONSTRAINT "invoices_series" CHECK ("commerce"."invoices"."series" = 'invoice');--> statement-breakpoint
ALTER TABLE "commerce"."invoices" ADD CONSTRAINT "invoices_vat_kind" CHECK ("commerce"."invoices"."vat_kind" in ('standard', 'reverse_charge', 'ioss'));--> statement-breakpoint
ALTER TABLE "commerce"."invoices" ADD CONSTRAINT "invoices_total" CHECK ("commerce"."invoices"."total_minor" > 0 and "commerce"."invoices"."total_minor" = "commerce"."invoices"."net_minor" + "commerce"."invoices"."tax_minor");--> statement-breakpoint
ALTER TABLE "commerce"."invoices" ADD CONSTRAINT "invoices_reverse_charge" CHECK ("commerce"."invoices"."vat_kind" <> 'reverse_charge' or "commerce"."invoices"."tax_minor" = 0);--> statement-breakpoint
ALTER TABLE "commerce"."invoices" ADD CONSTRAINT "invoices_vat_home" CHECK (("commerce"."invoices"."vat_home_minor" is null) = ("commerce"."invoices"."fx_rate" is null) and ("commerce"."invoices"."vat_home_minor" is null) = ("commerce"."invoices"."vat_home_currency" is null));--> statement-breakpoint
ALTER TABLE "commerce"."invoices" ADD CONSTRAINT "invoices_fx_source" CHECK ("commerce"."invoices"."fx_source" is null or "commerce"."invoices"."fx_source" in ('ecb_auto', 'owner'));--> statement-breakpoint
ALTER TABLE "commerce"."invoices" ADD CONSTRAINT "invoices_public_token" CHECK (("commerce"."invoices"."anonymised_at" is null and "commerce"."invoices"."public_token" ~ '^inv_[A-Za-z0-9_-]{43}$') or ("commerce"."invoices"."anonymised_at" is not null and "commerce"."invoices"."public_token" is null));--> statement-breakpoint
ALTER TABLE "commerce"."invoices" ADD CONSTRAINT "invoices_pdf" CHECK (("commerce"."invoices"."pdf_path" is null) = ("commerce"."invoices"."pdf_sha256" is null));--> statement-breakpoint
ALTER TABLE "commerce"."invoices" ADD CONSTRAINT "invoices_snapshot" CHECK (jsonb_typeof("commerce"."invoices"."snapshot") = 'object' and "commerce"."invoices"."snapshot" ->> 'version' = '1');