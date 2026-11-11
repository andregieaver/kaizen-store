CREATE TABLE "commerce"."privacy_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"channel" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"subject_customer_id" uuid,
	"subject_email" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"extended_until" timestamp with time zone,
	"extension_reason" text,
	"identity_doubt_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"outcome" text,
	"refusal_reason" text,
	"refusal_note" text,
	"note" text DEFAULT '' NOT NULL,
	"plan_summary" jsonb,
	"steps" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"handled_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "privacy_requests_kind" CHECK ("commerce"."privacy_requests"."kind" in ('export', 'erasure')),
	CONSTRAINT "privacy_requests_channel" CHECK ("commerce"."privacy_requests"."channel" in ('shopper', 'staff')),
	CONSTRAINT "privacy_requests_status" CHECK ("commerce"."privacy_requests"."status" in ('open', 'done', 'refused', 'cancelled')),
	CONSTRAINT "privacy_requests_email" CHECK ("commerce"."privacy_requests"."subject_email" is null or "commerce"."privacy_requests"."subject_email" = lower("commerce"."privacy_requests"."subject_email")),
	CONSTRAINT "privacy_requests_due" CHECK ("commerce"."privacy_requests"."due_at" >= "commerce"."privacy_requests"."received_at"),
	CONSTRAINT "privacy_requests_extension" CHECK ("commerce"."privacy_requests"."extended_until" is null or ("commerce"."privacy_requests"."extended_until" > "commerce"."privacy_requests"."due_at" and "commerce"."privacy_requests"."extended_until" <= "commerce"."privacy_requests"."received_at" + interval '3 months')),
	CONSTRAINT "privacy_requests_outcome" CHECK ("commerce"."privacy_requests"."outcome" is null or "commerce"."privacy_requests"."outcome" in ('exported', 'erased', 'no_data', 'refused', 'cancelled')),
	CONSTRAINT "privacy_requests_refusal_reason" CHECK ("commerce"."privacy_requests"."refusal_reason" is null or "commerce"."privacy_requests"."refusal_reason" in ('identity_not_confirmed', 'manifestly_unfounded', 'excessive', 'legal_hold', 'other')),
	CONSTRAINT "privacy_requests_state" CHECK (("commerce"."privacy_requests"."status" = 'open' and "commerce"."privacy_requests"."completed_at" is null and "commerce"."privacy_requests"."outcome" is null)
        or ("commerce"."privacy_requests"."status" = 'done' and "commerce"."privacy_requests"."completed_at" is not null and coalesce("commerce"."privacy_requests"."outcome" in ('exported', 'erased', 'no_data'), false))
        or ("commerce"."privacy_requests"."status" = 'refused' and "commerce"."privacy_requests"."completed_at" is not null and coalesce("commerce"."privacy_requests"."outcome" = 'refused', false) and "commerce"."privacy_requests"."refusal_reason" is not null)
        or ("commerce"."privacy_requests"."status" = 'cancelled' and "commerce"."privacy_requests"."completed_at" is not null and coalesce("commerce"."privacy_requests"."outcome" = 'cancelled', false))),
	CONSTRAINT "privacy_requests_erased_email" CHECK (not ("commerce"."privacy_requests"."kind" = 'erasure' and "commerce"."privacy_requests"."status" = 'done') or "commerce"."privacy_requests"."subject_email" is null)
);
--> statement-breakpoint
CREATE TABLE "commerce"."retention_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"country" char(2),
	"period_value" integer NOT NULL,
	"period_unit" text NOT NULL,
	"counts_from" text NOT NULL,
	"source" text NOT NULL,
	"source_url" text,
	"basis" text NOT NULL,
	"checked_on" date NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"enforced_by" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"verified_at" timestamp with time zone,
	"verified_by" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "retention_rules_kind" CHECK ("commerce"."retention_rules"."kind" in ('bookkeeping', 'host_bookkeeping', 'unpaid_orders', 'email_bodies', 'security_emails', 'carts', 'delivery_quotes', 'customer_codes', 'customer_sessions', 'webhook_payloads', 'consents', 'privacy_request_contact', 'privacy_requests', 'search_queries', 'visits', 'audit_log', 'form_submissions', 'integration_deliveries', 'abandoned_checkouts', 'recommendation_events', 'ai_usage')),
	CONSTRAINT "retention_rules_value" CHECK ("commerce"."retention_rules"."period_value" > 0),
	CONSTRAINT "retention_rules_unit" CHECK ("commerce"."retention_rules"."period_unit" in ('days', 'months')),
	CONSTRAINT "retention_rules_counts_from" CHECK ("commerce"."retention_rules"."counts_from" in ('event', 'end_of_year')),
	CONSTRAINT "retention_rules_year_end" CHECK ("commerce"."retention_rules"."counts_from" = 'event' or ("commerce"."retention_rules"."period_unit" = 'months' and "commerce"."retention_rules"."period_value" % 12 = 0)),
	CONSTRAINT "retention_rules_basis" CHECK ("commerce"."retention_rules"."basis" in ('read', 'snippet', 'secondary', 'fallback', 'policy')),
	CONSTRAINT "retention_rules_period" CHECK ("commerce"."retention_rules"."valid_to" is null or "commerce"."retention_rules"."valid_to" > "commerce"."retention_rules"."valid_from"),
	CONSTRAINT "retention_rules_source" CHECK (length("commerce"."retention_rules"."source") between 8 and 1000),
	CONSTRAINT "retention_rules_verified" CHECK (("commerce"."retention_rules"."verified_at" is null) = ("commerce"."retention_rules"."verified_by" is null))
);
--> statement-breakpoint
ALTER TABLE "commerce"."customer_sessions" ADD COLUMN "verified_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."orders" ADD COLUMN "restricted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "commerce"."orders" ADD COLUMN "anonymised_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "commerce"."privacy_requests" ADD CONSTRAINT "privacy_requests_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."privacy_requests" ADD CONSTRAINT "privacy_requests_handled_by_accounts_id_fk" FOREIGN KEY ("handled_by") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."retention_rules" ADD CONSTRAINT "retention_rules_country_countries_code_fk" FOREIGN KEY ("country") REFERENCES "commerce"."countries"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."retention_rules" ADD CONSTRAINT "retention_rules_verified_by_accounts_id_fk" FOREIGN KEY ("verified_by") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."retention_rules" ADD CONSTRAINT "retention_rules_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "privacy_requests_status_idx" ON "commerce"."privacy_requests" USING btree ("store_id","status","due_at");--> statement-breakpoint
CREATE INDEX "privacy_requests_handled_by_idx" ON "commerce"."privacy_requests" USING btree ("handled_by");--> statement-breakpoint
CREATE UNIQUE INDEX "privacy_requests_open_erasure_key" ON "commerce"."privacy_requests" USING btree ("store_id","subject_email") WHERE "commerce"."privacy_requests"."status" = 'open' and "commerce"."privacy_requests"."kind" = 'erasure';--> statement-breakpoint
CREATE UNIQUE INDEX "retention_rules_period_key" ON "commerce"."retention_rules" USING btree ("kind",coalesce("country", '__'),"valid_from");--> statement-breakpoint
CREATE UNIQUE INDEX "retention_rules_current_key" ON "commerce"."retention_rules" USING btree ("kind",coalesce("country", '__')) WHERE "commerce"."retention_rules"."valid_to" is null;--> statement-breakpoint
CREATE INDEX "retention_rules_country_idx" ON "commerce"."retention_rules" USING btree ("country");--> statement-breakpoint
CREATE INDEX "retention_rules_verified_by_idx" ON "commerce"."retention_rules" USING btree ("verified_by");--> statement-breakpoint
CREATE INDEX "retention_rules_created_by_idx" ON "commerce"."retention_rules" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "orders_retention_idx" ON "commerce"."orders" USING btree ("store_id","placed_at") WHERE "commerce"."orders"."anonymised_at" is null;--> statement-breakpoint
ALTER TABLE "commerce"."orders" ADD CONSTRAINT "orders_anonymised" CHECK ("commerce"."orders"."anonymised_at" is null or ("commerce"."orders"."email" = '[removed]' and "commerce"."orders"."billing_address" = '{}'::jsonb and "commerce"."orders"."shipping_address" = '{}'::jsonb and "commerce"."orders"."company_name" is null and "commerce"."orders"."organisation_number" is null));