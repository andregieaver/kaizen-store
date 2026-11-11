-- The demo bundle (wave 6 unit D, D322), as every kind of product has a demo: two white mugs and a tote, priced from them at 10 % off, made
-- by the same function for production's template here and for a new database by `supabase/seed.sql`; `clone_store()` copies it with its
-- components. Nothing is made where the demo mug or tote is missing.
CREATE FUNCTION commerce.add_demo_bundle(p_store uuid)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_product uuid;
  v_variant uuid;
  v_mug record;
  v_tote uuid;
BEGIN
  SELECT id INTO v_product FROM commerce.products WHERE store_id = p_store AND handle = 'demo-kaffepakke';
  IF FOUND THEN
    RETURN v_product;
  END IF;
  SELECT v.id, p.manufacturer_id, p.responsible_person_id, p.vat_category INTO v_mug
    FROM commerce.product_variants v JOIN commerce.products p ON p.store_id = v.store_id AND p.id = v.product_id
   WHERE v.store_id = p_store AND v.sku = 'DEMO-MUG-WHITE';
  SELECT v.id INTO v_tote FROM commerce.product_variants v
    JOIN commerce.products p ON p.store_id = v.store_id AND p.id = v.product_id
   WHERE v.store_id = p_store AND v.sku = 'DEMO-TOTE' AND p.vat_category = v_mug.vat_category;
  IF v_mug.id IS NULL OR v_tote IS NULL THEN
    RETURN NULL;
  END IF;

  INSERT INTO commerce.products (store_id, handle, manufacturer_id, responsible_person_id, tax_code, kind, vat_category, bundle_pricing, bundle_percent_off)
  VALUES (p_store, 'demo-kaffepakke', v_mug.manufacturer_id, v_mug.responsible_person_id, 'txcd_99999999', 'bundle', v_mug.vat_category, 'computed', 10)
  RETURNING id INTO v_product;

  INSERT INTO commerce.product_translations (store_id, product_id, locale, title, description) VALUES
    (p_store, v_product, 'nb-NO', 'Demo: Kaffepakke',
     'To hvite keramikkopper og et handlenett, solgt sammen. Pakken er på lager så lenge koppene og nettet er det, og prisen følger deres.'),
    (p_store, v_product, 'sv-SE', 'Demo: Kaffepaket',
     'Två vita keramikmuggar och en tygkasse, sålda tillsammans. Paketet finns i lager så länge muggarna och kassen gör det, och priset följer deras.'),
    (p_store, v_product, 'da-DK', 'Demo: Kaffepakke',
     'To hvide keramikkrus og en indkøbsnet, solgt sammen. Pakken er på lager, så længe krusene og nettet er det, og prisen følger deres.');

  INSERT INTO commerce.product_media (store_id, product_id, url, position, alt) VALUES
    (p_store, v_product, '/demo/bundle.svg', 0, '{"nb-NO": "To kopper og et handlenett", "sv-SE": "Två muggar och en tygkasse", "da-DK": "To krus og et indkøbsnet"}');

  INSERT INTO commerce.product_variants (store_id, product_id, sku, weight_grams)
  VALUES (p_store, v_product, 'DEMO-VERDIPAKKE', 900)
  RETURNING id INTO v_variant;

  -- The price is the database's, set at commit from the components (`refresh_bundle_prices()`).
  INSERT INTO commerce.bundle_components (store_id, bundle_variant_id, component_variant_id, quantity, position) VALUES
    (p_store, v_variant, v_mug.id, 2, 0),
    (p_store, v_variant, v_tote, 1, 1);

  UPDATE commerce.products SET status = 'active' WHERE id = v_product;
  RETURN v_product;
END;
$$;
--> statement-breakpoint

SELECT commerce.add_demo_bundle(id) FROM commerce.stores WHERE is_template;
