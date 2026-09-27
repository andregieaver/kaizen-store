-- Covers product_embeddings_product_fk (D74), as the advisors ask for every foreign key.
CREATE INDEX product_embeddings_product_idx ON commerce.product_embeddings (store_id, product_id);
