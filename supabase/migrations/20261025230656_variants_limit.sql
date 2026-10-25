-- Variants at scale (wave 6 unit B, D320, docs/wave-6-catalogue.md B.1): a product has at most 2,048 active variants, as
-- `MAX_VARIANTS` in src/lib/product-input.ts says. Switched-off variants are history (never deleted) and do not count.
--
-- A deferred constraint trigger, checked at commit: a save inserts the new combinations before it switches off the ones taken out,
-- so the count may pass the limit for a moment inside one transaction. It counts once per product and transaction (a local
-- setting remembers it), so a save of 2,048 new variants is one count, not 2,048.

CREATE FUNCTION commerce.product_variants_limit()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_key text := 'kaizen.variants_checked_' || replace(NEW.product_id::text, '-', '');
  v_count integer;
BEGIN
  IF NOT NEW.active OR coalesce(current_setting(v_key, true), '') = 'yes' THEN
    RETURN NULL;
  END IF;
  PERFORM set_config(v_key, 'yes', true);
  SELECT count(*) INTO v_count
    FROM commerce.product_variants v
   WHERE v.store_id = NEW.store_id AND v.product_id = NEW.product_id AND v.active;
  IF v_count > 2048 THEN
    RAISE EXCEPTION 'variants.too_many: a product has at most 2048 variants for sale (this one would have %)', v_count
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER product_variants_limit
  AFTER INSERT OR UPDATE OF active ON commerce.product_variants
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION commerce.product_variants_limit();
