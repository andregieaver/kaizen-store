-- Wishlist items put in the cart (decision D36). Like every commerce table: row-level security on, no policies.
ALTER TABLE commerce.wishlist_cart_adds ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- The record outlives the list, the account, the product and the variant: only the link goes.
ALTER TABLE commerce.wishlist_cart_adds ADD CONSTRAINT wishlist_cart_adds_wishlist_fk
  FOREIGN KEY (store_id, wishlist_id) REFERENCES commerce.wishlists (store_id, id)
  ON DELETE SET NULL (wishlist_id);
--> statement-breakpoint
ALTER TABLE commerce.wishlist_cart_adds ADD CONSTRAINT wishlist_cart_adds_customer_fk
  FOREIGN KEY (store_id, customer_id) REFERENCES commerce.customers (store_id, id)
  ON DELETE SET NULL (customer_id);
--> statement-breakpoint
ALTER TABLE commerce.wishlist_cart_adds ADD CONSTRAINT wishlist_cart_adds_product_fk
  FOREIGN KEY (store_id, product_id) REFERENCES commerce.products (store_id, id)
  ON DELETE SET NULL (product_id);
--> statement-breakpoint
ALTER TABLE commerce.wishlist_cart_adds ADD CONSTRAINT wishlist_cart_adds_variant_fk
  FOREIGN KEY (store_id, variant_id) REFERENCES commerce.product_variants (store_id, id)
  ON DELETE SET NULL (variant_id);
