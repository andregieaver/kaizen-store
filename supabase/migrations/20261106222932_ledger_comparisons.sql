CREATE TABLE "commerce"."ledger_comparisons" (
	"store_id" uuid NOT NULL,
	"book_id" uuid NOT NULL,
	"source_kind" text NOT NULL,
	"source_id" text NOT NULL,
	"state" text NOT NULL,
	"differences" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"their_id" bigint,
	"compared_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_comparisons_book_id_source_kind_source_id_pk" PRIMARY KEY("book_id","source_kind","source_id"),
	CONSTRAINT "ledger_comparisons_state" CHECK ("commerce"."ledger_comparisons"."state" in ('agrees', 'differs', 'missing')),
	CONSTRAINT "ledger_comparisons_source" CHECK ("commerce"."ledger_comparisons"."source_kind" ~ '^[a-z_]{1,40}$' and char_length("commerce"."ledger_comparisons"."source_id") between 1 and 80),
	CONSTRAINT "ledger_comparisons_differences" CHECK (jsonb_typeof("commerce"."ledger_comparisons"."differences") = 'array')
);
--> statement-breakpoint
ALTER TABLE "commerce"."ledger_comparisons" ADD CONSTRAINT "ledger_comparisons_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."ledger_comparisons" ADD CONSTRAINT "ledger_comparisons_book_fk" FOREIGN KEY ("store_id","book_id") REFERENCES "commerce"."ledger_books"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ledger_comparisons_store_book_idx" ON "commerce"."ledger_comparisons" USING btree ("store_id","book_id");