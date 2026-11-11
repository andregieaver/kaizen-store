ALTER TABLE "commerce"."booking_resources" DROP CONSTRAINT "booking_resources_kind";--> statement-breakpoint
ALTER TABLE "commerce"."products" DROP CONSTRAINT "products_kind";--> statement-breakpoint
ALTER TABLE "commerce"."appointment_settings" ADD COLUMN "check_in_time" text DEFAULT '15:00' NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."appointment_settings" ADD COLUMN "check_out_time" text DEFAULT '11:00' NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."appointment_settings" ADD COLUMN "min_nights" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."appointment_settings" ADD COLUMN "max_nights" integer DEFAULT 28 NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."appointment_settings" ADD CONSTRAINT "appointment_settings_times" CHECK ("commerce"."appointment_settings"."check_in_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' and "commerce"."appointment_settings"."check_out_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');--> statement-breakpoint
ALTER TABLE "commerce"."appointment_settings" ADD CONSTRAINT "appointment_settings_nights" CHECK ("commerce"."appointment_settings"."min_nights" between 1 and 365 and "commerce"."appointment_settings"."max_nights" between "commerce"."appointment_settings"."min_nights" and 365);--> statement-breakpoint
ALTER TABLE "commerce"."booking_resources" ADD CONSTRAINT "booking_resources_kind" CHECK ("commerce"."booking_resources"."kind" in ('staff', 'unit', 'item'));--> statement-breakpoint
ALTER TABLE "commerce"."products" ADD CONSTRAINT "products_kind" CHECK ("commerce"."products"."kind" in ('goods', 'appointment', 'stay', 'rental'));