CREATE TABLE "commerce"."checkout_accounts" (
	"order_id" uuid PRIMARY KEY NOT NULL,
	"store_id" uuid NOT NULL,
	"password_hash" text,
	"outcome" text,
	"customer_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"signed_in_at" timestamp with time zone,
	CONSTRAINT "checkout_accounts_outcome" CHECK ("commerce"."checkout_accounts"."outcome" in ('created', 'known'))
);
--> statement-breakpoint
ALTER TABLE "commerce"."customers" ADD COLUMN "email_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "commerce"."checkout_accounts" ADD CONSTRAINT "checkout_accounts_order_fk" FOREIGN KEY ("store_id","order_id") REFERENCES "commerce"."orders"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."checkout_accounts" ADD CONSTRAINT "checkout_accounts_customer_fk" FOREIGN KEY ("store_id","customer_id") REFERENCES "commerce"."customers"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "orders_email_idx" ON "commerce"."orders" USING btree ("store_id",lower("email"));