CREATE TABLE "commerce"."checkout_fields" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	"label" jsonb NOT NULL,
	"help" jsonb,
	"position" integer DEFAULT 0 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "checkout_fields_store_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "checkout_fields_kind" CHECK ("commerce"."checkout_fields"."kind" in ('text', 'checkbox'))
);
--> statement-breakpoint
CREATE TABLE "commerce"."checkout_rule_skips" (
	"store_id" uuid NOT NULL,
	"rule_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	"first_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "checkout_rule_skips_rule_id_reason_pk" PRIMARY KEY("rule_id","reason"),
	CONSTRAINT "checkout_rule_skips_reason" CHECK ("commerce"."checkout_rule_skips"."reason" in ('gone', 'unreadable'))
);
--> statement-breakpoint
CREATE TABLE "commerce"."checkout_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"name" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"conditions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"effect" jsonb NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "checkout_rules_store_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "checkout_rules_name" CHECK (char_length("commerce"."checkout_rules"."name") between 1 and 80),
	CONSTRAINT "checkout_rules_effect" CHECK ("commerce"."checkout_rules"."effect" ->> 'kind' in ('hide_shipping', 'rename_shipping', 'hide_payment_method', 'refuse'))
);
--> statement-breakpoint
ALTER TABLE "commerce"."carts" ADD COLUMN "checkout_answers" jsonb;--> statement-breakpoint
ALTER TABLE "commerce"."orders" ADD COLUMN "checkout_answers" jsonb;--> statement-breakpoint
ALTER TABLE "commerce"."orders" ADD COLUMN "rule_hidden_methods" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."orders" ADD COLUMN "checkout_rules_applied" uuid[] DEFAULT '{}'::uuid[] NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."checkout_fields" ADD CONSTRAINT "checkout_fields_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."checkout_rule_skips" ADD CONSTRAINT "checkout_rule_skips_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."checkout_rule_skips" ADD CONSTRAINT "checkout_rule_skips_rule_id_checkout_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "commerce"."checkout_rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."checkout_rules" ADD CONSTRAINT "checkout_rules_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."checkout_rules" ADD CONSTRAINT "checkout_rules_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."checkout_rules" ADD CONSTRAINT "checkout_rules_updated_by_accounts_id_fk" FOREIGN KEY ("updated_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "checkout_fields_store_idx" ON "commerce"."checkout_fields" USING btree ("store_id","position");--> statement-breakpoint
CREATE INDEX "checkout_rule_skips_store_idx" ON "commerce"."checkout_rule_skips" USING btree ("store_id");--> statement-breakpoint
CREATE INDEX "checkout_rules_store_idx" ON "commerce"."checkout_rules" USING btree ("store_id","position") WHERE "commerce"."checkout_rules"."enabled";--> statement-breakpoint
CREATE INDEX "checkout_rules_created_by_idx" ON "commerce"."checkout_rules" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "checkout_rules_updated_by_idx" ON "commerce"."checkout_rules" USING btree ("updated_by");--> statement-breakpoint

-- Checkout rules and fields (wave 9 unit D, D357): read and written by the server only, never through the Data API.
ALTER TABLE "commerce"."checkout_rules" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "commerce"."checkout_rule_skips" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "commerce"."checkout_fields" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- The answers to a store's checkout fields are the buyer's own words: cleared when the order is anonymised, as the note for the driver is.
DO $patch$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('commerce.anonymise_order(uuid, uuid, text)'::regprocedure);
  IF position('checkout_answers' in v_def) > 0 THEN RETURN; END IF;
  v_new := replace(v_def,
    $a$    delivery_note = NULL,
    anonymised_at = now()$a$,
    $b$    delivery_note = NULL,
    -- The answers to the store's checkout fields (D357) are the buyer's own words.
    checkout_answers = NULL,
    anonymised_at = now()$b$);
  IF v_new = v_def THEN RAISE EXCEPTION 'anonymise_order: the order step was not found, so checkout answers would be kept'; END IF;
  EXECUTE v_new;
END;
$patch$;
