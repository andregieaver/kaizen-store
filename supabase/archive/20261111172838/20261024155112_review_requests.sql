CREATE TABLE "commerce"."review_requests" (
	"store_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"outcome" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_requests_store_id_order_id_pk" PRIMARY KEY("store_id","order_id"),
	CONSTRAINT "review_requests_token_key" UNIQUE("token_hash"),
	CONSTRAINT "review_requests_hash" CHECK ("commerce"."review_requests"."token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "review_requests_outcome" CHECK ("commerce"."review_requests"."outcome" is null or "commerce"."review_requests"."outcome" in ('sent', 'logged', 'failed', 'suppressed'))
);
--> statement-breakpoint
ALTER TABLE "commerce"."review_requests" ADD CONSTRAINT "review_requests_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."review_requests" ADD CONSTRAINT "review_requests_order_fk" FOREIGN KEY ("store_id","order_id") REFERENCES "commerce"."orders"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "review_requests_created_idx" ON "commerce"."review_requests" USING btree ("store_id","created_at");