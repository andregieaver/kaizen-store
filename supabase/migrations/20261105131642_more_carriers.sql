CREATE TABLE "commerce"."carrier_labels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"shipment_id" uuid,
	"return_id" uuid,
	"order_id" uuid NOT NULL,
	"carrier" text NOT NULL,
	"pdf" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "carrier_labels_one_owner" CHECK (("commerce"."carrier_labels"."shipment_id" is null) <> ("commerce"."carrier_labels"."return_id" is null)),
	CONSTRAINT "carrier_labels_carrier" CHECK ("commerce"."carrier_labels"."carrier" in ('bring', 'postnord', 'porterbuddy', 'helthjem', 'instabox', 'dhl', 'ups', 'dhl_paket', 'nshift')),
	CONSTRAINT "carrier_labels_pdf" CHECK (octet_length("commerce"."carrier_labels"."pdf") between 5 and 5000000 and substring("commerce"."carrier_labels"."pdf" from 1 for 4) = '\x25504446'::bytea)
);
--> statement-breakpoint
ALTER TABLE "commerce"."retention_rules" DROP CONSTRAINT "retention_rules_kind";--> statement-breakpoint
ALTER TABLE "commerce"."return_settings" DROP CONSTRAINT "return_settings_label_carrier";--> statement-breakpoint
ALTER TABLE "commerce"."returns" DROP CONSTRAINT "returns_label_carrier";--> statement-breakpoint
ALTER TABLE "commerce"."shipping_carriers" DROP CONSTRAINT "shipping_carriers_carrier";--> statement-breakpoint
ALTER TABLE "commerce"."carrier_labels" ADD CONSTRAINT "carrier_labels_shipment_fk" FOREIGN KEY ("store_id","shipment_id") REFERENCES "commerce"."shipments"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."carrier_labels" ADD CONSTRAINT "carrier_labels_return_fk" FOREIGN KEY ("store_id","return_id") REFERENCES "commerce"."returns"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "carrier_labels_shipment_key" ON "commerce"."carrier_labels" USING btree ("store_id","shipment_id") WHERE "commerce"."carrier_labels"."shipment_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "carrier_labels_return_key" ON "commerce"."carrier_labels" USING btree ("store_id","return_id") WHERE "commerce"."carrier_labels"."return_id" is not null;--> statement-breakpoint
CREATE INDEX "carrier_labels_order_idx" ON "commerce"."carrier_labels" USING btree ("store_id","order_id");--> statement-breakpoint
CREATE INDEX "carrier_labels_created_idx" ON "commerce"."carrier_labels" USING btree ("created_at");--> statement-breakpoint
ALTER TABLE "commerce"."retention_rules" ADD CONSTRAINT "retention_rules_kind" CHECK ("commerce"."retention_rules"."kind" in ('bookkeeping', 'host_bookkeeping', 'unpaid_orders', 'email_bodies', 'security_emails', 'carts', 'delivery_quotes', 'customer_codes', 'customer_sessions', 'webhook_payloads', 'consents', 'privacy_request_contact', 'privacy_requests', 'search_queries', 'visits', 'audit_log', 'form_submissions', 'integration_deliveries', 'abandoned_checkouts', 'recommendation_events', 'ai_usage', 'support_transcripts', 'support_records', 'blog_comments', 'assistant_conversations', 'access_requests', 'unconfirmed_signups', 'content_report_senders', 'carrier_labels'));--> statement-breakpoint
ALTER TABLE "commerce"."return_settings" ADD CONSTRAINT "return_settings_label_carrier" CHECK ("commerce"."return_settings"."label_carrier" is null or "commerce"."return_settings"."label_carrier" in ('bring', 'postnord', 'porterbuddy', 'helthjem', 'instabox', 'dhl', 'ups', 'dhl_paket', 'nshift'));--> statement-breakpoint
ALTER TABLE "commerce"."returns" ADD CONSTRAINT "returns_label_carrier" CHECK (("commerce"."returns"."label_source" is not distinct from 'carrier') = ("commerce"."returns"."label_carrier_id" is not null and "commerce"."returns"."label_booked_at" is not null)
        and ("commerce"."returns"."label_carrier_id" is null or "commerce"."returns"."label_carrier_id" in ('bring', 'postnord', 'porterbuddy', 'helthjem', 'instabox', 'dhl', 'ups', 'dhl_paket', 'nshift'))
        and ("commerce"."returns"."label_source" is not distinct from 'carrier' or ("commerce"."returns"."label_service" is null and "commerce"."returns"."label_consignment_number" is null and "commerce"."returns"."label_tracking_number" is null
             and "commerce"."returns"."label_tracking_url" is null and "commerce"."returns"."label_carrier_url" is null and "commerce"."returns"."label_cost_minor" is null and "commerce"."returns"."label_cost_carrier" is null and not "commerce"."returns"."label_test")));--> statement-breakpoint
