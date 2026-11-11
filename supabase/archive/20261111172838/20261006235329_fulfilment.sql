CREATE TABLE "commerce"."order_edit_lines" (
	"store_id" uuid NOT NULL,
	"order_edit_id" uuid NOT NULL,
	"n" integer NOT NULL,
	"kind" text NOT NULL,
	"order_line_id" uuid,
	"variant_id" uuid,
	"sku" text NOT NULL,
	"title" text NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price_minor" bigint NOT NULL,
	"list_price_minor" bigint,
	"total_minor" bigint NOT NULL,
	"discount_minor" bigint NOT NULL,
	"tax_minor" bigint NOT NULL,
	"tax_rate" numeric(6, 4) NOT NULL,
	"parts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"before" jsonb,
	"backorder_quantity" integer DEFAULT 0 NOT NULL,
	"backorder_days" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_edit_lines_order_edit_id_n_pk" PRIMARY KEY("order_edit_id","n"),
	CONSTRAINT "order_edit_lines_n" CHECK ("commerce"."order_edit_lines"."n" >= 1),
	CONSTRAINT "order_edit_lines_kind" CHECK ("commerce"."order_edit_lines"."kind" in ('add', 'remove', 'reduce')),
	CONSTRAINT "order_edit_lines_quantity" CHECK ("commerce"."order_edit_lines"."quantity" > 0),
	CONSTRAINT "order_edit_lines_amounts" CHECK ("commerce"."order_edit_lines"."unit_price_minor" >= 0 and "commerce"."order_edit_lines"."discount_minor" >= 0 and "commerce"."order_edit_lines"."total_minor" >= 0 and "commerce"."order_edit_lines"."tax_minor" >= 0 and "commerce"."order_edit_lines"."tax_minor" <= "commerce"."order_edit_lines"."total_minor"
        and "commerce"."order_edit_lines"."total_minor" = "commerce"."order_edit_lines"."unit_price_minor" * "commerce"."order_edit_lines"."quantity" - "commerce"."order_edit_lines"."discount_minor" and ("commerce"."order_edit_lines"."list_price_minor" is null or "commerce"."order_edit_lines"."list_price_minor" >= 0)),
	CONSTRAINT "order_edit_lines_rate" CHECK ("commerce"."order_edit_lines"."tax_rate" >= 0 and "commerce"."order_edit_lines"."tax_rate" < 1),
	CONSTRAINT "order_edit_lines_parts" CHECK (jsonb_typeof("commerce"."order_edit_lines"."parts") = 'object'),
	CONSTRAINT "order_edit_lines_shape" CHECK (("commerce"."order_edit_lines"."kind" = 'add' and "commerce"."order_edit_lines"."before" is null and "commerce"."order_edit_lines"."discount_minor" = 0 and "commerce"."order_edit_lines"."variant_id" is not null)
        or ("commerce"."order_edit_lines"."kind" in ('remove', 'reduce') and "commerce"."order_edit_lines"."before" is not null and jsonb_typeof("commerce"."order_edit_lines"."before") = 'object' and "commerce"."order_edit_lines"."order_line_id" is not null
            and "commerce"."order_edit_lines"."backorder_quantity" = 0 and "commerce"."order_edit_lines"."backorder_days" is null)),
	CONSTRAINT "order_edit_lines_backorder" CHECK ("commerce"."order_edit_lines"."backorder_quantity" between 0 and "commerce"."order_edit_lines"."quantity" and ("commerce"."order_edit_lines"."backorder_days" is null or "commerce"."order_edit_lines"."backorder_days" between 1 and 90)
        and ("commerce"."order_edit_lines"."backorder_quantity" = 0 or "commerce"."order_edit_lines"."backorder_days" is not null))
);
--> statement-breakpoint
CREATE TABLE "commerce"."order_edits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"status" text NOT NULL,
	"reason" text NOT NULL,
	"notify" boolean NOT NULL,
	"restock" boolean NOT NULL,
	"currency" char(3) NOT NULL,
	"base" jsonb NOT NULL,
	"total_before" bigint NOT NULL,
	"total_after" bigint NOT NULL,
	"subtotal_delta" bigint NOT NULL,
	"shipping_before" bigint NOT NULL,
	"shipping_after" bigint NOT NULL,
	"discount_delta" bigint NOT NULL,
	"tax_delta" bigint NOT NULL,
	"difference_minor" bigint NOT NULL,
	"payment_id" uuid,
	"refund_id" uuid,
	"pay_token_hash" text,
	"expires_at" timestamp with time zone,
	"made_by" uuid NOT NULL,
	"documents" text DEFAULT 'none' NOT NULL,
	"applied_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_edits_store_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "order_edits_order_seq_key" UNIQUE("store_id","order_id","seq"),
	CONSTRAINT "order_edits_seq" CHECK ("commerce"."order_edits"."seq" >= 1),
	CONSTRAINT "order_edits_status" CHECK ("commerce"."order_edits"."status" in ('awaiting_payment', 'applied', 'cancelled', 'expired')),
	CONSTRAINT "order_edits_reason" CHECK ("commerce"."order_edits"."reason" in ('customer_request', 'out_of_stock', 'store_error', 'other')),
	CONSTRAINT "order_edits_documents" CHECK ("commerce"."order_edits"."documents" in ('none', 'issued', 'waiting', 'not_invoiced', 'in_original')),
	CONSTRAINT "order_edits_base" CHECK (jsonb_typeof("commerce"."order_edits"."base") = 'object'),
	CONSTRAINT "order_edits_amounts" CHECK ("commerce"."order_edits"."total_before" >= 0 and "commerce"."order_edits"."total_after" >= 0 and "commerce"."order_edits"."shipping_before" >= 0 and "commerce"."order_edits"."shipping_after" >= 0 and "commerce"."order_edits"."difference_minor" = "commerce"."order_edits"."total_after" - "commerce"."order_edits"."total_before"),
	CONSTRAINT "order_edits_token" CHECK ("commerce"."order_edits"."pay_token_hash" is null or "commerce"."order_edits"."pay_token_hash" ~ '^[A-Za-z0-9_-]{43}$'),
	CONSTRAINT "order_edits_lifecycle" CHECK (("commerce"."order_edits"."status" = 'awaiting_payment' and "commerce"."order_edits"."difference_minor" > 0 and "commerce"."order_edits"."pay_token_hash" is not null and "commerce"."order_edits"."expires_at" is not null
            and "commerce"."order_edits"."applied_at" is null and "commerce"."order_edits"."ended_at" is null and "commerce"."order_edits"."payment_id" is null and "commerce"."order_edits"."refund_id" is null and "commerce"."order_edits"."documents" = 'none')
        or ("commerce"."order_edits"."status" = 'applied' and "commerce"."order_edits"."applied_at" is not null and "commerce"."order_edits"."ended_at" is null)
        or ("commerce"."order_edits"."status" in ('cancelled', 'expired') and "commerce"."order_edits"."difference_minor" > 0 and "commerce"."order_edits"."pay_token_hash" is not null and "commerce"."order_edits"."ended_at" is not null
            and "commerce"."order_edits"."applied_at" is null and "commerce"."order_edits"."payment_id" is null and "commerce"."order_edits"."refund_id" is null and "commerce"."order_edits"."documents" = 'none')),
	CONSTRAINT "order_edits_money" CHECK (("commerce"."order_edits"."difference_minor" >= 0 or "commerce"."order_edits"."payment_id" is null) and ("commerce"."order_edits"."difference_minor" <= 0 or "commerce"."order_edits"."refund_id" is null))
);
--> statement-breakpoint
CREATE TABLE "commerce"."shipment_lines" (
	"store_id" uuid NOT NULL,
	"shipment_id" uuid NOT NULL,
	"order_line_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shipment_lines_shipment_id_order_line_id_pk" PRIMARY KEY("shipment_id","order_line_id"),
	CONSTRAINT "shipment_lines_quantity" CHECK ("commerce"."shipment_lines"."quantity" > 0)
);
--> statement-breakpoint
ALTER TABLE "commerce"."invoices" DROP CONSTRAINT "invoices_order_key";--> statement-breakpoint
ALTER TABLE "commerce"."credit_notes" DROP CONSTRAINT "credit_notes_source";--> statement-breakpoint
ALTER TABLE "commerce"."credit_notes" DROP CONSTRAINT "credit_notes_source_ref";--> statement-breakpoint
ALTER TABLE "commerce"."inventory_movements" DROP CONSTRAINT "inventory_movements_source";--> statement-breakpoint
ALTER TABLE "commerce"."invoices" DROP CONSTRAINT "invoices_kind";--> statement-breakpoint
ALTER TABLE "commerce"."credit_notes" ADD COLUMN "order_edit_id" uuid;--> statement-breakpoint
ALTER TABLE "commerce"."inventory_reservations" ADD COLUMN "order_edit_id" uuid;--> statement-breakpoint
ALTER TABLE "commerce"."invoices" ADD COLUMN "order_edit_id" uuid;--> statement-breakpoint
ALTER TABLE "commerce"."order_lines" ADD COLUMN "order_edit_id" uuid;--> statement-breakpoint
ALTER TABLE "commerce"."orders" ADD COLUMN "edited_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "commerce"."payments" ADD COLUMN "order_edit_id" uuid;--> statement-breakpoint
ALTER TABLE "commerce"."refunds" ADD COLUMN "order_edit_id" uuid;--> statement-breakpoint
ALTER TABLE "commerce"."shipments" ADD COLUMN "legacy" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Moved up by hand from the end of the generated file: the parcel lines' foreign key needs this key to exist first.
ALTER TABLE "commerce"."shipments" ADD CONSTRAINT "shipments_store_id_key" UNIQUE("store_id","id");--> statement-breakpoint
ALTER TABLE "commerce"."order_edit_lines" ADD CONSTRAINT "order_edit_lines_edit_fk" FOREIGN KEY ("store_id","order_edit_id") REFERENCES "commerce"."order_edits"("store_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."order_edit_lines" ADD CONSTRAINT "order_edit_lines_variant_fk" FOREIGN KEY ("store_id","variant_id") REFERENCES "commerce"."product_variants"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."order_edits" ADD CONSTRAINT "order_edits_made_by_accounts_id_fk" FOREIGN KEY ("made_by") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."order_edits" ADD CONSTRAINT "order_edits_order_fk" FOREIGN KEY ("store_id","order_id") REFERENCES "commerce"."orders"("store_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."order_edits" ADD CONSTRAINT "order_edits_payment_fk" FOREIGN KEY ("store_id","payment_id") REFERENCES "commerce"."payments"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."order_edits" ADD CONSTRAINT "order_edits_refund_fk" FOREIGN KEY ("store_id","refund_id") REFERENCES "commerce"."refunds"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."shipment_lines" ADD CONSTRAINT "shipment_lines_shipment_fk" FOREIGN KEY ("store_id","shipment_id") REFERENCES "commerce"."shipments"("store_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."shipment_lines" ADD CONSTRAINT "shipment_lines_order_line_fk" FOREIGN KEY ("store_id","order_line_id") REFERENCES "commerce"."order_lines"("store_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_edit_lines_variant_idx" ON "commerce"."order_edit_lines" USING btree ("store_id","variant_id");--> statement-breakpoint
CREATE INDEX "order_edit_lines_order_line_idx" ON "commerce"."order_edit_lines" USING btree ("store_id","order_line_id") WHERE "commerce"."order_edit_lines"."order_line_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "order_edits_awaiting_key" ON "commerce"."order_edits" USING btree ("store_id","order_id") WHERE "commerce"."order_edits"."status" = 'awaiting_payment';--> statement-breakpoint
CREATE INDEX "order_edits_expiry_idx" ON "commerce"."order_edits" USING btree ("store_id","status","expires_at") WHERE "commerce"."order_edits"."status" = 'awaiting_payment';--> statement-breakpoint
CREATE INDEX "order_edits_order_idx" ON "commerce"."order_edits" USING btree ("store_id","order_id");--> statement-breakpoint
CREATE INDEX "order_edits_payment_idx" ON "commerce"."order_edits" USING btree ("store_id","payment_id");--> statement-breakpoint
CREATE INDEX "order_edits_refund_idx" ON "commerce"."order_edits" USING btree ("store_id","refund_id");--> statement-breakpoint
CREATE INDEX "order_edits_made_by_idx" ON "commerce"."order_edits" USING btree ("made_by");--> statement-breakpoint
CREATE UNIQUE INDEX "order_edits_token_key" ON "commerce"."order_edits" USING btree ("pay_token_hash") WHERE "commerce"."order_edits"."pay_token_hash" is not null;--> statement-breakpoint
CREATE INDEX "shipment_lines_order_line_idx" ON "commerce"."shipment_lines" USING btree ("store_id","order_line_id");--> statement-breakpoint
CREATE INDEX "shipment_lines_shipment_idx" ON "commerce"."shipment_lines" USING btree ("store_id","shipment_id");--> statement-breakpoint
ALTER TABLE "commerce"."credit_notes" ADD CONSTRAINT "credit_notes_order_edit_fk" FOREIGN KEY ("store_id","order_edit_id") REFERENCES "commerce"."order_edits"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."inventory_reservations" ADD CONSTRAINT "inventory_reservations_order_edit_fk" FOREIGN KEY ("store_id","order_edit_id") REFERENCES "commerce"."order_edits"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."invoices" ADD CONSTRAINT "invoices_order_edit_fk" FOREIGN KEY ("store_id","order_edit_id") REFERENCES "commerce"."order_edits"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."order_lines" ADD CONSTRAINT "order_lines_order_edit_fk" FOREIGN KEY ("store_id","order_edit_id") REFERENCES "commerce"."order_edits"("store_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."payments" ADD CONSTRAINT "payments_order_edit_fk" FOREIGN KEY ("store_id","order_edit_id") REFERENCES "commerce"."order_edits"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."refunds" ADD CONSTRAINT "refunds_order_edit_fk" FOREIGN KEY ("store_id","order_edit_id") REFERENCES "commerce"."order_edits"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "credit_notes_order_edit_key" ON "commerce"."credit_notes" USING btree ("store_id","order_edit_id") WHERE "commerce"."credit_notes"."source" = 'order_edit';--> statement-breakpoint
CREATE INDEX "inventory_reservations_order_edit_idx" ON "commerce"."inventory_reservations" USING btree ("store_id","order_edit_id") WHERE "commerce"."inventory_reservations"."order_edit_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_original_key" ON "commerce"."invoices" USING btree ("store_id","order_id") WHERE "commerce"."invoices"."kind" = 'order';--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_order_edit_key" ON "commerce"."invoices" USING btree ("store_id","order_edit_id") WHERE "commerce"."invoices"."kind" = 'order_edit';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoices_order_idx" ON "commerce"."invoices" USING btree ("store_id","order_id");--> statement-breakpoint
CREATE INDEX "order_lines_order_edit_idx" ON "commerce"."order_lines" USING btree ("store_id","order_edit_id") WHERE "commerce"."order_lines"."order_edit_id" is not null;--> statement-breakpoint
CREATE INDEX "payments_order_edit_idx" ON "commerce"."payments" USING btree ("store_id","order_edit_id") WHERE "commerce"."payments"."order_edit_id" is not null;--> statement-breakpoint
CREATE INDEX "refunds_order_edit_idx" ON "commerce"."refunds" USING btree ("store_id","order_edit_id") WHERE "commerce"."refunds"."order_edit_id" is not null;--> statement-breakpoint
ALTER TABLE "commerce"."credit_notes" ADD CONSTRAINT "credit_notes_source" CHECK ("commerce"."credit_notes"."source" in ('refund', 'return_outside', 'order_edit'));--> statement-breakpoint
ALTER TABLE "commerce"."credit_notes" ADD CONSTRAINT "credit_notes_source_ref" CHECK (("commerce"."credit_notes"."source" = 'refund' and "commerce"."credit_notes"."refund_id" is not null and "commerce"."credit_notes"."return_id" is null and "commerce"."credit_notes"."order_edit_id" is null)
        or ("commerce"."credit_notes"."source" = 'return_outside' and "commerce"."credit_notes"."return_id" is not null and "commerce"."credit_notes"."refund_id" is null and "commerce"."credit_notes"."order_edit_id" is null)
        or ("commerce"."credit_notes"."source" = 'order_edit' and "commerce"."credit_notes"."order_edit_id" is not null and "commerce"."credit_notes"."refund_id" is null and "commerce"."credit_notes"."return_id" is null));--> statement-breakpoint
ALTER TABLE "commerce"."inventory_movements" ADD CONSTRAINT "inventory_movements_source" CHECK ("commerce"."inventory_movements"."source" in ('inventory_page', 'editor', 'bulk', 'file', 'order', 'return', 'checkout', 'ai_manager', 'copy', 'system', 'order_edit'));--> statement-breakpoint
ALTER TABLE "commerce"."inventory_reservations" ADD CONSTRAINT "inventory_reservations_order_edit" CHECK ("commerce"."inventory_reservations"."order_edit_id" is null or "commerce"."inventory_reservations"."order_id" is not null);--> statement-breakpoint
ALTER TABLE "commerce"."invoices" ADD CONSTRAINT "invoices_kind" CHECK ("commerce"."invoices"."kind" in ('order', 'order_edit') and ("commerce"."invoices"."kind" = 'order_edit') = ("commerce"."invoices"."order_edit_id" is not null));