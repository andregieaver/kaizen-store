CREATE TABLE "commerce"."books_email" (
	"store_id" uuid PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "books_email_key_shape" CHECK ("commerce"."books_email"."key" ~ '^[a-z0-9]{12,32}$')
);
--> statement-breakpoint
CREATE TABLE "commerce"."books_inbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"provider_id" text NOT NULL,
	"from_address" text NOT NULL,
	"subject" text,
	"received_at" timestamp with time zone NOT NULL,
	"file_path" text NOT NULL,
	"file_name" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"status" text DEFAULT 'waiting' NOT NULL,
	"entry_id" uuid,
	"decided_at" timestamp with time zone,
	"decided_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "books_inbox_store_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "books_inbox_status" CHECK ("commerce"."books_inbox"."status" in ('waiting', 'used', 'dismissed')),
	CONSTRAINT "books_inbox_used" CHECK (("commerce"."books_inbox"."status" = 'used') = ("commerce"."books_inbox"."entry_id" is not null)),
	CONSTRAINT "books_inbox_lengths" CHECK (length("commerce"."books_inbox"."provider_id") between 1 and 200 and length("commerce"."books_inbox"."from_address") between 1 and 320 and coalesce(length("commerce"."books_inbox"."subject") <= 200, true) and length("commerce"."books_inbox"."file_name") between 1 and 200 and "commerce"."books_inbox"."size_bytes" > 0 and "commerce"."books_inbox"."sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "commerce"."books_email" ADD CONSTRAINT "books_email_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."books_inbox" ADD CONSTRAINT "books_inbox_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."books_inbox" ADD CONSTRAINT "books_inbox_decided_by_accounts_id_fk" FOREIGN KEY ("decided_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."books_inbox" ADD CONSTRAINT "books_inbox_entry_fk" FOREIGN KEY ("store_id","entry_id") REFERENCES "commerce"."ledger_entries"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "books_email_key" ON "commerce"."books_email" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "books_inbox_file_key" ON "commerce"."books_inbox" USING btree ("store_id","sha256");--> statement-breakpoint
CREATE INDEX "books_inbox_waiting_idx" ON "commerce"."books_inbox" USING btree ("store_id","received_at") WHERE "commerce"."books_inbox"."status" = 'waiting';--> statement-breakpoint
CREATE INDEX "books_inbox_entry_idx" ON "commerce"."books_inbox" USING btree ("store_id","entry_id");--> statement-breakpoint
CREATE INDEX "books_inbox_decided_by_idx" ON "commerce"."books_inbox" USING btree ("decided_by");