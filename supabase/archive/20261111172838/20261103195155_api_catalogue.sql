CREATE TABLE "commerce"."api_uploads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"token_id" uuid NOT NULL,
	"path" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"media_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_uploads_store_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "api_uploads_size" CHECK ("commerce"."api_uploads"."size_bytes" between 1 and 20971520),
	CONSTRAINT "api_uploads_type" CHECK ("commerce"."api_uploads"."content_type" in ('image/jpeg', 'image/png', 'image/webp', 'image/avif'))
);
--> statement-breakpoint
ALTER TABLE "commerce"."api_uploads" ADD CONSTRAINT "api_uploads_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."api_uploads" ADD CONSTRAINT "api_uploads_token_id_api_tokens_id_fk" FOREIGN KEY ("token_id") REFERENCES "commerce"."api_tokens"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."api_uploads" ADD CONSTRAINT "api_uploads_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "commerce"."media"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_uploads_store_idx" ON "commerce"."api_uploads" USING btree ("store_id");--> statement-breakpoint
CREATE INDEX "api_uploads_token_idx" ON "commerce"."api_uploads" USING btree ("token_id");--> statement-breakpoint
CREATE INDEX "api_uploads_media_idx" ON "commerce"."api_uploads" USING btree ("media_id");--> statement-breakpoint
CREATE INDEX "api_uploads_expires_idx" ON "commerce"."api_uploads" USING btree ("expires_at");--> statement-breakpoint
-- Reached only through server code (D440).
ALTER TABLE "commerce"."api_uploads" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "commerce"."workflows" DROP CONSTRAINT "workflows_trigger";--> statement-breakpoint
ALTER TABLE "commerce"."workflows" ADD CONSTRAINT "workflows_trigger" CHECK ("commerce"."workflows"."trigger" in ('order.paid', 'order.sent', 'order.cancelled', 'order.refunded', 'customer.created', 'subscription.started', 'subscription.cancelled', 'return.requested', 'withdrawal.received', 'product.created', 'product.updated', 'stock.low', 'discount.created', 'inventory.updated', 'product.archived', 'support.waiting', 'schedule'));
