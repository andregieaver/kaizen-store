CREATE TABLE "commerce"."supplier_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"book_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"number" text,
	"issued_on" date NOT NULL,
	"due_on" date,
	"total_minor" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"kind" text NOT NULL,
	"vat_rate" integer NOT NULL,
	"text" text NOT NULL,
	"entry_id" uuid NOT NULL,
	"paid_entry_id" uuid,
	"paid_on" date,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_invoices_store_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "supplier_invoices_number" CHECK ("commerce"."supplier_invoices"."number" is null or char_length(trim("commerce"."supplier_invoices"."number")) between 1 and 60),
	CONSTRAINT "supplier_invoices_total" CHECK ("commerce"."supplier_invoices"."total_minor" > 0),
	CONSTRAINT "supplier_invoices_days" CHECK ("commerce"."supplier_invoices"."due_on" is null or "commerce"."supplier_invoices"."due_on" >= "commerce"."supplier_invoices"."issued_on"),
	CONSTRAINT "supplier_invoices_kind" CHECK ("commerce"."supplier_invoices"."kind" ~ '^[a-z_]{2,30}$'),
	CONSTRAINT "supplier_invoices_vat_rate" CHECK ("commerce"."supplier_invoices"."vat_rate" in (0, 12, 15, 25)),
	CONSTRAINT "supplier_invoices_text" CHECK (char_length("commerce"."supplier_invoices"."text") between 1 and 200),
	CONSTRAINT "supplier_invoices_paid" CHECK (("commerce"."supplier_invoices"."paid_entry_id" is null) = ("commerce"."supplier_invoices"."paid_on" is null))
);
--> statement-breakpoint
CREATE TABLE "commerce"."suppliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"name" text NOT NULL,
	"organisation_number" text,
	"usual_kind" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "suppliers_store_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "suppliers_name" CHECK (char_length(trim("commerce"."suppliers"."name")) between 1 and 120),
	CONSTRAINT "suppliers_organisation_number" CHECK ("commerce"."suppliers"."organisation_number" is null or "commerce"."suppliers"."organisation_number" ~ '^[0-9A-Za-z -]{4,30}$'),
	CONSTRAINT "suppliers_usual_kind" CHECK ("commerce"."suppliers"."usual_kind" is null or "commerce"."suppliers"."usual_kind" ~ '^[a-z_]{2,30}$')
);
--> statement-breakpoint
ALTER TABLE "commerce"."supplier_invoices" ADD CONSTRAINT "supplier_invoices_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."supplier_invoices" ADD CONSTRAINT "supplier_invoices_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."supplier_invoices" ADD CONSTRAINT "supplier_invoices_book_fk" FOREIGN KEY ("store_id","book_id") REFERENCES "commerce"."ledger_books"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."supplier_invoices" ADD CONSTRAINT "supplier_invoices_supplier_fk" FOREIGN KEY ("store_id","supplier_id") REFERENCES "commerce"."suppliers"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."supplier_invoices" ADD CONSTRAINT "supplier_invoices_entry_fk" FOREIGN KEY ("store_id","entry_id") REFERENCES "commerce"."ledger_entries"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."supplier_invoices" ADD CONSTRAINT "supplier_invoices_paid_entry_fk" FOREIGN KEY ("store_id","paid_entry_id") REFERENCES "commerce"."ledger_entries"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."suppliers" ADD CONSTRAINT "suppliers_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_invoices_number_key" ON "commerce"."supplier_invoices" USING btree ("store_id","supplier_id","number") WHERE "commerce"."supplier_invoices"."number" is not null;--> statement-breakpoint
CREATE INDEX "supplier_invoices_store_book_idx" ON "commerce"."supplier_invoices" USING btree ("store_id","book_id");--> statement-breakpoint
CREATE INDEX "supplier_invoices_supplier_idx" ON "commerce"."supplier_invoices" USING btree ("store_id","supplier_id");--> statement-breakpoint
CREATE INDEX "supplier_invoices_entry_idx" ON "commerce"."supplier_invoices" USING btree ("store_id","entry_id");--> statement-breakpoint
CREATE INDEX "supplier_invoices_paid_entry_idx" ON "commerce"."supplier_invoices" USING btree ("store_id","paid_entry_id");--> statement-breakpoint
CREATE INDEX "supplier_invoices_created_by_idx" ON "commerce"."supplier_invoices" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "supplier_invoices_unpaid_idx" ON "commerce"."supplier_invoices" USING btree ("store_id","due_on") WHERE "commerce"."supplier_invoices"."paid_entry_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "suppliers_store_name_key" ON "commerce"."suppliers" USING btree ("store_id",lower("name"));