CREATE TABLE "commerce"."push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"device" text DEFAULT '' NOT NULL,
	"failures" integer DEFAULT 0 NOT NULL,
	"last_sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_subscriptions_endpoint_store_key" UNIQUE("endpoint","store_id"),
	CONSTRAINT "push_subscriptions_endpoint" CHECK ("commerce"."push_subscriptions"."endpoint" like 'https://%' and length("commerce"."push_subscriptions"."endpoint") <= 2000),
	CONSTRAINT "push_subscriptions_device" CHECK (length("commerce"."push_subscriptions"."device") <= 60)
);
--> statement-breakpoint
ALTER TABLE "commerce"."push_subscriptions" ADD CONSTRAINT "push_subscriptions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "commerce"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."push_subscriptions" ADD CONSTRAINT "push_subscriptions_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "push_subscriptions_store_idx" ON "commerce"."push_subscriptions" USING btree ("store_id");--> statement-breakpoint
CREATE INDEX "push_subscriptions_account_idx" ON "commerce"."push_subscriptions" USING btree ("account_id","store_id");
-- Staff devices' push subscriptions (wave 9 unit H, D361): read and written by the server only, never through the Data API.
ALTER TABLE "commerce"."push_subscriptions" ENABLE ROW LEVEL SECURITY;
