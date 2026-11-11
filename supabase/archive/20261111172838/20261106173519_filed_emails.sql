CREATE TABLE "commerce"."email_filing" (
	"store_id" uuid PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_filing_key_shape" CHECK ("commerce"."email_filing"."key" ~ '^[a-z0-9]{12,32}$')
);
--> statement-breakpoint
CREATE TABLE "commerce"."filed_emails" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"message_id" text,
	"subject" text,
	"from_address" text NOT NULL,
	"addresses" text[] NOT NULL,
	"customer_ids" uuid[] NOT NULL,
	"company_ids" uuid[] NOT NULL,
	"deal_ids" uuid[] NOT NULL,
	"body" text NOT NULL,
	"cut" boolean DEFAULT false NOT NULL,
	"filed_by" uuid,
	"sent_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "filed_emails_body" CHECK (char_length("commerce"."filed_emails"."body") between 1 and 20000),
	CONSTRAINT "filed_emails_people" CHECK (cardinality("commerce"."filed_emails"."addresses") between 1 and 200)
);
--> statement-breakpoint
ALTER TABLE "commerce"."support_inbound_emails" ADD COLUMN "purpose" text DEFAULT 'support' NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."email_filing" ADD CONSTRAINT "email_filing_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."filed_emails" ADD CONSTRAINT "filed_emails_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."filed_emails" ADD CONSTRAINT "filed_emails_filed_by_accounts_id_fk" FOREIGN KEY ("filed_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "email_filing_key" ON "commerce"."email_filing" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "filed_emails_message_key" ON "commerce"."filed_emails" USING btree ("store_id","message_id") WHERE "commerce"."filed_emails"."message_id" is not null;--> statement-breakpoint
CREATE INDEX "filed_emails_customers_idx" ON "commerce"."filed_emails" USING gin ("customer_ids");--> statement-breakpoint
CREATE INDEX "filed_emails_deals_idx" ON "commerce"."filed_emails" USING gin ("deal_ids");--> statement-breakpoint
CREATE INDEX "filed_emails_companies_idx" ON "commerce"."filed_emails" USING gin ("company_ids");--> statement-breakpoint
CREATE INDEX "filed_emails_addresses_idx" ON "commerce"."filed_emails" USING gin ("addresses");--> statement-breakpoint
CREATE INDEX "filed_emails_store_idx" ON "commerce"."filed_emails" USING btree ("store_id","created_at");--> statement-breakpoint
CREATE INDEX "filed_emails_filed_by_idx" ON "commerce"."filed_emails" USING btree ("filed_by");