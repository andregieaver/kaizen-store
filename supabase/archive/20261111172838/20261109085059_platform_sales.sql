CREATE TABLE "commerce"."platform_sales" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mode" text NOT NULL,
	"stripe_invoice_id" text NOT NULL,
	"buyer_store_id" uuid,
	"number" text,
	"kind" text NOT NULL,
	"country" char(2),
	"paid_at" timestamp with time zone NOT NULL,
	"currency" char(3) NOT NULL,
	"net_minor" bigint NOT NULL,
	"vat_minor" bigint NOT NULL,
	"total_minor" bigint NOT NULL,
	"credited_minor" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_sales_mode" CHECK ("commerce"."platform_sales"."mode" in ('live', 'test')),
	CONSTRAINT "platform_sales_kind" CHECK ("commerce"."platform_sales"."kind" in ('plan', 'theme', 'domain', 'other')),
	CONSTRAINT "platform_sales_amounts" CHECK ("commerce"."platform_sales"."net_minor" >= 0 and "commerce"."platform_sales"."vat_minor" >= 0 and "commerce"."platform_sales"."total_minor" = "commerce"."platform_sales"."net_minor" + "commerce"."platform_sales"."vat_minor" and "commerce"."platform_sales"."credited_minor" between 0 and "commerce"."platform_sales"."total_minor"),
	CONSTRAINT "platform_sales_number" CHECK ("commerce"."platform_sales"."number" is null or char_length("commerce"."platform_sales"."number") between 1 and 60)
);
--> statement-breakpoint
ALTER TABLE "commerce"."platform_sales" ADD CONSTRAINT "platform_sales_buyer_store_id_stores_id_fk" FOREIGN KEY ("buyer_store_id") REFERENCES "commerce"."stores"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "platform_sales_invoice_key" ON "commerce"."platform_sales" USING btree ("mode","stripe_invoice_id");--> statement-breakpoint
CREATE INDEX "platform_sales_paid_idx" ON "commerce"."platform_sales" USING btree ("mode","paid_at");--> statement-breakpoint
CREATE INDEX "platform_sales_buyer_idx" ON "commerce"."platform_sales" USING btree ("buyer_store_id");