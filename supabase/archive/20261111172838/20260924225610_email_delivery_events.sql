ALTER TYPE "commerce"."email_status" ADD VALUE 'delivered';--> statement-breakpoint
ALTER TYPE "commerce"."email_status" ADD VALUE 'bounced';--> statement-breakpoint
ALTER TYPE "commerce"."email_status" ADD VALUE 'complained';--> statement-breakpoint
CREATE INDEX "email_messages_provider_idx" ON "commerce"."email_messages" USING btree ("provider_reference");