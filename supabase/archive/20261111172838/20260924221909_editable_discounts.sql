ALTER TABLE "commerce"."store_billing" DROP CONSTRAINT "store_billing_platform_discount_id_platform_discount_codes_id_fk";
--> statement-breakpoint
ALTER TABLE "commerce"."platform_discount_codes" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."store_billing" ADD CONSTRAINT "store_billing_platform_discount_id_platform_discount_codes_id_fk" FOREIGN KEY ("platform_discount_id") REFERENCES "commerce"."platform_discount_codes"("id") ON DELETE set null ON UPDATE no action;