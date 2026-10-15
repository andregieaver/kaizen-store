CREATE TABLE "commerce"."email_templates" (
	"store_id" uuid NOT NULL,
	"notification" text NOT NULL,
	"locale" text NOT NULL,
	"subject" text,
	"heading" text,
	"body" text,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_templates_store_id_notification_locale_pk" PRIMARY KEY("store_id","notification","locale"),
	CONSTRAINT "email_templates_notification" CHECK ("commerce"."email_templates"."notification" in ('order.confirmation', 'subscription.renewed', 'order.changed', 'order.sent', 'order.parcel_out_for_delivery', 'order.parcel_delivered', 'order.refunded', 'order.cancelled', 'order.ready_for_pickup', 'order.out_for_delivery', 'return.approved', 'return.declined', 'return.received', 'return.refunded')),
	CONSTRAINT "email_templates_locale" CHECK ("commerce"."email_templates"."locale" ~ '^[a-z]{2,3}$'),
	CONSTRAINT "email_templates_slots" CHECK (("commerce"."email_templates"."subject" is not null or "commerce"."email_templates"."heading" is not null or "commerce"."email_templates"."body" is not null)
        and ("commerce"."email_templates"."subject" is null or char_length("commerce"."email_templates"."subject") between 1 and 150)
        and ("commerce"."email_templates"."heading" is null or char_length("commerce"."email_templates"."heading") between 1 and 120)
        and ("commerce"."email_templates"."body" is null or char_length("commerce"."email_templates"."body") between 1 and 2000))
);
--> statement-breakpoint
CREATE TABLE "commerce"."notification_settings" (
	"store_id" uuid NOT NULL,
	"notification" text NOT NULL,
	"enabled" boolean NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_settings_store_id_notification_pk" PRIMARY KEY("store_id","notification"),
	CONSTRAINT "notification_settings_notification" CHECK ("commerce"."notification_settings"."notification" in ('order.confirmation', 'subscription.renewed', 'order.changed', 'order.sent', 'order.parcel_out_for_delivery', 'order.parcel_delivered', 'order.refunded', 'order.cancelled', 'order.ready_for_pickup', 'order.out_for_delivery', 'return.acknowledgement', 'return.approved', 'return.declined', 'return.received', 'return.refunded')),
	CONSTRAINT "notification_settings_required" CHECK ("commerce"."notification_settings"."enabled" or "commerce"."notification_settings"."notification" not in ('order.confirmation', 'subscription.renewed', 'order.changed', 'return.acknowledgement', 'return.approved', 'return.declined'))
);
--> statement-breakpoint
CREATE TABLE "commerce"."order_rule_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"rule_id" uuid NOT NULL,
	"rule_name" text NOT NULL,
	"rule_version" integer NOT NULL,
	"event_id" uuid,
	"order_id" uuid NOT NULL,
	"matched" boolean NOT NULL,
	"outcome" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_rule_runs_once_key" UNIQUE("rule_id","event_id"),
	CONSTRAINT "order_rule_runs_rule_name" CHECK (char_length("commerce"."order_rule_runs"."rule_name") between 1 and 80),
	CONSTRAINT "order_rule_runs_outcome" CHECK (jsonb_typeof("commerce"."order_rule_runs"."outcome") = 'object' and octet_length("commerce"."order_rule_runs"."outcome"::text) < 8192)
);
--> statement-breakpoint
CREATE TABLE "commerce"."order_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"name" text NOT NULL,
	"event" text DEFAULT 'order.paid' NOT NULL,
	"match" text DEFAULT 'all' NOT NULL,
	"conditions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"actions" jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_rules_store_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "order_rules_name" CHECK (char_length("commerce"."order_rules"."name") between 1 and 80 and "commerce"."order_rules"."name" = btrim("commerce"."order_rules"."name")),
	CONSTRAINT "order_rules_event" CHECK ("commerce"."order_rules"."event" = 'order.paid'),
	CONSTRAINT "order_rules_match" CHECK ("commerce"."order_rules"."match" in ('all', 'any')),
	CONSTRAINT "order_rules_lists" CHECK (jsonb_typeof("commerce"."order_rules"."conditions") = 'array' and jsonb_array_length("commerce"."order_rules"."conditions") between 0 and 10
        and jsonb_typeof("commerce"."order_rules"."actions") = 'array' and jsonb_array_length("commerce"."order_rules"."actions") between 1 and 5),
	CONSTRAINT "order_rules_position" CHECK ("commerce"."order_rules"."position" >= 0),
	CONSTRAINT "order_rules_version" CHECK ("commerce"."order_rules"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "commerce"."shipment_tracking" (
	"store_id" uuid NOT NULL,
	"shipment_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"carrier" text NOT NULL,
	"phase" text DEFAULT 'unknown' NOT NULL,
	"phase_verified" boolean DEFAULT false NOT NULL,
	"events" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"checked_at" timestamp with time zone,
	"next_check_at" timestamp with time zone DEFAULT now() NOT NULL,
	"failures" integer DEFAULT 0 NOT NULL,
	"out_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"stopped" text,
	"stopped_at" timestamp with time zone,
	"emailed_out" boolean DEFAULT false NOT NULL,
	"emailed_delivered" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shipment_tracking_store_id_shipment_id_pk" PRIMARY KEY("store_id","shipment_id"),
	CONSTRAINT "shipment_tracking_phase" CHECK ("commerce"."shipment_tracking"."phase" in ('info_received', 'in_transit', 'out_for_delivery', 'ready_for_collection', 'attempted', 'delivered', 'returned_to_sender', 'problem', 'unknown')),
	CONSTRAINT "shipment_tracking_stopped" CHECK (("commerce"."shipment_tracking"."stopped" is null) = ("commerce"."shipment_tracking"."stopped_at" is null) and ("commerce"."shipment_tracking"."stopped" is null or "commerce"."shipment_tracking"."stopped" in ('delivered', 'returned', 'old', 'undone', 'carrier_failing', 'no_agreement'))),
	CONSTRAINT "shipment_tracking_events" CHECK (jsonb_typeof("commerce"."shipment_tracking"."events") = 'array' and jsonb_array_length("commerce"."shipment_tracking"."events") <= 30),
	CONSTRAINT "shipment_tracking_failures" CHECK ("commerce"."shipment_tracking"."failures" >= 0),
	CONSTRAINT "shipment_tracking_carrier" CHECK (char_length("commerce"."shipment_tracking"."carrier") between 1 and 40)
);
--> statement-breakpoint
CREATE TABLE "commerce"."staff_alert_recipients" (
	"store_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"events" text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_alert_recipients_store_id_account_id_pk" PRIMARY KEY("store_id","account_id"),
	CONSTRAINT "staff_alert_recipients_events" CHECK (cardinality("commerce"."staff_alert_recipients"."events") > 0 and "commerce"."staff_alert_recipients"."events" <@ array['new_order', 'return_requested', 'refund_overdue', 'low_stock', 'summary', 'automation']::text[])
);
--> statement-breakpoint
CREATE TABLE "commerce"."staff_alert_settings" (
	"store_id" uuid PRIMARY KEY NOT NULL,
	"configured_at" timestamp with time zone,
	"summary" text DEFAULT 'off' NOT NULL,
	"summary_weekday" smallint DEFAULT 1 NOT NULL,
	"summary_hour" smallint DEFAULT 8 NOT NULL,
	"summary_last_period" text,
	"contact_events" text[] DEFAULT '{}'::text[] NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_alert_settings_summary" CHECK ("commerce"."staff_alert_settings"."summary" in ('off', 'daily', 'weekly')),
	CONSTRAINT "staff_alert_settings_weekday" CHECK ("commerce"."staff_alert_settings"."summary_weekday" between 1 and 7),
	CONSTRAINT "staff_alert_settings_hour" CHECK ("commerce"."staff_alert_settings"."summary_hour" between 0 and 23),
	CONSTRAINT "staff_alert_settings_contact_events" CHECK ("commerce"."staff_alert_settings"."contact_events" <@ array['new_order', 'return_requested', 'refund_overdue', 'low_stock', 'summary', 'automation']::text[]),
	CONSTRAINT "staff_alert_settings_last_period" CHECK ("commerce"."staff_alert_settings"."summary_last_period" is null or char_length("commerce"."staff_alert_settings"."summary_last_period") <= 40)
);
--> statement-breakpoint
CREATE TABLE "commerce"."store_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"event" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"alerts_done_at" timestamp with time zone,
	"rules_done_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_until" timestamp with time zone,
	"last_error" text,
	"failed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "store_events_once_key" UNIQUE("store_id","event","subject_id"),
	CONSTRAINT "store_events_event" CHECK ("commerce"."store_events"."event" in ('order.paid', 'return.requested')),
	CONSTRAINT "store_events_attempts" CHECK ("commerce"."store_events"."attempts" between 0 and 10),
	CONSTRAINT "store_events_last_error" CHECK ("commerce"."store_events"."last_error" is null or char_length("commerce"."store_events"."last_error") <= 500)
);
--> statement-breakpoint
ALTER TABLE "commerce"."orders" ADD COLUMN "delivered_source" text;--> statement-breakpoint
ALTER TABLE "commerce"."orders" ADD COLUMN "held_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "commerce"."orders" ADD COLUMN "held_reason" text;--> statement-breakpoint
ALTER TABLE "commerce"."orders" ADD COLUMN "held_by_rule" uuid;--> statement-breakpoint
ALTER TABLE "commerce"."orders" ADD COLUMN "held_by" uuid;--> statement-breakpoint
ALTER TABLE "commerce"."email_templates" ADD CONSTRAINT "email_templates_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."email_templates" ADD CONSTRAINT "email_templates_updated_by_accounts_id_fk" FOREIGN KEY ("updated_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."notification_settings" ADD CONSTRAINT "notification_settings_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."notification_settings" ADD CONSTRAINT "notification_settings_updated_by_accounts_id_fk" FOREIGN KEY ("updated_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."order_rule_runs" ADD CONSTRAINT "order_rule_runs_event_id_store_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "commerce"."store_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."order_rule_runs" ADD CONSTRAINT "order_rule_runs_order_fk" FOREIGN KEY ("store_id","order_id") REFERENCES "commerce"."orders"("store_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."order_rules" ADD CONSTRAINT "order_rules_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."order_rules" ADD CONSTRAINT "order_rules_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."order_rules" ADD CONSTRAINT "order_rules_updated_by_accounts_id_fk" FOREIGN KEY ("updated_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."shipment_tracking" ADD CONSTRAINT "shipment_tracking_shipment_fk" FOREIGN KEY ("store_id","shipment_id") REFERENCES "commerce"."shipments"("store_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."shipment_tracking" ADD CONSTRAINT "shipment_tracking_order_fk" FOREIGN KEY ("store_id","order_id") REFERENCES "commerce"."orders"("store_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."staff_alert_recipients" ADD CONSTRAINT "staff_alert_recipients_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."staff_alert_recipients" ADD CONSTRAINT "staff_alert_recipients_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "commerce"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."staff_alert_settings" ADD CONSTRAINT "staff_alert_settings_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."staff_alert_settings" ADD CONSTRAINT "staff_alert_settings_updated_by_accounts_id_fk" FOREIGN KEY ("updated_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."store_events" ADD CONSTRAINT "store_events_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_templates_updated_by_idx" ON "commerce"."email_templates" USING btree ("updated_by");--> statement-breakpoint
CREATE INDEX "notification_settings_updated_by_idx" ON "commerce"."notification_settings" USING btree ("updated_by");--> statement-breakpoint
CREATE INDEX "order_rule_runs_store_idx" ON "commerce"."order_rule_runs" USING btree ("store_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "order_rule_runs_order_idx" ON "commerce"."order_rule_runs" USING btree ("store_id","order_id");--> statement-breakpoint
CREATE INDEX "order_rule_runs_event_idx" ON "commerce"."order_rule_runs" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "order_rules_position_idx" ON "commerce"."order_rules" USING btree ("store_id","position");--> statement-breakpoint
CREATE INDEX "order_rules_created_by_idx" ON "commerce"."order_rules" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "order_rules_updated_by_idx" ON "commerce"."order_rules" USING btree ("updated_by");--> statement-breakpoint
CREATE INDEX "shipment_tracking_order_idx" ON "commerce"."shipment_tracking" USING btree ("store_id","order_id");--> statement-breakpoint
CREATE INDEX "shipment_tracking_due_idx" ON "commerce"."shipment_tracking" USING btree ("next_check_at") WHERE "commerce"."shipment_tracking"."stopped" is null;--> statement-breakpoint
CREATE INDEX "staff_alert_recipients_account_idx" ON "commerce"."staff_alert_recipients" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "staff_alert_settings_updated_by_idx" ON "commerce"."staff_alert_settings" USING btree ("updated_by");--> statement-breakpoint
CREATE INDEX "store_events_due_idx" ON "commerce"."store_events" USING btree ("next_attempt_at") WHERE ("commerce"."store_events"."alerts_done_at" is null or "commerce"."store_events"."rules_done_at" is null) and "commerce"."store_events"."failed_at" is null;--> statement-breakpoint
ALTER TABLE "commerce"."orders" ADD CONSTRAINT "orders_held_by_accounts_id_fk" FOREIGN KEY ("held_by") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "orders_held_by_idx" ON "commerce"."orders" USING btree ("held_by");--> statement-breakpoint
CREATE INDEX "orders_held_idx" ON "commerce"."orders" USING btree ("store_id","held_at") WHERE "commerce"."orders"."held_at" is not null;--> statement-breakpoint
ALTER TABLE "commerce"."orders" ADD CONSTRAINT "orders_delivered_source" CHECK ("commerce"."orders"."delivered_source" is null or ("commerce"."orders"."delivered_at" is not null and "commerce"."orders"."delivered_source" in ('staff', 'handover', 'carrier')));--> statement-breakpoint
ALTER TABLE "commerce"."orders" ADD CONSTRAINT "orders_held" CHECK (("commerce"."orders"."held_at" is not null or ("commerce"."orders"."held_reason" is null and "commerce"."orders"."held_by_rule" is null and "commerce"."orders"."held_by" is null)) and not ("commerce"."orders"."held_by_rule" is not null and "commerce"."orders"."held_by" is not null) and ("commerce"."orders"."held_reason" is null or char_length("commerce"."orders"."held_reason") between 1 and 200));