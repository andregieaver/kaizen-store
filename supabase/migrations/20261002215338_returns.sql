ALTER TYPE "commerce"."return_status" ADD VALUE 'approved' BEFORE 'in_transit';--> statement-breakpoint
ALTER TYPE "commerce"."return_status" ADD VALUE 'declined';--> statement-breakpoint
ALTER TYPE "commerce"."return_status" ADD VALUE 'cancelled';--> statement-breakpoint
CREATE TABLE "commerce"."return_settings" (
	"store_id" uuid PRIMARY KEY NOT NULL,
	"window_days" integer DEFAULT 14 NOT NULL,
	"transit_days" integer DEFAULT 3 NOT NULL,
	"who_pays_return" text DEFAULT 'shopper' NOT NULL,
	"refund_when" text DEFAULT 'received' NOT NULL,
	"accept_excluded" boolean DEFAULT false NOT NULL,
	"instructions" text DEFAULT '' NOT NULL,
	"return_address" jsonb,
	"b2b_returns" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "return_settings_window" CHECK ("commerce"."return_settings"."window_days" between 14 and 100),
	CONSTRAINT "return_settings_transit" CHECK ("commerce"."return_settings"."transit_days" between 0 and 14),
	CONSTRAINT "return_settings_who_pays" CHECK ("commerce"."return_settings"."who_pays_return" in ('shopper', 'store')),
	CONSTRAINT "return_settings_refund_when" CHECK ("commerce"."return_settings"."refund_when" in ('received', 'request')),
	CONSTRAINT "return_settings_instructions" CHECK (length("commerce"."return_settings"."instructions") <= 2000)
);
--> statement-breakpoint
CREATE TABLE "commerce"."withdrawal_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"key_kind" text NOT NULL,
	"key_hash" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "withdrawal_attempts_kind" CHECK ("commerce"."withdrawal_attempts"."key_kind" in ('email', 'order'))
);
--> statement-breakpoint
ALTER TABLE "commerce"."return_lines" ADD COLUMN "reason" text;--> statement-breakpoint
ALTER TABLE "commerce"."return_lines" ADD COLUMN "restock" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."return_lines" ADD COLUMN "deduction_minor" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."return_lines" ADD COLUMN "deduction_note" text;--> statement-breakpoint
ALTER TABLE "commerce"."return_lines" ADD COLUMN "decision" text DEFAULT 'accept' NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."return_lines" ADD COLUMN "decline_reason" text;--> statement-breakpoint
ALTER TABLE "commerce"."returns" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."returns" ADD COLUMN "kind" text DEFAULT 'return' NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."returns" ADD COLUMN "number" text NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."returns" ADD COLUMN "reason" text;--> statement-breakpoint
ALTER TABLE "commerce"."returns" ADD COLUMN "reason_note" text;--> statement-breakpoint
ALTER TABLE "commerce"."returns" ADD COLUMN "instructions" text;--> statement-breakpoint
ALTER TABLE "commerce"."returns" ADD COLUMN "label_url" text;--> statement-breakpoint
ALTER TABLE "commerce"."returns" ADD COLUMN "return_address" jsonb;--> statement-breakpoint
ALTER TABLE "commerce"."returns" ADD COLUMN "decision_note" text;--> statement-breakpoint
ALTER TABLE "commerce"."returns" ADD COLUMN "staff_note" text;--> statement-breakpoint
ALTER TABLE "commerce"."returns" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "commerce"."returns" ADD COLUMN "shipped_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "commerce"."returns" ADD COLUMN "received_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "commerce"."returns" ADD COLUMN "inspected_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "commerce"."returns" ADD COLUMN "closed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "commerce"."returns" ADD COLUMN "outcome" text;--> statement-breakpoint
ALTER TABLE "commerce"."returns" ADD COLUMN "refund_id" uuid;--> statement-breakpoint
ALTER TABLE "commerce"."returns" ADD COLUMN "refund_computed_minor" bigint;--> statement-breakpoint
ALTER TABLE "commerce"."returns" ADD COLUMN "refund_minor" bigint;--> statement-breakpoint
ALTER TABLE "commerce"."returns" ADD COLUMN "refund_note" text;--> statement-breakpoint
ALTER TABLE "commerce"."returns" ADD COLUMN "refunded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "commerce"."returns" ADD COLUMN "refund_outside" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."returns" ADD COLUMN "return_shipping_minor" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."returns" ADD COLUMN "refund_deadline" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "commerce"."returns" ADD COLUMN "shipping_refund_minor" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."returns" ADD COLUMN "refund_claimed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "commerce"."orders" ADD COLUMN "return_cost_payer" text;--> statement-breakpoint
ALTER TABLE "commerce"."orders" ADD COLUMN "standard_shipping_minor" bigint;--> statement-breakpoint
ALTER TABLE "commerce"."returns" ADD COLUMN "public_token" text DEFAULT replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '') NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."withdrawal_requests" ADD COLUMN "locale" text DEFAULT 'en' NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."withdrawal_requests" ADD COLUMN "market_code" char(2);--> statement-breakpoint
ALTER TABLE "commerce"."withdrawal_requests" ADD COLUMN "status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."withdrawal_requests" ADD COLUMN "expires_at" timestamp with time zone DEFAULT now() + interval '24 hours' NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."return_settings" ADD CONSTRAINT "return_settings_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."return_settings" ADD CONSTRAINT "return_settings_updated_by_accounts_id_fk" FOREIGN KEY ("updated_by") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "return_settings_updated_by_idx" ON "commerce"."return_settings" USING btree ("updated_by");--> statement-breakpoint
ALTER TABLE "commerce"."returns" ADD CONSTRAINT "returns_refund_fk" FOREIGN KEY ("store_id","refund_id") REFERENCES "commerce"."refunds"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "returns_withdrawal_request_key" ON "commerce"."returns" USING btree ("store_id","withdrawal_request_id") WHERE "commerce"."returns"."withdrawal_request_id" is not null;--> statement-breakpoint
CREATE INDEX "returns_refund_idx" ON "commerce"."returns" USING btree ("store_id","refund_id");--> statement-breakpoint
CREATE INDEX "returns_queue_idx" ON "commerce"."returns" USING btree ("store_id","status","created_at");--> statement-breakpoint
CREATE INDEX "returns_refund_deadline_idx" ON "commerce"."returns" USING btree ("store_id","refund_deadline");--> statement-breakpoint
CREATE INDEX "withdrawal_requests_expiry_idx" ON "commerce"."withdrawal_requests" USING btree ("expires_at") WHERE "commerce"."withdrawal_requests"."confirmed_at" is null;--> statement-breakpoint
ALTER TABLE "commerce"."returns" ADD CONSTRAINT "returns_store_number_key" UNIQUE("store_id","number");--> statement-breakpoint
ALTER TABLE "commerce"."returns" ADD CONSTRAINT "returns_public_token_key" UNIQUE("public_token");--> statement-breakpoint
ALTER TABLE "commerce"."return_lines" ADD CONSTRAINT "return_lines_condition" CHECK ("commerce"."return_lines"."condition" is null or "commerce"."return_lines"."condition" in ('as_new', 'opened', 'used', 'damaged'));--> statement-breakpoint
ALTER TABLE "commerce"."return_lines" ADD CONSTRAINT "return_lines_reason" CHECK ("commerce"."return_lines"."reason" is null or "commerce"."return_lines"."reason" in ('changed_mind', 'too_big', 'too_small', 'defective', 'not_as_described', 'damaged_in_transit', 'wrong_item', 'arrived_late', 'other'));--> statement-breakpoint
ALTER TABLE "commerce"."return_lines" ADD CONSTRAINT "return_lines_deduction" CHECK ("commerce"."return_lines"."deduction_minor" >= 0);--> statement-breakpoint
ALTER TABLE "commerce"."return_lines" ADD CONSTRAINT "return_lines_deduction_note" CHECK ("commerce"."return_lines"."deduction_note" is null or length("commerce"."return_lines"."deduction_note") <= 500);--> statement-breakpoint
ALTER TABLE "commerce"."return_lines" ADD CONSTRAINT "return_lines_decision" CHECK ("commerce"."return_lines"."decision" in ('accept', 'decline'));--> statement-breakpoint
ALTER TABLE "commerce"."return_lines" ADD CONSTRAINT "return_lines_decline_reason" CHECK ("commerce"."return_lines"."decision" = 'accept' or length(trim(coalesce("commerce"."return_lines"."decline_reason", ''))) > 0);--> statement-breakpoint
ALTER TABLE "commerce"."return_lines" ADD CONSTRAINT "return_lines_declined_nothing" CHECK ("commerce"."return_lines"."decision" = 'accept' or ("commerce"."return_lines"."deduction_minor" = 0 and not "commerce"."return_lines"."restock"));--> statement-breakpoint
ALTER TABLE "commerce"."returns" ADD CONSTRAINT "returns_kind" CHECK ("commerce"."returns"."kind" in ('withdrawal', 'return'));--> statement-breakpoint
ALTER TABLE "commerce"."returns" ADD CONSTRAINT "returns_kind_request" CHECK (("commerce"."returns"."kind" = 'withdrawal') = ("commerce"."returns"."withdrawal_request_id" is not null));--> statement-breakpoint
ALTER TABLE "commerce"."returns" ADD CONSTRAINT "returns_reason" CHECK ("commerce"."returns"."reason" is null or "commerce"."returns"."reason" in ('changed_mind', 'too_big', 'too_small', 'defective', 'not_as_described', 'damaged_in_transit', 'wrong_item', 'arrived_late', 'other'));--> statement-breakpoint
ALTER TABLE "commerce"."returns" ADD CONSTRAINT "returns_reason_note" CHECK ("commerce"."returns"."reason_note" is null or length("commerce"."returns"."reason_note") <= 500);--> statement-breakpoint
ALTER TABLE "commerce"."returns" ADD CONSTRAINT "returns_instructions" CHECK ("commerce"."returns"."instructions" is null or length("commerce"."returns"."instructions") <= 2000);--> statement-breakpoint
ALTER TABLE "commerce"."returns" ADD CONSTRAINT "returns_decision_note" CHECK ("commerce"."returns"."decision_note" is null or length("commerce"."returns"."decision_note") <= 1000);--> statement-breakpoint
ALTER TABLE "commerce"."returns" ADD CONSTRAINT "returns_staff_note" CHECK ("commerce"."returns"."staff_note" is null or length("commerce"."returns"."staff_note") <= 2000);--> statement-breakpoint
ALTER TABLE "commerce"."returns" ADD CONSTRAINT "returns_label_url" CHECK ("commerce"."returns"."label_url" is null or "commerce"."returns"."label_url" ~ '^https://');--> statement-breakpoint
ALTER TABLE "commerce"."returns" ADD CONSTRAINT "returns_outcome" CHECK ("commerce"."returns"."outcome" is null or "commerce"."returns"."outcome" in ('refunded', 'declined', 'no_refund', 'cancelled'));--> statement-breakpoint
ALTER TABLE "commerce"."returns" ADD CONSTRAINT "returns_amounts" CHECK ("commerce"."returns"."return_shipping_minor" >= 0 and "commerce"."returns"."refund_minor" >= 0 and "commerce"."returns"."refund_computed_minor" >= 0 and "commerce"."returns"."shipping_refund_minor" >= 0);--> statement-breakpoint
ALTER TABLE "commerce"."returns" ADD CONSTRAINT "returns_refund_recorded" CHECK (("commerce"."returns"."refund_minor" is null) = ("commerce"."returns"."refunded_at" is null));--> statement-breakpoint
ALTER TABLE "commerce"."returns" ADD CONSTRAINT "returns_refund_stripe" CHECK ("commerce"."returns"."refund_id" is null or ("commerce"."returns"."refund_minor" is not null and not "commerce"."returns"."refund_outside"));--> statement-breakpoint
ALTER TABLE "commerce"."returns" ADD CONSTRAINT "returns_refund_outside" CHECK (not "commerce"."returns"."refund_outside" or "commerce"."returns"."refund_minor" is not null);--> statement-breakpoint
ALTER TABLE "commerce"."returns" ADD CONSTRAINT "returns_times_in_order" CHECK (("commerce"."returns"."received_at" is null or "commerce"."returns"."approved_at" is null or "commerce"."returns"."received_at" >= "commerce"."returns"."approved_at")
        and ("commerce"."returns"."inspected_at" is null or "commerce"."returns"."received_at" is null or "commerce"."returns"."inspected_at" >= "commerce"."returns"."received_at")
        and ("commerce"."returns"."closed_at" is null or "commerce"."returns"."inspected_at" is null or "commerce"."returns"."closed_at" >= "commerce"."returns"."inspected_at")
        and ("commerce"."returns"."closed_at" is null or "commerce"."returns"."received_at" is null or "commerce"."returns"."closed_at" >= "commerce"."returns"."received_at")
        and ("commerce"."returns"."shipped_at" is null or "commerce"."returns"."received_at" is null or "commerce"."returns"."shipped_at" <= "commerce"."returns"."received_at"));--> statement-breakpoint
