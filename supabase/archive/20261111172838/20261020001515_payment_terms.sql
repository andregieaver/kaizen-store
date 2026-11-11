CREATE TABLE "commerce"."order_payment_terms" (
	"order_id" uuid PRIMARY KEY NOT NULL,
	"store_id" uuid NOT NULL,
	"company_id" uuid,
	"terms" text NOT NULL,
	"due_on" date NOT NULL,
	"reminder_sent_at" timestamp with time zone,
	"overdue_sent_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_payment_terms_terms" CHECK ("commerce"."order_payment_terms"."terms" in ('net_15', 'net_30', 'net_60'))
);
--> statement-breakpoint
ALTER TABLE "commerce"."email_templates" DROP CONSTRAINT "email_templates_notification";--> statement-breakpoint
ALTER TABLE "commerce"."notification_settings" DROP CONSTRAINT "notification_settings_notification";--> statement-breakpoint
ALTER TABLE "commerce"."refunds" DROP CONSTRAINT "refunds_kind";--> statement-breakpoint
ALTER TABLE "commerce"."staff_alert_recipients" DROP CONSTRAINT "staff_alert_recipients_events";--> statement-breakpoint
ALTER TABLE "commerce"."staff_alert_settings" DROP CONSTRAINT "staff_alert_settings_contact_events";--> statement-breakpoint
ALTER TABLE "commerce"."customer_companies" ADD COLUMN "payment_terms" text;--> statement-breakpoint
ALTER TABLE "commerce"."customer_companies" ADD COLUMN "credit_limit_minor" bigint;--> statement-breakpoint
ALTER TABLE "commerce"."customer_companies" ADD COLUMN "credit_currency" char(3);--> statement-breakpoint
ALTER TABLE "commerce"."order_payment_terms" ADD CONSTRAINT "order_payment_terms_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."order_payment_terms" ADD CONSTRAINT "order_payment_terms_order_fk" FOREIGN KEY ("store_id","order_id") REFERENCES "commerce"."orders"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."order_payment_terms" ADD CONSTRAINT "order_payment_terms_company_fk" FOREIGN KEY ("store_id","company_id") REFERENCES "commerce"."customer_companies"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_payment_terms_company_idx" ON "commerce"."order_payment_terms" USING btree ("store_id","company_id") WHERE "commerce"."order_payment_terms"."paid_at" is null;--> statement-breakpoint
CREATE INDEX "order_payment_terms_due_idx" ON "commerce"."order_payment_terms" USING btree ("due_on") WHERE "commerce"."order_payment_terms"."paid_at" is null;--> statement-breakpoint
ALTER TABLE "commerce"."customer_companies" ADD CONSTRAINT "customer_companies_terms" CHECK ("commerce"."customer_companies"."payment_terms" is null or "commerce"."customer_companies"."payment_terms" in ('net_15', 'net_30', 'net_60'));--> statement-breakpoint
ALTER TABLE "commerce"."customer_companies" ADD CONSTRAINT "customer_companies_credit" CHECK (("commerce"."customer_companies"."credit_limit_minor" is null) = ("commerce"."customer_companies"."credit_currency" is null) and ("commerce"."customer_companies"."credit_limit_minor" is null or "commerce"."customer_companies"."credit_limit_minor" >= 0));--> statement-breakpoint
ALTER TABLE "commerce"."email_templates" ADD CONSTRAINT "email_templates_notification" CHECK ("commerce"."email_templates"."notification" in ('order.confirmation', 'subscription.renewed', 'order.changed', 'order.sent', 'order.parcel_out_for_delivery', 'order.parcel_delivered', 'order.refunded', 'order.cancelled', 'order.payment_due', 'order.payment_overdue', 'order.ready_for_pickup', 'order.out_for_delivery', 'return.approved', 'return.declined', 'return.received', 'return.refunded', 'return.exchange_proposed', 'return.exchange_to_pay', 'return.exchanged', 'return.exchange_lapsed', 'return.label_ready'));--> statement-breakpoint
ALTER TABLE "commerce"."notification_settings" ADD CONSTRAINT "notification_settings_notification" CHECK ("commerce"."notification_settings"."notification" in ('order.confirmation', 'subscription.renewed', 'order.changed', 'order.sent', 'order.parcel_out_for_delivery', 'order.parcel_delivered', 'order.refunded', 'order.cancelled', 'order.payment_due', 'order.payment_overdue', 'order.ready_for_pickup', 'order.out_for_delivery', 'return.acknowledgement', 'return.approved', 'return.declined', 'return.received', 'return.refunded', 'return.exchange_proposed', 'return.exchange_to_pay', 'return.exchanged', 'return.exchange_lapsed', 'return.label_ready'));--> statement-breakpoint
ALTER TABLE "commerce"."refunds" ADD CONSTRAINT "refunds_void" CHECK ("commerce"."refunds"."kind" <> 'void' or ("commerce"."refunds"."provider_reference" is null and "commerce"."refunds"."status" = 'succeeded' and "commerce"."refunds"."exchange_id" is null and "commerce"."refunds"."order_edit_id" is null));--> statement-breakpoint
ALTER TABLE "commerce"."refunds" ADD CONSTRAINT "refunds_kind" CHECK ("commerce"."refunds"."kind" in ('money', 'transfer', 'release', 'void'));--> statement-breakpoint
ALTER TABLE "commerce"."staff_alert_recipients" ADD CONSTRAINT "staff_alert_recipients_events" CHECK (cardinality("commerce"."staff_alert_recipients"."events") > 0 and "commerce"."staff_alert_recipients"."events" <@ array['new_order', 'return_requested', 'refund_overdue', 'low_stock', 'summary', 'automation', 'dispute', 'payment_overdue']::text[]);--> statement-breakpoint
ALTER TABLE "commerce"."staff_alert_settings" ADD CONSTRAINT "staff_alert_settings_contact_events" CHECK ("commerce"."staff_alert_settings"."contact_events" <@ array['new_order', 'return_requested', 'refund_overdue', 'low_stock', 'summary', 'automation', 'dispute', 'payment_overdue']::text[]);