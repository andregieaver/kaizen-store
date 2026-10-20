CREATE TABLE "commerce"."marketing_consent_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "commerce"."marketing_consent_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"store_id" uuid NOT NULL,
	"subscriber_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"source" text NOT NULL,
	"consent_text" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "marketing_consent_events_kind" CHECK ("commerce"."marketing_consent_events"."kind" in ('requested', 'subscribed', 'unsubscribed'))
);
--> statement-breakpoint
CREATE TABLE "commerce"."marketing_subscribers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"email" text NOT NULL,
	"customer_id" uuid,
	"name" text DEFAULT '' NOT NULL,
	"locale" text NOT NULL,
	"market_code" text,
	"status" text NOT NULL,
	"source" text NOT NULL,
	"source_ref" text,
	"consent_text" text NOT NULL,
	"consented_at" timestamp with time zone NOT NULL,
	"confirmed_at" timestamp with time zone,
	"confirm_hash" text,
	"confirm_until" timestamp with time zone,
	"token" text NOT NULL,
	"unsubscribed_at" timestamp with time zone,
	"unsubscribe_source" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "marketing_subscribers_store_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "marketing_subscribers_status" CHECK ("commerce"."marketing_subscribers"."status" in ('pending', 'subscribed', 'unsubscribed')),
	CONSTRAINT "marketing_subscribers_source" CHECK ("commerce"."marketing_subscribers"."source" in ('form', 'checkout', 'account')),
	CONSTRAINT "marketing_subscribers_unsubscribe_source" CHECK ("commerce"."marketing_subscribers"."unsubscribe_source" is null or "commerce"."marketing_subscribers"."unsubscribe_source" in ('link', 'one_click', 'account', 'staff', 'complaint', 'bounce')),
	CONSTRAINT "marketing_subscribers_email" CHECK ("commerce"."marketing_subscribers"."email" = lower("commerce"."marketing_subscribers"."email") and char_length("commerce"."marketing_subscribers"."email") between 3 and 254 and position('@' in "commerce"."marketing_subscribers"."email") > 1),
	CONSTRAINT "marketing_subscribers_token" CHECK ("commerce"."marketing_subscribers"."token" ~ '^[A-Za-z0-9_-]{43}$'),
	CONSTRAINT "marketing_subscribers_confirm" CHECK ("commerce"."marketing_subscribers"."confirm_hash" is null or "commerce"."marketing_subscribers"."confirm_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "marketing_subscribers_texts" CHECK (char_length("commerce"."marketing_subscribers"."consent_text") between 1 and 1000 and char_length("commerce"."marketing_subscribers"."name") <= 200 and char_length("commerce"."marketing_subscribers"."locale") <= 20)
);
--> statement-breakpoint
ALTER TABLE "commerce"."marketing_consent_events" ADD CONSTRAINT "marketing_consent_events_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."marketing_consent_events" ADD CONSTRAINT "marketing_consent_events_subscriber_fk" FOREIGN KEY ("store_id","subscriber_id") REFERENCES "commerce"."marketing_subscribers"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."marketing_subscribers" ADD CONSTRAINT "marketing_subscribers_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."marketing_subscribers" ADD CONSTRAINT "marketing_subscribers_customer_fk" FOREIGN KEY ("store_id","customer_id") REFERENCES "commerce"."customers"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "marketing_consent_events_subscriber_idx" ON "commerce"."marketing_consent_events" USING btree ("store_id","subscriber_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "marketing_subscribers_email_idx" ON "commerce"."marketing_subscribers" USING btree ("store_id",lower("email"));--> statement-breakpoint
CREATE UNIQUE INDEX "marketing_subscribers_token_idx" ON "commerce"."marketing_subscribers" USING btree ("token");--> statement-breakpoint
CREATE UNIQUE INDEX "marketing_subscribers_confirm_idx" ON "commerce"."marketing_subscribers" USING btree ("confirm_hash");--> statement-breakpoint
CREATE INDEX "marketing_subscribers_list_idx" ON "commerce"."marketing_subscribers" USING btree ("store_id","status","created_at");--> statement-breakpoint
CREATE INDEX "marketing_subscribers_customer_idx" ON "commerce"."marketing_subscribers" USING btree ("store_id","customer_id");--> statement-breakpoint
CREATE INDEX "marketing_subscribers_pending_idx" ON "commerce"."marketing_subscribers" USING btree ("confirm_until") WHERE "commerce"."marketing_subscribers"."status" = 'pending';