CREATE TYPE "commerce"."email_status" AS ENUM('queued', 'sent', 'failed', 'logged');--> statement-breakpoint
CREATE TABLE "commerce"."email_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid,
	"kind" text NOT NULL,
	"idempotency_key" text,
	"to_address" text NOT NULL,
	"subject" text NOT NULL,
	"html" text NOT NULL,
	"text" text NOT NULL,
	"status" "commerce"."email_status" DEFAULT 'queued' NOT NULL,
	"provider_reference" text,
	"error" text,
	"order_id" uuid,
	"subscription_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "commerce"."email_messages" ADD CONSTRAINT "email_messages_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "email_messages_idempotency_idx" ON "commerce"."email_messages" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "email_messages_store_created_idx" ON "commerce"."email_messages" USING btree ("store_id","created_at");--> statement-breakpoint
CREATE INDEX "email_messages_order_idx" ON "commerce"."email_messages" USING btree ("store_id","order_id");--> statement-breakpoint
CREATE INDEX "email_messages_subscription_idx" ON "commerce"."email_messages" USING btree ("store_id","subscription_id");