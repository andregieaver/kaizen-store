CREATE TABLE "commerce"."work_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"billing_type" text DEFAULT 'hourly' NOT NULL,
	"hourly_rate_minor" bigint,
	"fixed_amount_minor" bigint,
	"estimated_minutes" integer,
	"start_date" date,
	"end_date" date,
	"estimate_alert_minutes" integer DEFAULT 10,
	"estimate_alert_popup" boolean DEFAULT true NOT NULL,
	"estimate_alert_sound" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_assignments_store_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "work_assignments_name" CHECK (length(trim("commerce"."work_assignments"."name")) between 1 and 160),
	CONSTRAINT "work_assignments_status" CHECK ("commerce"."work_assignments"."status" in ('active', 'paused', 'done')),
	CONSTRAINT "work_assignments_billing_type" CHECK ("commerce"."work_assignments"."billing_type" in ('hourly', 'fixed_fee')),
	CONSTRAINT "work_assignments_hourly_rate" CHECK ("commerce"."work_assignments"."hourly_rate_minor" is null or "commerce"."work_assignments"."hourly_rate_minor" between 0 and 1000000000),
	CONSTRAINT "work_assignments_fixed_amount" CHECK ("commerce"."work_assignments"."fixed_amount_minor" is null or "commerce"."work_assignments"."fixed_amount_minor" between 0 and 100000000000),
	CONSTRAINT "work_assignments_estimate" CHECK ("commerce"."work_assignments"."estimated_minutes" is null or "commerce"."work_assignments"."estimated_minutes" >= 0),
	CONSTRAINT "work_assignments_dates" CHECK ("commerce"."work_assignments"."start_date" is null or "commerce"."work_assignments"."end_date" is null or "commerce"."work_assignments"."start_date" <= "commerce"."work_assignments"."end_date"),
	CONSTRAINT "work_assignments_estimate_alert" CHECK ("commerce"."work_assignments"."estimate_alert_minutes" is null or "commerce"."work_assignments"."estimate_alert_minutes" between 1 and 480)
);
--> statement-breakpoint
CREATE TABLE "commerce"."work_clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"name" text NOT NULL,
	"legal_name" text,
	"organisation_number" text,
	"vat_number" text,
	"country" char(2),
	"billing_address" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"billing_email" text,
	"contact_name" text,
	"phone" text,
	"locale" text,
	"currency" char(3) NOT NULL,
	"default_hourly_rate_minor" bigint,
	"payment_days" integer,
	"business" boolean DEFAULT true NOT NULL,
	"vat_treatment" text DEFAULT 'domestic' NOT NULL,
	"customer_company_id" uuid,
	"customer_id" uuid,
	"use_prepaid" boolean DEFAULT true NOT NULL,
	"notes" text,
	"archived_at" timestamp with time zone,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_clients_store_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "work_clients_name" CHECK (length(trim("commerce"."work_clients"."name")) between 1 and 120),
	CONSTRAINT "work_clients_currency" CHECK ("commerce"."work_clients"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "work_clients_rate" CHECK ("commerce"."work_clients"."default_hourly_rate_minor" is null or "commerce"."work_clients"."default_hourly_rate_minor" between 0 and 1000000000),
	CONSTRAINT "work_clients_payment_days" CHECK ("commerce"."work_clients"."payment_days" is null or "commerce"."work_clients"."payment_days" between 1 and 90),
	CONSTRAINT "work_clients_vat_treatment" CHECK ("commerce"."work_clients"."vat_treatment" in ('domestic', 'reverse_charge', 'outside_scope', 'exempt')),
	CONSTRAINT "work_clients_consumer_domestic" CHECK ("commerce"."work_clients"."business" or "commerce"."work_clients"."vat_treatment" = 'domestic'),
	CONSTRAINT "work_clients_address" CHECK (jsonb_typeof("commerce"."work_clients"."billing_address") = 'object'),
	CONSTRAINT "work_clients_notes" CHECK (length(coalesce("commerce"."work_clients"."notes", '')) <= 5000)
);
--> statement-breakpoint
CREATE TABLE "commerce"."work_credit_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"series" text DEFAULT 'work_credit_note' NOT NULL,
	"number" bigint NOT NULL,
	"document_number" text NOT NULL,
	"issued_on" date NOT NULL,
	"currency" char(3) NOT NULL,
	"reason" text,
	"subtotal_minor" bigint NOT NULL,
	"vat_minor" bigint NOT NULL,
	"total_minor" bigint NOT NULL,
	"vat_home_minor" bigint,
	"fx_rate" numeric(18, 8),
	"lines" jsonb NOT NULL,
	"seller" jsonb NOT NULL,
	"buyer" jsonb NOT NULL,
	"vat_notes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_credit_notes_store_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "work_credit_notes_series_number_key" UNIQUE("store_id","series","number"),
	CONSTRAINT "work_credit_notes_document_number_key" UNIQUE("store_id","document_number"),
	CONSTRAINT "work_credit_notes_series" CHECK ("commerce"."work_credit_notes"."series" = 'work_credit_note'),
	CONSTRAINT "work_credit_notes_currency" CHECK ("commerce"."work_credit_notes"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "work_credit_notes_amounts" CHECK ("commerce"."work_credit_notes"."subtotal_minor" >= 0 and "commerce"."work_credit_notes"."vat_minor" >= 0 and "commerce"."work_credit_notes"."total_minor" > 0 and "commerce"."work_credit_notes"."total_minor" = "commerce"."work_credit_notes"."subtotal_minor" + "commerce"."work_credit_notes"."vat_minor"),
	CONSTRAINT "work_credit_notes_lines" CHECK (jsonb_typeof("commerce"."work_credit_notes"."lines") = 'array' and jsonb_array_length("commerce"."work_credit_notes"."lines") > 0),
	CONSTRAINT "work_credit_notes_reason" CHECK (length(coalesce("commerce"."work_credit_notes"."reason", '')) <= 1000)
);
--> statement-breakpoint
CREATE TABLE "commerce"."work_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "commerce"."work_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"store_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"type" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"account_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_events_names" CHECK (length("commerce"."work_events"."entity_type") between 1 and 40 and length("commerce"."work_events"."type") between 1 and 60),
	CONSTRAINT "work_events_data" CHECK (jsonb_typeof("commerce"."work_events"."data") = 'object')
);
--> statement-breakpoint
CREATE TABLE "commerce"."work_invoice_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"assignment_id" uuid,
	"task_id" uuid,
	"description" text NOT NULL,
	"unit" text DEFAULT 'hour' NOT NULL,
	"quantity_hundredths" integer DEFAULT 0 NOT NULL,
	"unit_price_minor" bigint DEFAULT 0 NOT NULL,
	"discount_bp" integer DEFAULT 0 NOT NULL,
	"vat_category" text DEFAULT 'standard' NOT NULL,
	"vat_rate" numeric(6, 4) DEFAULT '0' NOT NULL,
	"excl_minor" bigint DEFAULT 0 NOT NULL,
	"vat_minor" bigint DEFAULT 0 NOT NULL,
	"incl_minor" bigint DEFAULT 0 NOT NULL,
	"quantity_manual" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_invoice_lines_store_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "work_invoice_lines_description" CHECK (length(trim("commerce"."work_invoice_lines"."description")) between 1 and 500),
	CONSTRAINT "work_invoice_lines_unit" CHECK ("commerce"."work_invoice_lines"."unit" in ('hour', 'unit')),
	CONSTRAINT "work_invoice_lines_quantity" CHECK ("commerce"."work_invoice_lines"."quantity_hundredths" between 0 and 10000000),
	CONSTRAINT "work_invoice_lines_price" CHECK ("commerce"."work_invoice_lines"."unit_price_minor" between 0 and 1000000000),
	CONSTRAINT "work_invoice_lines_discount" CHECK ("commerce"."work_invoice_lines"."discount_bp" between 0 and 10000),
	CONSTRAINT "work_invoice_lines_vat_category" CHECK ("commerce"."work_invoice_lines"."vat_category" in ('standard', 'exempt', 'reverse_charge', 'outside_scope')),
	CONSTRAINT "work_invoice_lines_vat_rate" CHECK ("commerce"."work_invoice_lines"."vat_rate" >= 0 and "commerce"."work_invoice_lines"."vat_rate" < 1 and ("commerce"."work_invoice_lines"."vat_category" = 'standard' or "commerce"."work_invoice_lines"."vat_rate" = 0)),
	CONSTRAINT "work_invoice_lines_amounts" CHECK ("commerce"."work_invoice_lines"."excl_minor" >= 0 and "commerce"."work_invoice_lines"."vat_minor" >= 0 and "commerce"."work_invoice_lines"."incl_minor" = "commerce"."work_invoice_lines"."excl_minor" + "commerce"."work_invoice_lines"."vat_minor")
);
--> statement-breakpoint
CREATE TABLE "commerce"."work_invoice_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"received_on" date NOT NULL,
	"method" text NOT NULL,
	"reference" text,
	"provider_reference" text,
	"reverses" uuid,
	"recorded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_invoice_payments_store_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "work_invoice_payments_amount" CHECK ("commerce"."work_invoice_payments"."amount_minor" <> 0),
	CONSTRAINT "work_invoice_payments_currency" CHECK ("commerce"."work_invoice_payments"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "work_invoice_payments_method" CHECK ("commerce"."work_invoice_payments"."method" in ('bank', 'card', 'cash', 'other', 'stripe', 'prepaid')),
	CONSTRAINT "work_invoice_payments_reversal" CHECK ("commerce"."work_invoice_payments"."reverses" is null or "commerce"."work_invoice_payments"."amount_minor" < 0),
	CONSTRAINT "work_invoice_payments_texts" CHECK (length(coalesce("commerce"."work_invoice_payments"."reference", '')) <= 200)
);
--> statement-breakpoint
CREATE TABLE "commerce"."work_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"assignment_id" uuid,
	"recurring_invoice_id" uuid,
	"recurring_period" date,
	"status" text DEFAULT 'draft' NOT NULL,
	"series" text DEFAULT 'work_invoice' NOT NULL,
	"number" bigint,
	"document_number" text,
	"issued_on" date,
	"due_on" date,
	"sent_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"currency" char(3) NOT NULL,
	"locale" text,
	"payment_days" integer,
	"service_from" date,
	"service_to" date,
	"notes" text,
	"reference" text,
	"subtotal_minor" bigint DEFAULT 0 NOT NULL,
	"vat_minor" bigint DEFAULT 0 NOT NULL,
	"total_minor" bigint DEFAULT 0 NOT NULL,
	"vat_home_minor" bigint,
	"fx_rate" numeric(18, 8),
	"seller" jsonb,
	"buyer" jsonb,
	"vat_notes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"public_token" text,
	"sent_to" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_invoices_public_token_unique" UNIQUE("public_token"),
	CONSTRAINT "work_invoices_store_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "work_invoices_series_number_key" UNIQUE("store_id","series","number"),
	CONSTRAINT "work_invoices_document_number_key" UNIQUE("store_id","document_number"),
	CONSTRAINT "work_invoices_recurring_period_key" UNIQUE("store_id","recurring_invoice_id","recurring_period"),
	CONSTRAINT "work_invoices_status" CHECK ("commerce"."work_invoices"."status" in ('draft', 'sent', 'paid', 'void')),
	CONSTRAINT "work_invoices_series" CHECK ("commerce"."work_invoices"."series" = 'work_invoice'),
	CONSTRAINT "work_invoices_currency" CHECK ("commerce"."work_invoices"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "work_invoices_amounts" CHECK ("commerce"."work_invoices"."subtotal_minor" >= 0 and "commerce"."work_invoices"."vat_minor" >= 0 and "commerce"."work_invoices"."total_minor" = "commerce"."work_invoices"."subtotal_minor" + "commerce"."work_invoices"."vat_minor"),
	CONSTRAINT "work_invoices_number" CHECK (("commerce"."work_invoices"."status" = 'draft') = ("commerce"."work_invoices"."number" is null) and ("commerce"."work_invoices"."number" is null) = ("commerce"."work_invoices"."document_number" is null)),
	CONSTRAINT "work_invoices_issued" CHECK ("commerce"."work_invoices"."status" = 'draft' or ("commerce"."work_invoices"."issued_on" is not null and "commerce"."work_invoices"."due_on" is not null and "commerce"."work_invoices"."sent_at" is not null and "commerce"."work_invoices"."seller" is not null and "commerce"."work_invoices"."buyer" is not null and "commerce"."work_invoices"."locale" is not null and "commerce"."work_invoices"."payment_days" is not null)),
	CONSTRAINT "work_invoices_recurring" CHECK (("commerce"."work_invoices"."recurring_invoice_id" is null) = ("commerce"."work_invoices"."recurring_period" is null)),
	CONSTRAINT "work_invoices_payment_days" CHECK ("commerce"."work_invoices"."payment_days" is null or "commerce"."work_invoices"."payment_days" between 1 and 90),
	CONSTRAINT "work_invoices_service" CHECK ("commerce"."work_invoices"."service_from" is null or "commerce"."work_invoices"."service_to" is null or "commerce"."work_invoices"."service_from" <= "commerce"."work_invoices"."service_to"),
	CONSTRAINT "work_invoices_fx" CHECK ("commerce"."work_invoices"."fx_rate" is null or "commerce"."work_invoices"."fx_rate" > 0),
	CONSTRAINT "work_invoices_texts" CHECK (length(coalesce("commerce"."work_invoices"."notes", '')) <= 5000 and length(coalesce("commerce"."work_invoices"."reference", '')) <= 200),
	CONSTRAINT "work_invoices_vat_notes" CHECK (jsonb_typeof("commerce"."work_invoices"."vat_notes") = 'array')
);
--> statement-breakpoint
CREATE TABLE "commerce"."work_recurring_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"unit" text DEFAULT 'unit' NOT NULL,
	"quantity_hundredths" integer DEFAULT 100 NOT NULL,
	"unit_price_minor" bigint NOT NULL,
	"discount_bp" integer DEFAULT 0 NOT NULL,
	"vat_category" text DEFAULT 'standard' NOT NULL,
	"currency" char(3) NOT NULL,
	"recurrence_interval" integer DEFAULT 1 NOT NULL,
	"recurrence_period" text DEFAULT 'month' NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"payment_days" integer,
	"auto_issue" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"skipped_periods" date[] DEFAULT '{}'::date[] NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_recurring_invoices_store_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "work_recurring_invoices_name" CHECK (length(trim("commerce"."work_recurring_invoices"."name")) between 1 and 120),
	CONSTRAINT "work_recurring_invoices_description" CHECK (length(trim("commerce"."work_recurring_invoices"."description")) between 1 and 500),
	CONSTRAINT "work_recurring_invoices_unit" CHECK ("commerce"."work_recurring_invoices"."unit" in ('hour', 'unit')),
	CONSTRAINT "work_recurring_invoices_quantity" CHECK ("commerce"."work_recurring_invoices"."quantity_hundredths" between 0 and 10000000),
	CONSTRAINT "work_recurring_invoices_price" CHECK ("commerce"."work_recurring_invoices"."unit_price_minor" between 0 and 1000000000),
	CONSTRAINT "work_recurring_invoices_discount" CHECK ("commerce"."work_recurring_invoices"."discount_bp" between 0 and 10000),
	CONSTRAINT "work_recurring_invoices_vat_category" CHECK ("commerce"."work_recurring_invoices"."vat_category" in ('standard', 'exempt', 'reverse_charge', 'outside_scope')),
	CONSTRAINT "work_recurring_invoices_currency" CHECK ("commerce"."work_recurring_invoices"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "work_recurring_invoices_interval" CHECK ("commerce"."work_recurring_invoices"."recurrence_interval" between 1 and 4),
	CONSTRAINT "work_recurring_invoices_period" CHECK ("commerce"."work_recurring_invoices"."recurrence_period" in ('week', 'month', 'year')),
	CONSTRAINT "work_recurring_invoices_dates" CHECK ("commerce"."work_recurring_invoices"."end_date" is null or "commerce"."work_recurring_invoices"."end_date" >= "commerce"."work_recurring_invoices"."start_date"),
	CONSTRAINT "work_recurring_invoices_payment_days" CHECK ("commerce"."work_recurring_invoices"."payment_days" is null or "commerce"."work_recurring_invoices"."payment_days" between 1 and 90)
);
--> statement-breakpoint
CREATE TABLE "commerce"."work_settings" (
	"store_id" uuid PRIMARY KEY NOT NULL,
	"vat_registered" boolean DEFAULT true NOT NULL,
	"vat_number" text,
	"default_payment_days" integer DEFAULT 14,
	"default_currency" char(3),
	"bank_account" text,
	"bic" text,
	"payment_note" text,
	"invoice_footer" text,
	"late_payment_note" text,
	"estimate_alert_minutes" integer DEFAULT 10,
	"estimate_alert_popup" boolean DEFAULT true NOT NULL,
	"estimate_alert_sound" boolean DEFAULT false NOT NULL,
	"show_time_notes_to_clients" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "work_settings_payment_days" CHECK ("commerce"."work_settings"."default_payment_days" is null or "commerce"."work_settings"."default_payment_days" between 1 and 90),
	CONSTRAINT "work_settings_currency" CHECK ("commerce"."work_settings"."default_currency" is null or "commerce"."work_settings"."default_currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "work_settings_estimate_alert" CHECK ("commerce"."work_settings"."estimate_alert_minutes" is null or "commerce"."work_settings"."estimate_alert_minutes" between 1 and 480),
	CONSTRAINT "work_settings_texts" CHECK (length(coalesce("commerce"."work_settings"."payment_note", '')) <= 1000 and length(coalesce("commerce"."work_settings"."invoice_footer", '')) <= 2000 and length(coalesce("commerce"."work_settings"."late_payment_note", '')) <= 2000)
);
--> statement-breakpoint
CREATE TABLE "commerce"."work_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"assignment_id" uuid NOT NULL,
	"title" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"estimated_minutes" integer,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_tasks_store_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "work_tasks_assignment_key" UNIQUE("store_id","assignment_id","id"),
	CONSTRAINT "work_tasks_title" CHECK (length(trim("commerce"."work_tasks"."title")) between 1 and 200),
	CONSTRAINT "work_tasks_status" CHECK ("commerce"."work_tasks"."status" in ('open', 'done')),
	CONSTRAINT "work_tasks_estimate" CHECK ("commerce"."work_tasks"."estimated_minutes" is null or "commerce"."work_tasks"."estimated_minutes" >= 0)
);
--> statement-breakpoint
CREATE TABLE "commerce"."work_time_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"assignment_id" uuid NOT NULL,
	"task_id" uuid,
	"account_id" uuid NOT NULL,
	"work_date" date NOT NULL,
	"minutes" integer NOT NULL,
	"billable" boolean DEFAULT true NOT NULL,
	"note" text,
	"prepaid_minutes" integer DEFAULT 0 NOT NULL,
	"invoice_line_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_time_entries_store_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "work_time_entries_minutes" CHECK ("commerce"."work_time_entries"."minutes" between 1 and 1440),
	CONSTRAINT "work_time_entries_note" CHECK (length(coalesce("commerce"."work_time_entries"."note", '')) <= 500),
	CONSTRAINT "work_time_entries_prepaid" CHECK ("commerce"."work_time_entries"."prepaid_minutes" between 0 and "commerce"."work_time_entries"."minutes")
);
--> statement-breakpoint
CREATE TABLE "commerce"."work_timers" (
	"store_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"assignment_id" uuid NOT NULL,
	"task_id" uuid,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_timers_store_id_account_id_pk" PRIMARY KEY("store_id","account_id")
);
--> statement-breakpoint
ALTER TABLE "commerce"."stores" DROP CONSTRAINT "stores_modules";--> statement-breakpoint
ALTER TABLE "commerce"."work_assignments" ADD CONSTRAINT "work_assignments_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."work_assignments" ADD CONSTRAINT "work_assignments_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."work_assignments" ADD CONSTRAINT "work_assignments_client_fk" FOREIGN KEY ("store_id","client_id") REFERENCES "commerce"."work_clients"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."work_clients" ADD CONSTRAINT "work_clients_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."work_clients" ADD CONSTRAINT "work_clients_country_countries_code_fk" FOREIGN KEY ("country") REFERENCES "commerce"."countries"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."work_credit_notes" ADD CONSTRAINT "work_credit_notes_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."work_credit_notes" ADD CONSTRAINT "work_credit_notes_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."work_credit_notes" ADD CONSTRAINT "work_credit_notes_invoice_fk" FOREIGN KEY ("store_id","invoice_id") REFERENCES "commerce"."work_invoices"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."work_credit_notes" ADD CONSTRAINT "work_credit_notes_series_fk" FOREIGN KEY ("store_id","series") REFERENCES "commerce"."document_series"("store_id","series") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."work_events" ADD CONSTRAINT "work_events_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."work_events" ADD CONSTRAINT "work_events_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."work_invoice_lines" ADD CONSTRAINT "work_invoice_lines_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."work_invoice_lines" ADD CONSTRAINT "work_invoice_lines_invoice_fk" FOREIGN KEY ("store_id","invoice_id") REFERENCES "commerce"."work_invoices"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."work_invoice_payments" ADD CONSTRAINT "work_invoice_payments_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."work_invoice_payments" ADD CONSTRAINT "work_invoice_payments_recorded_by_accounts_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."work_invoice_payments" ADD CONSTRAINT "work_invoice_payments_invoice_fk" FOREIGN KEY ("store_id","invoice_id") REFERENCES "commerce"."work_invoices"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."work_invoice_payments" ADD CONSTRAINT "work_invoice_payments_reverses_fk" FOREIGN KEY ("store_id","reverses") REFERENCES "commerce"."work_invoice_payments"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."work_invoices" ADD CONSTRAINT "work_invoices_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."work_invoices" ADD CONSTRAINT "work_invoices_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."work_invoices" ADD CONSTRAINT "work_invoices_client_fk" FOREIGN KEY ("store_id","client_id") REFERENCES "commerce"."work_clients"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."work_invoices" ADD CONSTRAINT "work_invoices_assignment_fk" FOREIGN KEY ("store_id","assignment_id") REFERENCES "commerce"."work_assignments"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."work_invoices" ADD CONSTRAINT "work_invoices_recurring_fk" FOREIGN KEY ("store_id","recurring_invoice_id") REFERENCES "commerce"."work_recurring_invoices"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."work_invoices" ADD CONSTRAINT "work_invoices_series_fk" FOREIGN KEY ("store_id","series") REFERENCES "commerce"."document_series"("store_id","series") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."work_recurring_invoices" ADD CONSTRAINT "work_recurring_invoices_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."work_recurring_invoices" ADD CONSTRAINT "work_recurring_invoices_client_fk" FOREIGN KEY ("store_id","client_id") REFERENCES "commerce"."work_clients"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."work_settings" ADD CONSTRAINT "work_settings_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."work_settings" ADD CONSTRAINT "work_settings_updated_by_accounts_id_fk" FOREIGN KEY ("updated_by") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."work_tasks" ADD CONSTRAINT "work_tasks_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."work_tasks" ADD CONSTRAINT "work_tasks_assignment_fk" FOREIGN KEY ("store_id","assignment_id") REFERENCES "commerce"."work_assignments"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."work_time_entries" ADD CONSTRAINT "work_time_entries_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."work_time_entries" ADD CONSTRAINT "work_time_entries_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."work_time_entries" ADD CONSTRAINT "work_time_entries_assignment_fk" FOREIGN KEY ("store_id","assignment_id") REFERENCES "commerce"."work_assignments"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."work_timers" ADD CONSTRAINT "work_timers_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."work_timers" ADD CONSTRAINT "work_timers_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."work_timers" ADD CONSTRAINT "work_timers_assignment_fk" FOREIGN KEY ("store_id","assignment_id") REFERENCES "commerce"."work_assignments"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."work_timers" ADD CONSTRAINT "work_timers_task_fk" FOREIGN KEY ("store_id","assignment_id","task_id") REFERENCES "commerce"."work_tasks"("store_id","assignment_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "work_assignments_client_idx" ON "commerce"."work_assignments" USING btree ("store_id","client_id","sort_order");--> statement-breakpoint
CREATE INDEX "work_assignments_status_idx" ON "commerce"."work_assignments" USING btree ("store_id","status");--> statement-breakpoint
CREATE INDEX "work_assignments_created_by_idx" ON "commerce"."work_assignments" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "work_clients_sort_idx" ON "commerce"."work_clients" USING btree ("store_id","sort_order","name");--> statement-breakpoint
CREATE INDEX "work_clients_company_idx" ON "commerce"."work_clients" USING btree ("store_id","customer_company_id");--> statement-breakpoint
CREATE INDEX "work_clients_customer_idx" ON "commerce"."work_clients" USING btree ("store_id","customer_id");--> statement-breakpoint
CREATE INDEX "work_clients_country_idx" ON "commerce"."work_clients" USING btree ("country");--> statement-breakpoint
CREATE INDEX "work_credit_notes_invoice_idx" ON "commerce"."work_credit_notes" USING btree ("store_id","invoice_id");--> statement-breakpoint
CREATE INDEX "work_credit_notes_created_by_idx" ON "commerce"."work_credit_notes" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "work_events_entity_idx" ON "commerce"."work_events" USING btree ("store_id","entity_type","entity_id","created_at");--> statement-breakpoint
CREATE INDEX "work_events_store_idx" ON "commerce"."work_events" USING btree ("store_id","created_at");--> statement-breakpoint
CREATE INDEX "work_events_account_idx" ON "commerce"."work_events" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "work_invoice_lines_invoice_idx" ON "commerce"."work_invoice_lines" USING btree ("store_id","invoice_id","position");--> statement-breakpoint
CREATE INDEX "work_invoice_lines_assignment_idx" ON "commerce"."work_invoice_lines" USING btree ("store_id","assignment_id") WHERE "commerce"."work_invoice_lines"."assignment_id" is not null;--> statement-breakpoint
CREATE INDEX "work_invoice_lines_task_idx" ON "commerce"."work_invoice_lines" USING btree ("store_id","task_id") WHERE "commerce"."work_invoice_lines"."task_id" is not null;--> statement-breakpoint
CREATE INDEX "work_invoice_payments_invoice_idx" ON "commerce"."work_invoice_payments" USING btree ("store_id","invoice_id","received_on");--> statement-breakpoint
CREATE INDEX "work_invoice_payments_recorded_by_idx" ON "commerce"."work_invoice_payments" USING btree ("recorded_by");--> statement-breakpoint
CREATE UNIQUE INDEX "work_invoice_payments_reverses_idx" ON "commerce"."work_invoice_payments" USING btree ("store_id","reverses") WHERE "commerce"."work_invoice_payments"."reverses" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "work_invoice_payments_provider_idx" ON "commerce"."work_invoice_payments" USING btree ("store_id","provider_reference") WHERE "commerce"."work_invoice_payments"."provider_reference" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "work_invoices_one_draft_idx" ON "commerce"."work_invoices" USING btree ("store_id","assignment_id") WHERE "commerce"."work_invoices"."status" = 'draft';--> statement-breakpoint
CREATE INDEX "work_invoices_status_idx" ON "commerce"."work_invoices" USING btree ("store_id","status","issued_on" desc nulls last);--> statement-breakpoint
CREATE INDEX "work_invoices_client_idx" ON "commerce"."work_invoices" USING btree ("store_id","client_id","status");--> statement-breakpoint
CREATE INDEX "work_invoices_assignment_idx" ON "commerce"."work_invoices" USING btree ("store_id","assignment_id");--> statement-breakpoint
CREATE INDEX "work_invoices_due_idx" ON "commerce"."work_invoices" USING btree ("store_id","due_on") WHERE "commerce"."work_invoices"."status" = 'sent';--> statement-breakpoint
CREATE INDEX "work_invoices_created_by_idx" ON "commerce"."work_invoices" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "work_recurring_invoices_client_idx" ON "commerce"."work_recurring_invoices" USING btree ("store_id","client_id","sort_order","name");--> statement-breakpoint
CREATE INDEX "work_settings_updated_by_idx" ON "commerce"."work_settings" USING btree ("updated_by");--> statement-breakpoint
CREATE INDEX "work_tasks_sort_idx" ON "commerce"."work_tasks" USING btree ("store_id","assignment_id","sort_order");--> statement-breakpoint
CREATE INDEX "work_time_entries_assignment_idx" ON "commerce"."work_time_entries" USING btree ("store_id","assignment_id","work_date" desc);--> statement-breakpoint
CREATE INDEX "work_time_entries_task_idx" ON "commerce"."work_time_entries" USING btree ("store_id","assignment_id","task_id");--> statement-breakpoint
CREATE INDEX "work_time_entries_date_idx" ON "commerce"."work_time_entries" USING btree ("store_id","work_date" desc);--> statement-breakpoint
CREATE INDEX "work_time_entries_account_date_idx" ON "commerce"."work_time_entries" USING btree ("store_id","account_id","work_date" desc);--> statement-breakpoint
CREATE INDEX "work_time_entries_account_idx" ON "commerce"."work_time_entries" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "work_time_entries_line_idx" ON "commerce"."work_time_entries" USING btree ("store_id","invoice_line_id");--> statement-breakpoint
CREATE INDEX "work_timers_account_idx" ON "commerce"."work_timers" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "work_timers_assignment_idx" ON "commerce"."work_timers" USING btree ("store_id","assignment_id","task_id");--> statement-breakpoint
ALTER TABLE "commerce"."stores" ADD CONSTRAINT "stores_modules" CHECK ("commerce"."stores"."modules" <@ array['bookings', 'deliveries', 'work']::text[]);