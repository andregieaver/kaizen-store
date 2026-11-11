CREATE TABLE "commerce"."bank_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"book_id" uuid NOT NULL,
	"statement_id" uuid NOT NULL,
	"ledger_account" integer NOT NULL,
	"line_key" text NOT NULL,
	"booked_on" date NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"text" text DEFAULT '' NOT NULL,
	"reference" text,
	"counterparty" text,
	"entry_id" uuid,
	"matched_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bank_lines_key" UNIQUE("book_id","ledger_account","line_key"),
	CONSTRAINT "bank_lines_amount" CHECK ("commerce"."bank_lines"."amount_minor" <> 0),
	CONSTRAINT "bank_lines_key_length" CHECK (char_length("commerce"."bank_lines"."line_key") between 1 and 200),
	CONSTRAINT "bank_lines_text" CHECK (char_length("commerce"."bank_lines"."text") <= 500),
	CONSTRAINT "bank_lines_reference" CHECK ("commerce"."bank_lines"."reference" is null or char_length("commerce"."bank_lines"."reference") between 1 and 140),
	CONSTRAINT "bank_lines_counterparty" CHECK ("commerce"."bank_lines"."counterparty" is null or char_length("commerce"."bank_lines"."counterparty") between 1 and 140),
	CONSTRAINT "bank_lines_matched" CHECK (("commerce"."bank_lines"."entry_id" is null) = ("commerce"."bank_lines"."matched_at" is null)),
	CONSTRAINT "bank_lines_account" CHECK ("commerce"."bank_lines"."ledger_account" between 1000 and 99999)
);
--> statement-breakpoint
CREATE TABLE "commerce"."bank_statements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"book_id" uuid NOT NULL,
	"ledger_account" integer DEFAULT 1920 NOT NULL,
	"file_name" text NOT NULL,
	"format" text NOT NULL,
	"account_ref" text,
	"currency" char(3) NOT NULL,
	"from_day" date NOT NULL,
	"to_day" date NOT NULL,
	"opening_minor" bigint,
	"closing_minor" bigint,
	"lines" integer NOT NULL,
	"new_lines" integer NOT NULL,
	"imported_by" uuid,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bank_statements_store_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "bank_statements_format" CHECK ("commerce"."bank_statements"."format" in ('camt053', 'csv')),
	CONSTRAINT "bank_statements_file_name" CHECK (char_length("commerce"."bank_statements"."file_name") between 1 and 200),
	CONSTRAINT "bank_statements_account_ref" CHECK ("commerce"."bank_statements"."account_ref" is null or char_length("commerce"."bank_statements"."account_ref") between 1 and 64),
	CONSTRAINT "bank_statements_days" CHECK ("commerce"."bank_statements"."from_day" <= "commerce"."bank_statements"."to_day"),
	CONSTRAINT "bank_statements_counts" CHECK ("commerce"."bank_statements"."lines" >= 0 and "commerce"."bank_statements"."new_lines" between 0 and "commerce"."bank_statements"."lines"),
	CONSTRAINT "bank_statements_account" CHECK ("commerce"."bank_statements"."ledger_account" between 1000 and 99999)
);
--> statement-breakpoint
ALTER TABLE "commerce"."bank_lines" ADD CONSTRAINT "bank_lines_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."bank_lines" ADD CONSTRAINT "bank_lines_book_fk" FOREIGN KEY ("store_id","book_id") REFERENCES "commerce"."ledger_books"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."bank_lines" ADD CONSTRAINT "bank_lines_statement_fk" FOREIGN KEY ("store_id","statement_id") REFERENCES "commerce"."bank_statements"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."bank_lines" ADD CONSTRAINT "bank_lines_entry_fk" FOREIGN KEY ("store_id","entry_id") REFERENCES "commerce"."ledger_entries"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."bank_statements" ADD CONSTRAINT "bank_statements_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."bank_statements" ADD CONSTRAINT "bank_statements_imported_by_accounts_id_fk" FOREIGN KEY ("imported_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."bank_statements" ADD CONSTRAINT "bank_statements_book_fk" FOREIGN KEY ("store_id","book_id") REFERENCES "commerce"."ledger_books"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bank_lines_entry_once" ON "commerce"."bank_lines" USING btree ("book_id","entry_id") WHERE "commerce"."bank_lines"."entry_id" is not null;--> statement-breakpoint
CREATE INDEX "bank_lines_store_book_idx" ON "commerce"."bank_lines" USING btree ("store_id","book_id");--> statement-breakpoint
CREATE INDEX "bank_lines_statement_idx" ON "commerce"."bank_lines" USING btree ("store_id","statement_id");--> statement-breakpoint
CREATE INDEX "bank_lines_store_entry_idx" ON "commerce"."bank_lines" USING btree ("store_id","entry_id");--> statement-breakpoint
CREATE INDEX "bank_statements_store_book_idx" ON "commerce"."bank_statements" USING btree ("store_id","book_id");--> statement-breakpoint
CREATE INDEX "bank_statements_imported_by_idx" ON "commerce"."bank_statements" USING btree ("imported_by");