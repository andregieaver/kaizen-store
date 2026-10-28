CREATE TABLE "commerce"."analytics_alert_sends" (
	"store_id" uuid NOT NULL,
	"day" date NOT NULL,
	"alert_id" text NOT NULL,
	"severity" text NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "analytics_alert_sends_store_id_day_alert_id_pk" PRIMARY KEY("store_id","day","alert_id"),
	CONSTRAINT "analytics_alert_sends_alert" CHECK (char_length("commerce"."analytics_alert_sends"."alert_id") between 1 and 80),
	CONSTRAINT "analytics_alert_sends_severity" CHECK ("commerce"."analytics_alert_sends"."severity" in ('urgent', 'warning', 'info'))
);
--> statement-breakpoint
ALTER TABLE "commerce"."analytics_targets" DROP CONSTRAINT "analytics_targets_first_of_month";--> statement-breakpoint
ALTER TABLE "commerce"."analytics_targets" DROP CONSTRAINT "analytics_targets_amount";--> statement-breakpoint
ALTER TABLE "commerce"."staff_alert_recipients" DROP CONSTRAINT "staff_alert_recipients_events";--> statement-breakpoint
ALTER TABLE "commerce"."staff_alert_settings" DROP CONSTRAINT "staff_alert_settings_contact_events";--> statement-breakpoint
ALTER TABLE "commerce"."analytics_targets" ALTER COLUMN "month" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."analytics_targets" ALTER COLUMN "revenue_target_minor" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."analytics_targets" ADD COLUMN "metric" text DEFAULT 'net_sales' NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."analytics_targets" ADD COLUMN "period" text DEFAULT 'month' NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."analytics_targets" ADD COLUMN "starts_on" date;--> statement-breakpoint
ALTER TABLE "commerce"."analytics_targets" ADD COLUMN "ends_on" date;--> statement-breakpoint
ALTER TABLE "commerce"."analytics_targets" ADD COLUMN "target_value" bigint;--> statement-breakpoint
-- The targets already set are monthly net-sales targets (D152): their new columns say so.
UPDATE "commerce"."analytics_targets" SET "starts_on" = "month", "ends_on" = ("month" + interval '1 month - 1 day')::date, "target_value" = "revenue_target_minor";--> statement-breakpoint
-- A writer that knows only the first form (the code running while this deploys) gives a month and an amount; a writer of a monthly net-sales target that gives
-- only the new columns gets the first form filled in, so the two always agree (D348).
CREATE FUNCTION "commerce"."analytics_targets_forms"() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.starts_on IS NULL AND NEW.month IS NOT NULL THEN
    NEW.metric := 'net_sales';
    NEW.period := 'month';
    NEW.starts_on := NEW.month;
    NEW.ends_on := (NEW.month + interval '1 month - 1 day')::date;
    NEW.target_value := NEW.revenue_target_minor;
  ELSIF NEW.month IS NOT NULL AND NEW.revenue_target_minor IS NOT NULL AND NEW.target_value IS DISTINCT FROM NEW.revenue_target_minor
    AND NEW.starts_on = NEW.month AND TG_OP = 'UPDATE' AND NEW.revenue_target_minor IS DISTINCT FROM OLD.revenue_target_minor THEN
    -- The first form's upsert changes the amount only.
    NEW.target_value := NEW.revenue_target_minor;
  END IF;
  IF NEW.metric = 'net_sales' AND NEW.period = 'month' THEN
    NEW.month := NEW.starts_on;
    NEW.revenue_target_minor := NEW.target_value;
  ELSE
    NEW.month := NULL;
    NEW.revenue_target_minor := NULL;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "analytics_targets_forms" BEFORE INSERT OR UPDATE ON "commerce"."analytics_targets" FOR EACH ROW EXECUTE FUNCTION "commerce"."analytics_targets_forms"();--> statement-breakpoint
