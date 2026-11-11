CREATE TABLE "commerce"."shipments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"carrier" text DEFAULT '' NOT NULL,
	"tracking_number" text DEFAULT '' NOT NULL,
	"tracking_url" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shipments_tracking_url" CHECK ("commerce"."shipments"."tracking_url" ~ '^https://')
);
--> statement-breakpoint
ALTER TABLE "commerce"."refunds" ADD COLUMN "restocked" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."refunds" ADD COLUMN "created_by" uuid;--> statement-breakpoint
ALTER TABLE "commerce"."shipments" ADD CONSTRAINT "shipments_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."shipments" ADD CONSTRAINT "shipments_order_fk" FOREIGN KEY ("store_id","order_id") REFERENCES "commerce"."orders"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "shipments_order_idx" ON "commerce"."shipments" USING btree ("store_id","order_id");--> statement-breakpoint
CREATE INDEX "shipments_created_by_idx" ON "commerce"."shipments" USING btree ("created_by");--> statement-breakpoint
ALTER TABLE "commerce"."refunds" ADD CONSTRAINT "refunds_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "refunds_created_by_idx" ON "commerce"."refunds" USING btree ("created_by");