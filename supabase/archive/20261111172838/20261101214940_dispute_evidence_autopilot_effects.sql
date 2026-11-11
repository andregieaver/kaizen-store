CREATE TABLE "commerce"."autopilot_effects" (
	"audit_id" bigint PRIMARY KEY NOT NULL,
	"store_id" uuid NOT NULL,
	"tool" text NOT NULL,
	"target_kind" text NOT NULL,
	"product_id" uuid,
	"target_label" text DEFAULT '' NOT NULL,
	"acted_at" timestamp with time zone NOT NULL,
	"days" smallint NOT NULL,
	"currency" char(3) NOT NULL,
	"before_minor" bigint NOT NULL,
	"after_minor" bigint NOT NULL,
	"before_units" integer,
	"after_units" integer,
	"store_before_minor" bigint NOT NULL,
	"store_after_minor" bigint NOT NULL,
	"measured_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "autopilot_effects_target" CHECK ("commerce"."autopilot_effects"."target_kind" in ('product', 'store') and ("commerce"."autopilot_effects"."target_kind" = 'store') = ("commerce"."autopilot_effects"."product_id" is null)),
	CONSTRAINT "autopilot_effects_days" CHECK ("commerce"."autopilot_effects"."days" between 1 and 90)
);
--> statement-breakpoint
CREATE TABLE "commerce"."dispute_evidence" (
	"dispute_id" uuid PRIMARY KEY NOT NULL,
	"store_id" uuid NOT NULL,
	"fields" jsonb NOT NULL,
	"saved_by" uuid,
	"submitted_at" timestamp with time zone,
	"submitted_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dispute_evidence_fields" CHECK (jsonb_typeof("commerce"."dispute_evidence"."fields") = 'object'),
	CONSTRAINT "dispute_evidence_submitted" CHECK ("commerce"."dispute_evidence"."submitted_by" is null or "commerce"."dispute_evidence"."submitted_at" is not null)
);
--> statement-breakpoint
ALTER TABLE "commerce"."autopilot_reports" DROP CONSTRAINT "autopilot_reports_kind";--> statement-breakpoint
ALTER TABLE "commerce"."autopilot_effects" ADD CONSTRAINT "autopilot_effects_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."dispute_evidence" ADD CONSTRAINT "dispute_evidence_saved_by_accounts_id_fk" FOREIGN KEY ("saved_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."dispute_evidence" ADD CONSTRAINT "dispute_evidence_submitted_by_accounts_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."dispute_evidence" ADD CONSTRAINT "dispute_evidence_dispute_fk" FOREIGN KEY ("store_id","dispute_id") REFERENCES "commerce"."payment_disputes"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "autopilot_effects_store_idx" ON "commerce"."autopilot_effects" USING btree ("store_id","acted_at");--> statement-breakpoint
CREATE INDEX "dispute_evidence_saved_by_idx" ON "commerce"."dispute_evidence" USING btree ("saved_by");--> statement-breakpoint
CREATE INDEX "dispute_evidence_submitted_by_idx" ON "commerce"."dispute_evidence" USING btree ("submitted_by");--> statement-breakpoint
CREATE INDEX "audit_log_autopilot_idx" ON "commerce"."audit_log" USING btree ("created_at") WHERE "commerce"."audit_log"."acted_by" = 'autopilot';--> statement-breakpoint
ALTER TABLE "commerce"."autopilot_reports" ADD CONSTRAINT "autopilot_reports_kind" CHECK ("commerce"."autopilot_reports"."kind" in ('daily', 'weekly', 'monthly'));--> statement-breakpoint
-- Written only by src/server/dispute-evidence.ts and src/server/autopilot-effects.ts, never through the Data API.
ALTER TABLE "commerce"."dispute_evidence" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "commerce"."autopilot_effects" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- The chargeback assistant (D417). Evidence sent to Stripe is the record of what was sent: its fields are not changed afterwards, only emptied
-- when the order is anonymised. A send is claimed first (`submitted_at`) and given back when Stripe refuses, with the fields as they were.
CREATE FUNCTION commerce.dispute_evidence_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF OLD.submitted_at IS NOT NULL AND NEW.fields IS DISTINCT FROM OLD.fields AND NEW.fields <> '{}'::jsonb THEN
    RAISE EXCEPTION 'dispute_evidence.sent: evidence sent to Stripe is kept as it was sent' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.dispute_id IS DISTINCT FROM OLD.dispute_id OR NEW.store_id IS DISTINCT FROM OLD.store_id THEN
    RAISE EXCEPTION 'dispute_evidence.fixed: evidence stays with its dispute' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER dispute_evidence_guard BEFORE UPDATE ON commerce.dispute_evidence FOR EACH ROW EXECUTE FUNCTION commerce.dispute_evidence_guard();
--> statement-breakpoint
-- The evidence copies the buyer's name, email, addresses and messages (`src/lib/personal-data.ts`): emptied when its order is anonymised, by
-- `commerce.anonymise_order()` or anything else that sets `anonymised_at`. The row stays as the record that evidence was sent, and when.
CREATE FUNCTION commerce.dispute_evidence_forget()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  UPDATE commerce.dispute_evidence e SET fields = '{}'::jsonb, updated_at = now()
    FROM commerce.payment_disputes d
   WHERE d.store_id = NEW.store_id AND d.order_id = NEW.id AND e.store_id = d.store_id AND e.dispute_id = d.id AND e.fields <> '{}'::jsonb;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER orders_dispute_evidence_forget AFTER UPDATE OF anonymised_at ON commerce.orders
  FOR EACH ROW WHEN (OLD.anonymised_at IS NULL AND NEW.anonymised_at IS NOT NULL) EXECUTE FUNCTION commerce.dispute_evidence_forget();
