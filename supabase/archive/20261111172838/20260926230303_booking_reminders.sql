ALTER TABLE "commerce"."bookings" ADD COLUMN "reminded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "commerce"."stores" ADD COLUMN "booking_reminder_hours" integer DEFAULT 24 NOT NULL;--> statement-breakpoint
CREATE INDEX "bookings_reminder_due_idx" ON "commerce"."bookings" USING btree ("starts_at") WHERE "commerce"."bookings"."status" = 'confirmed' and "commerce"."bookings"."reminded_at" is null;--> statement-breakpoint
ALTER TABLE "commerce"."stores" ADD CONSTRAINT "stores_booking_reminder_hours" CHECK ("commerce"."stores"."booking_reminder_hours" between 0 and 168);