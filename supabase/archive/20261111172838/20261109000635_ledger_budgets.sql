CREATE TABLE "commerce"."ledger_budgets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"book_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"account" integer NOT NULL,
	"months" bigint[] NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_budgets_year" CHECK ("commerce"."ledger_budgets"."year" between 2000 and 2100),
	CONSTRAINT "ledger_budgets_account" CHECK ("commerce"."ledger_budgets"."account" between 3000 and 8999),
	CONSTRAINT "ledger_budgets_months" CHECK (cardinality("commerce"."ledger_budgets"."months") = 12 and 0 <= all("commerce"."ledger_budgets"."months"))
);
--> statement-breakpoint
ALTER TABLE "commerce"."ledger_budgets" ADD CONSTRAINT "ledger_budgets_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."ledger_budgets" ADD CONSTRAINT "ledger_budgets_updated_by_accounts_id_fk" FOREIGN KEY ("updated_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."ledger_budgets" ADD CONSTRAINT "ledger_budgets_book_fk" FOREIGN KEY ("store_id","book_id") REFERENCES "commerce"."ledger_books"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_budgets_key" ON "commerce"."ledger_budgets" USING btree ("book_id","year","account");--> statement-breakpoint
CREATE INDEX "ledger_budgets_store_idx" ON "commerce"."ledger_budgets" USING btree ("store_id");--> statement-breakpoint
CREATE INDEX "ledger_budgets_updated_by_idx" ON "commerce"."ledger_budgets" USING btree ("updated_by");