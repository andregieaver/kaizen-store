CREATE INDEX "cart_lines_variant_idx" ON "commerce"."cart_lines" USING btree ("variant_id");--> statement-breakpoint
CREATE INDEX "carts_customer_idx" ON "commerce"."carts" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "carts_market_currency_idx" ON "commerce"."carts" USING btree ("market_code","currency");--> statement-breakpoint
CREATE INDEX "credit_notes_refund_idx" ON "commerce"."credit_notes" USING btree ("refund_id");--> statement-breakpoint
CREATE INDEX "inventory_levels_location_idx" ON "commerce"."inventory_levels" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX "inventory_reservations_cart_idx" ON "commerce"."inventory_reservations" USING btree ("cart_id");--> statement-breakpoint
CREATE INDEX "inventory_reservations_order_idx" ON "commerce"."inventory_reservations" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "inventory_reservations_location_idx" ON "commerce"."inventory_reservations" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX "order_lines_variant_idx" ON "commerce"."order_lines" USING btree ("variant_id");--> statement-breakpoint
CREATE INDEX "orders_cart_idx" ON "commerce"."orders" USING btree ("cart_id");--> statement-breakpoint
CREATE INDEX "orders_market_currency_idx" ON "commerce"."orders" USING btree ("market_code","currency");--> statement-breakpoint
CREATE INDEX "prices_market_currency_idx" ON "commerce"."prices" USING btree ("market_code","currency");--> statement-breakpoint
CREATE INDEX "products_manufacturer_idx" ON "commerce"."products" USING btree ("manufacturer_id");--> statement-breakpoint
CREATE INDEX "products_responsible_person_idx" ON "commerce"."products" USING btree ("responsible_person_id");--> statement-breakpoint
CREATE INDEX "return_lines_order_line_idx" ON "commerce"."return_lines" USING btree ("order_line_id");--> statement-breakpoint
CREATE INDEX "returns_withdrawal_request_idx" ON "commerce"."returns" USING btree ("withdrawal_request_id");--> statement-breakpoint
CREATE INDEX "withdrawal_request_lines_order_line_idx" ON "commerce"."withdrawal_request_lines" USING btree ("order_line_id");