ALTER TABLE "commerce"."shipping_carriers" ADD CONSTRAINT "shipping_carriers_carrier" CHECK ("commerce"."shipping_carriers"."carrier" in ('bring', 'postnord', 'porterbuddy', 'helthjem', 'instabox', 'dhl', 'ups', 'dhl_paket', 'nshift'));--> statement-breakpoint
-- Instabox, DHL Express and UPS (D457), DHL Paket and nShift (D458) join the carriers a store connects: the three checks that name the carriers
-- learn their ids, and the labels a carrier gives only in its answer (DHL Express, PostNord, DHL Paket; a parcel's or a return's) are kept in
-- carrier_labels, server-only like the rest of commerce, and deleted 30 days after the booking by runRetention's carrier_labels step (and with
-- the person's orders on erasure).
ALTER TABLE commerce.carrier_labels ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
INSERT INTO commerce.retention_rules (kind, country, period_value, period_unit, counts_from, source, source_url, basis, checked_on, valid_from, enforced_by, note)
VALUES
  ('carrier_labels', NULL, 30, 'days', 'event',
   'Kaizen''s own choice under GDPR Art. 5(1)(e) (kept no longer than necessary), not a statute: a proportionality decision for review.',
   NULL, 'policy', '2026-11-05', '2000-01-01', 'runRetention: carrier_labels',
   'Shipping and return labels a carrier gives only once (DHL Express, PostNord, DHL Paket): the PDF, with a name and address, is deleted this long after it was booked, long after it is printed and handed in; the shipment or return and its tracking number stay with the order.');--> statement-breakpoint
-- PostNord's service codes (D458): PostNord's own booking guide names 19 MyPack Collect (to a service point) and 17 MyPack Home, which D136 had the
-- other way round. A store's saved services and prices keep their meaning: 17 and 19 change places in each (no store had PostNord on 5 November).
UPDATE commerce.shipping_carriers SET
  checkout_services = array(select case s when '17' then '19' when '19' then '17' else s end from unnest(checkout_services) s),
  checkout_prices = coalesce((
    select jsonb_object_agg(c.key, case when jsonb_typeof(c.value->'services') = 'object' then jsonb_set(c.value, '{services}', coalesce((
      select jsonb_object_agg(case k.key when '17' then '19' when '19' then '17' else k.key end, k.value) from jsonb_each(c.value->'services') k), '{}'::jsonb)) else c.value end)
    from jsonb_each(checkout_prices) c), '{}'::jsonb)
WHERE carrier = 'postnord' AND (checkout_services && array['17', '19'] OR checkout_prices::text ~ '"(17|19)"');
--> statement-breakpoint
-- The plan comparison's row on return labels (D239) named Posten / Bring alone; PostNord, Instabox, UPS and DHL Paket book them too (D458). Only the
-- row as first written is changed: a description the platform's admin edited is left as it is.
UPDATE commerce.plan_features
   SET description = 'Book a return label with your carrier (Posten / Bring in Norway, PostNord, Instabox, UPS or DHL Paket), by hand or automatically for withdrawals. The customer prints it from the email or the return''s page; if they pay return shipping, its cost is taken off the refund, never more than it cost.'
 WHERE name = 'Return labels from your carrier'
   AND description = 'Book a return label with Posten / Bring for a return in Norway, by hand or automatically for withdrawals. The customer prints it from the email or the return''s page; when the customer pays return shipping, the label''s cost is taken off the refund, never more than it cost.';
