ALTER TABLE "commerce"."appointment_settings" ADD COLUMN "payment" text DEFAULT 'now' NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."appointment_settings" ADD COLUMN "deposit_percent" integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."appointment_settings" ADD COLUMN "cancel_hours" integer DEFAULT 24 NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."appointment_settings" ADD COLUMN "no_show_percent" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."bookings" ADD COLUMN "sequence" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."order_lines" ADD COLUMN "venue_minor" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."orders" ADD COLUMN "balance_minor" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."appointment_settings" ADD CONSTRAINT "appointment_settings_payment" CHECK ("commerce"."appointment_settings"."payment" in ('now', 'deposit', 'venue'));--> statement-breakpoint
ALTER TABLE "commerce"."appointment_settings" ADD CONSTRAINT "appointment_settings_deposit" CHECK ("commerce"."appointment_settings"."deposit_percent" between 1 and 99);--> statement-breakpoint
ALTER TABLE "commerce"."appointment_settings" ADD CONSTRAINT "appointment_settings_cancel" CHECK ("commerce"."appointment_settings"."cancel_hours" between 0 and 720);--> statement-breakpoint
ALTER TABLE "commerce"."appointment_settings" ADD CONSTRAINT "appointment_settings_no_show" CHECK ("commerce"."appointment_settings"."no_show_percent" between 0 and 100);--> statement-breakpoint
ALTER TABLE "commerce"."order_lines" ADD CONSTRAINT "order_lines_venue" CHECK ("commerce"."order_lines"."venue_minor" between 0 and "commerce"."order_lines"."total_minor");--> statement-breakpoint
ALTER TABLE "commerce"."orders" ADD CONSTRAINT "orders_balance" CHECK ("commerce"."orders"."balance_minor" between 0 and "commerce"."orders"."total_minor");