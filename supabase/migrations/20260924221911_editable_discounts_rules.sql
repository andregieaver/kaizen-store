-- D31: deleting a store's discount code leaves its orders as they are: they
-- keep the code's text and what it took off, and only lose the link to it.
-- (Only the code column is cleared; the order stays in its store.)
ALTER TABLE commerce.orders DROP CONSTRAINT orders_discount_code_fk;
--> statement-breakpoint
ALTER TABLE commerce.orders ADD CONSTRAINT orders_discount_code_fk
  FOREIGN KEY (store_id, discount_code_id) REFERENCES commerce.discount_codes (store_id, id)
  ON DELETE SET NULL (discount_code_id);
