ALTER TABLE "commerce"."carts" ADD COLUMN "company_name" text;--> statement-breakpoint
ALTER TABLE "commerce"."carts" ADD COLUMN "organisation_number" text;--> statement-breakpoint
ALTER TABLE "commerce"."customers" ADD COLUMN "company_name" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."customers" ADD COLUMN "organisation_number" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."orders" ADD COLUMN "company_name" text;--> statement-breakpoint
ALTER TABLE "commerce"."orders" ADD COLUMN "organisation_number" text;--> statement-breakpoint
ALTER TABLE "commerce"."products" ADD COLUMN "audience" text DEFAULT 'all' NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."stores" ADD COLUMN "audience" text DEFAULT 'consumers' NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."stores" ADD COLUMN "business_popup" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."products" ADD CONSTRAINT "products_audience" CHECK ("commerce"."products"."audience" in ('all', 'consumers', 'businesses'));--> statement-breakpoint
ALTER TABLE "commerce"."stores" ADD CONSTRAINT "stores_audience" CHECK ("commerce"."stores"."audience" in ('consumers', 'businesses', 'both'));