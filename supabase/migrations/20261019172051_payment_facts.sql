CREATE TABLE "commerce"."payment_disputes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_reference" text NOT NULL,
	"charge_reference" text,
	"amount_minor" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"reason" text,
	"status" text NOT NULL,
	"evidence_due_by" timestamp with time zone,
	"outcome" text,
	"funds_withdrawn_minor" bigint,
	"fee_minor" bigint,
	"test_mode" boolean DEFAULT false NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone,
	"reminded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_disputes_store_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "payment_disputes_reference_key" UNIQUE("store_id","provider","provider_reference"),
	CONSTRAINT "payment_disputes_provider" CHECK ("commerce"."payment_disputes"."provider" in ('stripe')),
	CONSTRAINT "payment_disputes_amount" CHECK ("commerce"."payment_disputes"."amount_minor" > 0),
	CONSTRAINT "payment_disputes_status" CHECK ("commerce"."payment_disputes"."status" in ('warning_needs_response', 'warning_under_review', 'warning_closed', 'needs_response', 'under_review', 'won', 'lost', 'prevented')),
	CONSTRAINT "payment_disputes_outcome" CHECK ("commerce"."payment_disputes"."outcome" is null or "commerce"."payment_disputes"."outcome" in ('won', 'lost')),
	CONSTRAINT "payment_disputes_closed" CHECK (("commerce"."payment_disputes"."closed_at" is null) = ("commerce"."payment_disputes"."outcome" is null)),
	CONSTRAINT "payment_disputes_money" CHECK (("commerce"."payment_disputes"."funds_withdrawn_minor" is null or "commerce"."payment_disputes"."funds_withdrawn_minor" >= 0) and ("commerce"."payment_disputes"."fee_minor" is null or "commerce"."payment_disputes"."fee_minor" >= 0)),
	CONSTRAINT "payment_disputes_reason" CHECK ("commerce"."payment_disputes"."reason" is null or char_length("commerce"."payment_disputes"."reason") <= 80)
);
--> statement-breakpoint
ALTER TABLE "commerce"."staff_alert_recipients" DROP CONSTRAINT "staff_alert_recipients_events";--> statement-breakpoint
ALTER TABLE "commerce"."staff_alert_settings" DROP CONSTRAINT "staff_alert_settings_contact_events";--> statement-breakpoint
ALTER TABLE "commerce"."payments" ADD COLUMN "method_type" text;--> statement-breakpoint
ALTER TABLE "commerce"."payments" ADD COLUMN "wallet" text;--> statement-breakpoint
ALTER TABLE "commerce"."payments" ADD COLUMN "card_brand" text;--> statement-breakpoint
ALTER TABLE "commerce"."payments" ADD COLUMN "risk_level" text;--> statement-breakpoint
ALTER TABLE "commerce"."payments" ADD COLUMN "risk_score" smallint;--> statement-breakpoint
ALTER TABLE "commerce"."payments" ADD COLUMN "charge_reference" text;--> statement-breakpoint
ALTER TABLE "commerce"."payments" ADD COLUMN "facts_read_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "commerce"."payment_disputes" ADD CONSTRAINT "payment_disputes_order_fk" FOREIGN KEY ("store_id","order_id") REFERENCES "commerce"."orders"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."payment_disputes" ADD CONSTRAINT "payment_disputes_payment_fk" FOREIGN KEY ("store_id","payment_id") REFERENCES "commerce"."payments"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payment_disputes_order_idx" ON "commerce"."payment_disputes" USING btree ("store_id","order_id");--> statement-breakpoint
CREATE INDEX "payment_disputes_payment_idx" ON "commerce"."payment_disputes" USING btree ("store_id","payment_id");--> statement-breakpoint
CREATE INDEX "payment_disputes_due_idx" ON "commerce"."payment_disputes" USING btree ("evidence_due_by") WHERE "commerce"."payment_disputes"."closed_at" is null and "commerce"."payment_disputes"."reminded_at" is null;--> statement-breakpoint
CREATE INDEX "payments_charge_idx" ON "commerce"."payments" USING btree ("store_id","charge_reference") WHERE "commerce"."payments"."charge_reference" is not null;--> statement-breakpoint
CREATE INDEX "payments_facts_due_idx" ON "commerce"."payments" USING btree ("created_at") WHERE "commerce"."payments"."provider" = 'stripe' and "commerce"."payments"."status" = 'captured' and "commerce"."payments"."facts_read_at" is null;--> statement-breakpoint
ALTER TABLE "commerce"."payments" ADD CONSTRAINT "payments_risk_level" CHECK ("commerce"."payments"."risk_level" is null or "commerce"."payments"."risk_level" in ('normal', 'elevated', 'highest', 'not_assessed', 'unknown'));--> statement-breakpoint
ALTER TABLE "commerce"."payments" ADD CONSTRAINT "payments_risk_score" CHECK ("commerce"."payments"."risk_score" is null or "commerce"."payments"."risk_score" between 0 and 100);--> statement-breakpoint
ALTER TABLE "commerce"."payments" ADD CONSTRAINT "payments_facts_stripe" CHECK ("commerce"."payments"."provider" = 'stripe' or ("commerce"."payments"."method_type" is null and "commerce"."payments"."wallet" is null and "commerce"."payments"."card_brand" is null and "commerce"."payments"."risk_level" is null and "commerce"."payments"."charge_reference" is null));--> statement-breakpoint
ALTER TABLE "commerce"."staff_alert_recipients" ADD CONSTRAINT "staff_alert_recipients_events" CHECK (cardinality("commerce"."staff_alert_recipients"."events") > 0 and "commerce"."staff_alert_recipients"."events" <@ array['new_order', 'return_requested', 'refund_overdue', 'low_stock', 'summary', 'automation', 'dispute']::text[]);--> statement-breakpoint
ALTER TABLE "commerce"."staff_alert_settings" ADD CONSTRAINT "staff_alert_settings_contact_events" CHECK ("commerce"."staff_alert_settings"."contact_events" <@ array['new_order', 'return_requested', 'refund_overdue', 'low_stock', 'summary', 'automation', 'dispute']::text[]);