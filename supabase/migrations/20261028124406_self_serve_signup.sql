ALTER TABLE "commerce"."access_requests" ADD COLUMN "self_serve" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."access_requests" ADD COLUMN "confirm_hash" text;--> statement-breakpoint
ALTER TABLE "commerce"."access_requests" ADD COLUMN "confirm_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "commerce"."access_requests" ADD COLUMN "confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "commerce"."platform_settings" ADD COLUMN "self_serve_signup" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."store_billing" ADD COLUMN "trial_ends_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "access_requests_confirm_hash_idx" ON "commerce"."access_requests" USING btree ("confirm_hash");--> statement-breakpoint
ALTER TABLE "commerce"."access_requests" ADD CONSTRAINT "access_requests_confirm" CHECK ("commerce"."access_requests"."confirm_hash" is null or ("commerce"."access_requests"."self_serve" and "commerce"."access_requests"."confirm_expires_at" is not null));