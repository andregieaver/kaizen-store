-- Keyword search (Phase 2, S1). The log, like every commerce table: row-level security on, no policies.
ALTER TABLE commerce.search_queries ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Trigram indexes for misspelt titles, SKUs and category and tag names.
CREATE INDEX product_translations_title_trgm_idx
  ON commerce.product_translations USING gin (lower(title) extensions.gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX product_variants_sku_trgm_idx
  ON commerce.product_variants USING gin (lower(sku) extensions.gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX terms_name_trgm_idx
  ON commerce.terms USING gin (lower(name) extensions.gin_trgm_ops);
