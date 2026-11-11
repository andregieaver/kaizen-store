ALTER TABLE "commerce"."bank_lines" ADD CONSTRAINT "bank_lines_store_id_key" UNIQUE("store_id","id");--> statement-breakpoint
CREATE TABLE "commerce"."ledger_vouchers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"book_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"bank_line_id" uuid,
	"file_path" text NOT NULL,
	"file_name" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_vouchers_store_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "ledger_vouchers_file_path_key" UNIQUE("file_path"),
	CONSTRAINT "ledger_vouchers_content_type" CHECK ("commerce"."ledger_vouchers"."content_type" in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic')),
	CONSTRAINT "ledger_vouchers_file_name" CHECK (char_length("commerce"."ledger_vouchers"."file_name") between 1 and 200),
	CONSTRAINT "ledger_vouchers_size" CHECK ("commerce"."ledger_vouchers"."size_bytes" between 1 and 10485760),
	CONSTRAINT "ledger_vouchers_sha256" CHECK ("commerce"."ledger_vouchers"."sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "ledger_vouchers_path" CHECK ("commerce"."ledger_vouchers"."file_path" = "commerce"."ledger_vouchers"."store_id"::text || '/vouchers/' || "commerce"."ledger_vouchers"."id"::text || '.' || split_part("commerce"."ledger_vouchers"."file_path", '.', 2) and split_part("commerce"."ledger_vouchers"."file_path", '.', 2) in ('pdf', 'jpg', 'png', 'webp', 'heic'))
);
--> statement-breakpoint
ALTER TABLE "commerce"."ledger_vouchers" ADD CONSTRAINT "ledger_vouchers_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."ledger_vouchers" ADD CONSTRAINT "ledger_vouchers_uploaded_by_accounts_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."ledger_vouchers" ADD CONSTRAINT "ledger_vouchers_book_fk" FOREIGN KEY ("store_id","book_id") REFERENCES "commerce"."ledger_books"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."ledger_vouchers" ADD CONSTRAINT "ledger_vouchers_entry_fk" FOREIGN KEY ("store_id","entry_id") REFERENCES "commerce"."ledger_entries"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."ledger_vouchers" ADD CONSTRAINT "ledger_vouchers_bank_line_fk" FOREIGN KEY ("store_id","bank_line_id") REFERENCES "commerce"."bank_lines"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ledger_vouchers_entry_idx" ON "commerce"."ledger_vouchers" USING btree ("store_id","entry_id");--> statement-breakpoint
CREATE INDEX "ledger_vouchers_book_idx" ON "commerce"."ledger_vouchers" USING btree ("store_id","book_id");--> statement-breakpoint
CREATE INDEX "ledger_vouchers_bank_line_idx" ON "commerce"."ledger_vouchers" USING btree ("store_id","bank_line_id");--> statement-breakpoint
CREATE INDEX "ledger_vouchers_uploaded_by_idx" ON "commerce"."ledger_vouchers" USING btree ("uploaded_by");
