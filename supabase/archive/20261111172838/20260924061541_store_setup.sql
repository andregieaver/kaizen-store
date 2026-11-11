ALTER TABLE "commerce"."stores" DROP CONSTRAINT "stores_slug_not_reserved";--> statement-breakpoint
ALTER TABLE "commerce"."access_requests" ADD COLUMN "store_id" uuid;--> statement-breakpoint
ALTER TABLE "commerce"."stores" ADD COLUMN "legal_name" text;--> statement-breakpoint
ALTER TABLE "commerce"."stores" ADD COLUMN "organisation_number" text;--> statement-breakpoint
ALTER TABLE "commerce"."stores" ADD COLUMN "contact_email" text;--> statement-breakpoint
ALTER TABLE "commerce"."stores" ADD COLUMN "postal_address" text;--> statement-breakpoint
ALTER TABLE "commerce"."stores" ADD COLUMN "country" char(2);--> statement-breakpoint
ALTER TABLE "commerce"."access_requests" ADD CONSTRAINT "access_requests_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."stores" ADD CONSTRAINT "stores_country_countries_code_fk" FOREIGN KEY ("country") REFERENCES "commerce"."countries"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "access_requests_store_idx" ON "commerce"."access_requests" USING btree ("store_id");--> statement-breakpoint
CREATE INDEX "access_requests_status_idx" ON "commerce"."access_requests" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "stores_country_idx" ON "commerce"."stores" USING btree ("country");--> statement-breakpoint
ALTER TABLE "commerce"."stores" ADD CONSTRAINT "stores_slug_not_reserved" CHECK ("commerce"."stores"."slug" not in ('admin', 'api', 'app', 'auth', 'help', 'mail', 'platform', 'setup', 'sign-in', 'sign-up', 'status', 'support', 'www'));