CREATE TABLE "commerce"."platform_do_not_contact" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"hash" text NOT NULL,
	"reason" text NOT NULL,
	"store_id" uuid,
	"account_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_do_not_contact_kind" CHECK ("commerce"."platform_do_not_contact"."kind" in ('address', 'domain') and "commerce"."platform_do_not_contact"."hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "platform_do_not_contact_reason" CHECK ("commerce"."platform_do_not_contact"."reason" in ('reply', 'link', 'complaint', 'asked'))
);
--> statement-breakpoint
ALTER TABLE "commerce"."platform_do_not_contact" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "commerce"."platform_do_not_contact" ADD CONSTRAINT "platform_do_not_contact_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."platform_do_not_contact" ADD CONSTRAINT "platform_do_not_contact_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "platform_do_not_contact_hash_idx" ON "commerce"."platform_do_not_contact" USING btree ("kind","hash");--> statement-breakpoint
CREATE INDEX "platform_do_not_contact_store_idx" ON "commerce"."platform_do_not_contact" USING btree ("store_id");--> statement-breakpoint
CREATE INDEX "platform_do_not_contact_account_idx" ON "commerce"."platform_do_not_contact" USING btree ("account_id");