ALTER TABLE "commerce"."analytics_targets" ALTER COLUMN "starts_on" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."analytics_targets" ALTER COLUMN "ends_on" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."analytics_targets" ALTER COLUMN "target_value" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."staff_alert_settings" ADD COLUMN "alert_floor" text DEFAULT 'warning' NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."staff_alert_settings" ADD COLUMN "alerts_checked_on" date;--> statement-breakpoint
ALTER TABLE "commerce"."staff_alert_settings" ADD COLUMN "briefing_offer_dismissed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "commerce"."analytics_alert_sends" ADD CONSTRAINT "analytics_alert_sends_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "analytics_targets_period_key" ON "commerce"."analytics_targets" USING btree ("store_id","metric","period","starts_on");--> statement-breakpoint
ALTER TABLE "commerce"."analytics_targets" ADD CONSTRAINT "analytics_targets_metric" CHECK ("commerce"."analytics_targets"."metric" in ('net_sales', 'orders', 'conversion', 'aov'));--> statement-breakpoint
ALTER TABLE "commerce"."analytics_targets" ADD CONSTRAINT "analytics_targets_period" CHECK ("commerce"."analytics_targets"."period" in ('week', 'month', 'quarter', 'custom'));--> statement-breakpoint
ALTER TABLE "commerce"."analytics_targets" ADD CONSTRAINT "analytics_targets_value" CHECK ("commerce"."analytics_targets"."target_value" > 0 and ("commerce"."analytics_targets"."metric" <> 'conversion' or "commerce"."analytics_targets"."target_value" <= 10000));--> statement-breakpoint
ALTER TABLE "commerce"."analytics_targets" ADD CONSTRAINT "analytics_targets_bounds" CHECK ("commerce"."analytics_targets"."ends_on" >= "commerce"."analytics_targets"."starts_on" and "commerce"."analytics_targets"."ends_on" <= "commerce"."analytics_targets"."starts_on" + 730 and case "commerce"."analytics_targets"."period"
        when 'week' then extract(isodow from "commerce"."analytics_targets"."starts_on") = 1 and "commerce"."analytics_targets"."ends_on" = "commerce"."analytics_targets"."starts_on" + 6
        when 'month' then "commerce"."analytics_targets"."starts_on" = date_trunc('month', "commerce"."analytics_targets"."starts_on"::timestamp)::date and "commerce"."analytics_targets"."ends_on" = (date_trunc('month', "commerce"."analytics_targets"."starts_on"::timestamp) + interval '1 month - 1 day')::date
        when 'quarter' then "commerce"."analytics_targets"."starts_on" = date_trunc('quarter', "commerce"."analytics_targets"."starts_on"::timestamp)::date and "commerce"."analytics_targets"."ends_on" = (date_trunc('quarter', "commerce"."analytics_targets"."starts_on"::timestamp) + interval '3 months - 1 day')::date
        else true end);--> statement-breakpoint
ALTER TABLE "commerce"."analytics_targets" ADD CONSTRAINT "analytics_targets_first_form" CHECK (("commerce"."analytics_targets"."month" is null) = ("commerce"."analytics_targets"."revenue_target_minor" is null) and ("commerce"."analytics_targets"."month" is null
        or ("commerce"."analytics_targets"."metric" = 'net_sales' and "commerce"."analytics_targets"."period" = 'month' and "commerce"."analytics_targets"."month" = "commerce"."analytics_targets"."starts_on" and "commerce"."analytics_targets"."revenue_target_minor" = "commerce"."analytics_targets"."target_value")));--> statement-breakpoint
ALTER TABLE "commerce"."analytics_targets" ADD CONSTRAINT "analytics_targets_first_of_month" CHECK ("commerce"."analytics_targets"."month" is null or "commerce"."analytics_targets"."month" = date_trunc('month', "commerce"."analytics_targets"."month"::timestamp)::date);--> statement-breakpoint
ALTER TABLE "commerce"."analytics_targets" ADD CONSTRAINT "analytics_targets_amount" CHECK ("commerce"."analytics_targets"."revenue_target_minor" is null or "commerce"."analytics_targets"."revenue_target_minor" > 0);--> statement-breakpoint
ALTER TABLE "commerce"."staff_alert_recipients" ADD CONSTRAINT "staff_alert_recipients_events" CHECK (cardinality("commerce"."staff_alert_recipients"."events") > 0 and "commerce"."staff_alert_recipients"."events" <@ array['new_order', 'return_requested', 'refund_overdue', 'low_stock', 'summary', 'automation', 'dispute', 'payment_overdue', 'analytics']::text[]);--> statement-breakpoint
ALTER TABLE "commerce"."staff_alert_settings" ADD CONSTRAINT "staff_alert_settings_alert_floor" CHECK ("commerce"."staff_alert_settings"."alert_floor" in ('urgent', 'warning', 'info'));--> statement-breakpoint
ALTER TABLE "commerce"."staff_alert_settings" ADD CONSTRAINT "staff_alert_settings_contact_events" CHECK ("commerce"."staff_alert_settings"."contact_events" <@ array['new_order', 'return_requested', 'refund_overdue', 'low_stock', 'summary', 'automation', 'dispute', 'payment_overdue', 'analytics']::text[]);--> statement-breakpoint
ALTER TABLE "commerce"."analytics_alert_sends" ENABLE ROW LEVEL SECURITY;
