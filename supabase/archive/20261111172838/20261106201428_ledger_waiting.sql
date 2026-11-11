CREATE TABLE "commerce"."ledger_waiting" (
	"store_id" uuid NOT NULL,
	"book_id" uuid NOT NULL,
	"source_kind" text NOT NULL,
	"source_id" text NOT NULL,
	"problem" text NOT NULL,
	"since" timestamp with time zone DEFAULT now() NOT NULL,
	"tried_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_waiting_book_id_source_kind_source_id_pk" PRIMARY KEY("book_id","source_kind","source_id"),
	CONSTRAINT "ledger_waiting_source" CHECK ("commerce"."ledger_waiting"."source_kind" ~ '^[a-z_]{1,40}$' and char_length("commerce"."ledger_waiting"."source_id") between 1 and 80),
	CONSTRAINT "ledger_waiting_problem" CHECK ("commerce"."ledger_waiting"."problem" ~ '^[a-z_]{1,40}$')
);
--> statement-breakpoint
ALTER TABLE "commerce"."ledger_waiting" ADD CONSTRAINT "ledger_waiting_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."ledger_waiting" ADD CONSTRAINT "ledger_waiting_book_fk" FOREIGN KEY ("store_id","book_id") REFERENCES "commerce"."ledger_books"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ledger_waiting_store_book_idx" ON "commerce"."ledger_waiting" USING btree ("store_id","book_id");