CREATE TABLE "commerce"."booking_seasons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"name" text NOT NULL,
	"from_day" text,
	"to_day" text,
	"weekdays" integer[] DEFAULT '{1,2,3,4,5,6,7}' NOT NULL,
	"percent" integer NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "booking_seasons_name" CHECK (length("commerce"."booking_seasons"."name") between 1 and 60),
	CONSTRAINT "booking_seasons_days" CHECK (("commerce"."booking_seasons"."from_day" is null) = ("commerce"."booking_seasons"."to_day" is null) and ("commerce"."booking_seasons"."from_day" is null or ("commerce"."booking_seasons"."from_day" ~ '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$' and "commerce"."booking_seasons"."to_day" ~ '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'))),
	CONSTRAINT "booking_seasons_weekdays" CHECK (cardinality("commerce"."booking_seasons"."weekdays") between 1 and 7 and "commerce"."booking_seasons"."weekdays" <@ '{1,2,3,4,5,6,7}'::int[]),
	CONSTRAINT "booking_seasons_percent" CHECK ("commerce"."booking_seasons"."percent" between -90 and 500 and "commerce"."booking_seasons"."percent" <> 0)
);
--> statement-breakpoint
ALTER TABLE "commerce"."appointment_settings" ADD COLUMN "booking_fee" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."booking_seasons" ADD CONSTRAINT "booking_seasons_product_fk" FOREIGN KEY ("store_id","product_id") REFERENCES "commerce"."products"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "booking_seasons_product_idx" ON "commerce"."booking_seasons" USING btree ("store_id","product_id","position");