-- Wishlists (decision D34). Like every commerce table: row-level security on, no policies.
ALTER TABLE commerce.wishlists ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.wishlist_items ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- A variant removed from the store leaves the item to choose another.
ALTER TABLE commerce.wishlist_items ADD CONSTRAINT wishlist_items_variant_fk
  FOREIGN KEY (store_id, variant_id) REFERENCES commerce.product_variants (store_id, id)
  ON DELETE SET NULL (variant_id);
