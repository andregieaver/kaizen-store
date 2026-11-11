ALTER TABLE "commerce"."shipments" ADD COLUMN "carrier_id" text;--> statement-breakpoint
ALTER TABLE "commerce"."shipments" ADD COLUMN "consignment_number" text;--> statement-breakpoint
ALTER TABLE "commerce"."shipments" ADD COLUMN "label_url" text;--> statement-breakpoint
ALTER TABLE "commerce"."shipping_carriers" ADD COLUMN "checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "commerce"."shipping_carriers" ADD COLUMN "check_ok" boolean;--> statement-breakpoint
ALTER TABLE "commerce"."shipping_carriers" ADD COLUMN "check_message" text;--> statement-breakpoint
ALTER TABLE "commerce"."shipments" ADD CONSTRAINT "shipments_label_url" CHECK ("commerce"."shipments"."label_url" is null or "commerce"."shipments"."label_url" ~ '^https://');