ALTER TABLE "commerce"."withdrawal_requests" ADD CONSTRAINT "withdrawal_requests_status" CHECK ("commerce"."withdrawal_requests"."status" in ('pending', 'confirmed', 'expired'));--> statement-breakpoint
ALTER TABLE "commerce"."withdrawal_requests" ADD CONSTRAINT "withdrawal_requests_confirmed" CHECK (("commerce"."withdrawal_requests"."status" = 'confirmed') = ("commerce"."withdrawal_requests"."confirmed_at" is not null));--> statement-breakpoint
ALTER TABLE "commerce"."withdrawal_requests" ADD CONSTRAINT "withdrawal_requests_confirm_after_submit" CHECK ("commerce"."withdrawal_requests"."confirmed_at" is null or "commerce"."withdrawal_requests"."confirmed_at" >= "commerce"."withdrawal_requests"."submitted_at");--> statement-breakpoint
ALTER TABLE "commerce"."withdrawal_requests" ADD CONSTRAINT "withdrawal_requests_ack_in_order" CHECK ("commerce"."withdrawal_requests"."acknowledged_at" is null or "commerce"."withdrawal_requests"."acknowledged_at" >= "commerce"."withdrawal_requests"."confirmed_at");--> statement-breakpoint
ALTER TABLE "commerce"."withdrawal_requests" ADD CONSTRAINT "withdrawal_requests_expires_after_submit" CHECK ("commerce"."withdrawal_requests"."expires_at" >= "commerce"."withdrawal_requests"."submitted_at");--> statement-breakpoint
ALTER TABLE "commerce"."withdrawal_attempts" ADD CONSTRAINT "withdrawal_attempts_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "withdrawal_attempts_key_idx" ON "commerce"."withdrawal_attempts" USING btree ("store_id","key_kind","key_hash","at");--> statement-breakpoint
CREATE INDEX "withdrawal_attempts_at_idx" ON "commerce"."withdrawal_attempts" USING btree ("at");--> statement-breakpoint
CREATE INDEX "orders_number_normalised_idx" ON "commerce"."orders" USING btree ("store_id",upper(regexp_replace("number", '\s', '', 'g')));--> statement-breakpoint
ALTER TABLE "commerce"."orders" ADD CONSTRAINT "orders_return_cost_payer" CHECK ("commerce"."orders"."return_cost_payer" is null or "commerce"."orders"."return_cost_payer" in ('shopper', 'store'));--> statement-breakpoint
ALTER TABLE "commerce"."orders" ADD CONSTRAINT "orders_standard_shipping" CHECK ("commerce"."orders"."standard_shipping_minor" is null or "commerce"."orders"."standard_shipping_minor" >= 0);