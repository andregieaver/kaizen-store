CREATE TABLE "commerce"."ledger_accounts" (
	"store_id" uuid NOT NULL,
	"book_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"name" text NOT NULL,
	"standard" text NOT NULL,
	"kind" text NOT NULL,
	"vat_code" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_accounts_book_id_number_pk" PRIMARY KEY("book_id","number"),
	CONSTRAINT "ledger_accounts_number" CHECK ("commerce"."ledger_accounts"."number" between 1000 and 99999 and "commerce"."ledger_accounts"."standard" ~ '^[0-9]{2,4}$'),
	CONSTRAINT "ledger_accounts_name" CHECK ("commerce"."ledger_accounts"."name" = btrim("commerce"."ledger_accounts"."name") and char_length("commerce"."ledger_accounts"."name") between 1 and 120),
	CONSTRAINT "ledger_accounts_kind" CHECK ("commerce"."ledger_accounts"."kind" in ('asset', 'liability', 'equity', 'income', 'expense')),
	CONSTRAINT "ledger_accounts_vat" CHECK ("commerce"."ledger_accounts"."vat_code" is null or "commerce"."ledger_accounts"."vat_code" ~ '^[0-9]{1,2}$')
);
--> statement-breakpoint
CREATE TABLE "commerce"."ledger_books" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"legal_name" text NOT NULL,
	"organisation_number" text DEFAULT '' NOT NULL,
	"country" char(2) NOT NULL,
	"currency" char(3) NOT NULL,
	"opened_on" date NOT NULL,
	"closed_on" date,
	"locked_through" date,
	"opened_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_books_store_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "ledger_books_country" CHECK ("commerce"."ledger_books"."country" ~ '^[A-Z]{2}$' and "commerce"."ledger_books"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "ledger_books_name" CHECK (char_length("commerce"."ledger_books"."legal_name") between 1 and 200 and char_length("commerce"."ledger_books"."organisation_number") <= 40),
	CONSTRAINT "ledger_books_closed" CHECK ("commerce"."ledger_books"."closed_on" is null or "commerce"."ledger_books"."closed_on" >= "commerce"."ledger_books"."opened_on")
);
--> statement-breakpoint
CREATE TABLE "commerce"."ledger_counters" (
	"store_id" uuid NOT NULL,
	"book_id" uuid NOT NULL,
	"series" text NOT NULL,
	"year" integer NOT NULL,
	"last" integer NOT NULL,
	CONSTRAINT "ledger_counters_book_id_series_year_pk" PRIMARY KEY("book_id","series","year"),
	CONSTRAINT "ledger_counters_last" CHECK ("commerce"."ledger_counters"."last" >= 1)
);
--> statement-breakpoint
CREATE TABLE "commerce"."ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"book_id" uuid NOT NULL,
	"series" text NOT NULL,
	"year" integer NOT NULL,
	"number" integer NOT NULL,
	"entry_date" date NOT NULL,
	"text" text NOT NULL,
	"source_kind" text,
	"source_id" text,
	"reverses" uuid,
	"posted_by" uuid,
	"posted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_entries_store_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "ledger_entries_number_key" UNIQUE("book_id","series","year","number"),
	CONSTRAINT "ledger_entries_series" CHECK ("commerce"."ledger_entries"."series" ~ '^[A-Z]{1,3}$' and "commerce"."ledger_entries"."number" >= 1 and "commerce"."ledger_entries"."year" = extract(year from "commerce"."ledger_entries"."entry_date")::int),
	CONSTRAINT "ledger_entries_text" CHECK ("commerce"."ledger_entries"."text" = btrim("commerce"."ledger_entries"."text") and char_length("commerce"."ledger_entries"."text") between 1 and 200),
	CONSTRAINT "ledger_entries_source" CHECK (("commerce"."ledger_entries"."source_kind" is null) = ("commerce"."ledger_entries"."source_id" is null) and ("commerce"."ledger_entries"."source_kind" is null or ("commerce"."ledger_entries"."source_kind" ~ '^[a-z_]{1,40}$' and char_length("commerce"."ledger_entries"."source_id") between 1 and 80)))
);
--> statement-breakpoint
CREATE TABLE "commerce"."ledger_lines" (
	"entry_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"book_id" uuid NOT NULL,
	"line" integer NOT NULL,
	"account" integer NOT NULL,
	"amount_minor" bigint NOT NULL,
	"vat_code" text,
	"text" text,
	CONSTRAINT "ledger_lines_entry_id_line_pk" PRIMARY KEY("entry_id","line"),
	CONSTRAINT "ledger_lines_amount" CHECK ("commerce"."ledger_lines"."amount_minor" <> 0 and abs("commerce"."ledger_lines"."amount_minor") <= 1000000000000000 and "commerce"."ledger_lines"."line" >= 1),
	CONSTRAINT "ledger_lines_vat" CHECK ("commerce"."ledger_lines"."vat_code" is null or "commerce"."ledger_lines"."vat_code" ~ '^[0-9]{1,2}$'),
	CONSTRAINT "ledger_lines_text" CHECK ("commerce"."ledger_lines"."text" is null or char_length("commerce"."ledger_lines"."text") between 1 and 200)
);
--> statement-breakpoint
ALTER TABLE "commerce"."ledger_accounts" ADD CONSTRAINT "ledger_accounts_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."ledger_accounts" ADD CONSTRAINT "ledger_accounts_book_fk" FOREIGN KEY ("store_id","book_id") REFERENCES "commerce"."ledger_books"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."ledger_books" ADD CONSTRAINT "ledger_books_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."ledger_books" ADD CONSTRAINT "ledger_books_opened_by_accounts_id_fk" FOREIGN KEY ("opened_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."ledger_counters" ADD CONSTRAINT "ledger_counters_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."ledger_counters" ADD CONSTRAINT "ledger_counters_book_fk" FOREIGN KEY ("store_id","book_id") REFERENCES "commerce"."ledger_books"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."ledger_entries" ADD CONSTRAINT "ledger_entries_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."ledger_entries" ADD CONSTRAINT "ledger_entries_posted_by_accounts_id_fk" FOREIGN KEY ("posted_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."ledger_entries" ADD CONSTRAINT "ledger_entries_book_fk" FOREIGN KEY ("store_id","book_id") REFERENCES "commerce"."ledger_books"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."ledger_entries" ADD CONSTRAINT "ledger_entries_reverses_fk" FOREIGN KEY ("reverses") REFERENCES "commerce"."ledger_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."ledger_lines" ADD CONSTRAINT "ledger_lines_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."ledger_lines" ADD CONSTRAINT "ledger_lines_entry_fk" FOREIGN KEY ("store_id","entry_id") REFERENCES "commerce"."ledger_entries"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."ledger_lines" ADD CONSTRAINT "ledger_lines_account_fk" FOREIGN KEY ("book_id","account") REFERENCES "commerce"."ledger_accounts"("book_id","number") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ledger_accounts_store_book_idx" ON "commerce"."ledger_accounts" USING btree ("store_id","book_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_books_open_key" ON "commerce"."ledger_books" USING btree ("store_id") WHERE "commerce"."ledger_books"."closed_on" is null;--> statement-breakpoint
CREATE INDEX "ledger_books_opened_by_idx" ON "commerce"."ledger_books" USING btree ("opened_by");--> statement-breakpoint
CREATE INDEX "ledger_counters_store_book_idx" ON "commerce"."ledger_counters" USING btree ("store_id","book_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_entries_reversed_once" ON "commerce"."ledger_entries" USING btree ("reverses") WHERE "commerce"."ledger_entries"."reverses" is not null;--> statement-breakpoint
CREATE INDEX "ledger_entries_store_book_idx" ON "commerce"."ledger_entries" USING btree ("store_id","book_id");--> statement-breakpoint
CREATE INDEX "ledger_entries_date_idx" ON "commerce"."ledger_entries" USING btree ("book_id","entry_date");--> statement-breakpoint
CREATE INDEX "ledger_entries_source_idx" ON "commerce"."ledger_entries" USING btree ("book_id","source_kind","source_id") WHERE "commerce"."ledger_entries"."source_kind" is not null;--> statement-breakpoint
CREATE INDEX "ledger_entries_posted_by_idx" ON "commerce"."ledger_entries" USING btree ("posted_by");--> statement-breakpoint
CREATE INDEX "ledger_lines_store_entry_idx" ON "commerce"."ledger_lines" USING btree ("store_id","entry_id");--> statement-breakpoint
CREATE INDEX "ledger_lines_account_idx" ON "commerce"."ledger_lines" USING btree ("book_id","account");