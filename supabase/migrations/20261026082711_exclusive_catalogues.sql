ALTER TABLE "commerce"."price_lists" ADD COLUMN "exclusive" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "company_location_buyers_location_fk_idx" ON "commerce"."company_location_buyers" USING btree ("store_id","location_id");--> statement-breakpoint
CREATE INDEX "company_locations_company_fk_idx" ON "commerce"."company_locations" USING btree ("store_id","company_id");--> statement-breakpoint
CREATE INDEX "price_list_assignments_list_fk_idx" ON "commerce"."price_list_assignments" USING btree ("store_id","list_id");--> statement-breakpoint
CREATE INDEX "price_list_prices_list_fk_idx" ON "commerce"."price_list_prices" USING btree ("store_id","list_id");--> statement-breakpoint
CREATE INDEX "price_list_products_list_fk_idx" ON "commerce"."price_list_products" USING btree ("store_id","list_id");