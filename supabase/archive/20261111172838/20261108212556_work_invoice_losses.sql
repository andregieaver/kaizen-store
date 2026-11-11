CREATE TABLE "commerce"."work_invoice_losses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"written_off_on" date NOT NULL,
	"reason" text,
	"reverses" uuid,
	"recorded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_invoice_losses_store_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "work_invoice_losses_amount" CHECK ("commerce"."work_invoice_losses"."amount_minor" <> 0 and ("commerce"."work_invoice_losses"."reverses" is null) = ("commerce"."work_invoice_losses"."amount_minor" > 0)),
	CONSTRAINT "work_invoice_losses_currency" CHECK ("commerce"."work_invoice_losses"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "work_invoice_losses_reason" CHECK (length(coalesce("commerce"."work_invoice_losses"."reason", '')) <= 500)
);
--> statement-breakpoint
ALTER TABLE "commerce"."work_invoices" DROP CONSTRAINT "work_invoices_status";--> statement-breakpoint
ALTER TABLE "commerce"."work_invoice_losses" ADD CONSTRAINT "work_invoice_losses_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."work_invoice_losses" ADD CONSTRAINT "work_invoice_losses_recorded_by_accounts_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."work_invoice_losses" ADD CONSTRAINT "work_invoice_losses_invoice_fk" FOREIGN KEY ("store_id","invoice_id") REFERENCES "commerce"."work_invoices"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."work_invoice_losses" ADD CONSTRAINT "work_invoice_losses_reverses_fk" FOREIGN KEY ("store_id","reverses") REFERENCES "commerce"."work_invoice_losses"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "work_invoice_losses_invoice_idx" ON "commerce"."work_invoice_losses" USING btree ("store_id","invoice_id","written_off_on");--> statement-breakpoint
CREATE INDEX "work_invoice_losses_recorded_by_idx" ON "commerce"."work_invoice_losses" USING btree ("recorded_by");--> statement-breakpoint
CREATE UNIQUE INDEX "work_invoice_losses_reverses_idx" ON "commerce"."work_invoice_losses" USING btree ("store_id","reverses") WHERE "commerce"."work_invoice_losses"."reverses" is not null;--> statement-breakpoint
ALTER TABLE "commerce"."work_invoices" ADD CONSTRAINT "work_invoices_status" CHECK ("commerce"."work_invoices"."status" in ('draft', 'sent', 'paid', 'void', 'lost'));