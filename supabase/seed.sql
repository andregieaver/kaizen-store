-- The template store (docs/platform.md, P4): the demo store every new store
-- is copied from, with four clearly labelled sample products. Safe to run
-- more than once; it does nothing if a template store already exists.
--
-- Demo products cannot be deleted later (price history is append-only), so
-- retire them by setting status = 'archived'.

DO $$
DECLARE
  v_store uuid;
  v_maker uuid;
  v_rep uuid;
  v_location uuid;
  v_product uuid;
  v_variant uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM commerce.stores WHERE is_template) THEN
    RETURN;
  END IF;

  INSERT INTO commerce.stores (
    slug, name, is_template, setup_completed_at,
    legal_name, contact_email, postal_address, country
  )
  VALUES (
    'demo', 'Kaizen Demo', true, now(),
    'Kaizen Demo AS', 'hei@example.no', E'Storgata 1\n0155 Oslo', 'NO'
  )
  RETURNING id INTO v_store;

  -- Norway, Sweden and Denmark, with each country's currency and language.
  INSERT INTO commerce.markets (store_id, code, currency, default_locale, locales, active)
  SELECT v_store, code, currency, default_locale, locales, true
    FROM commerce.countries
   WHERE code IN ('NO', 'SE', 'DK');

  -- Flat shipping per country, free above a basket value.
  INSERT INTO commerce.shipping_rates (store_id, market_code, currency, amount_minor, free_over_minor) VALUES
    (v_store, 'NO', 'NOK', 9900, 99900),
    (v_store, 'SE', 'SEK', 9900, 99900),
    (v_store, 'DK', 'DKK', 6900, 69900);

  -- The manufacturer is Norwegian, so products sold into the EU also need an
  -- EU responsible person under the General Product Safety Regulation.
  INSERT INTO commerce.economic_operators (store_id, name, postal_address, electronic_address, country)
  VALUES (v_store, 'Kaizen Demo AS', 'Storgata 1, 0155 Oslo, Norge', 'sikkerhet@example.no', 'NO')
  RETURNING id INTO v_maker;

  INSERT INTO commerce.economic_operators (store_id, name, postal_address, electronic_address, country)
  VALUES (v_store, 'Kaizen Demo AB', 'Drottninggatan 1, 111 51 Stockholm, Sverige', 'safety@example.se', 'SE')
  RETURNING id INTO v_rep;

  INSERT INTO commerce.inventory_locations (store_id, name, country)
  VALUES (v_store, 'Lager Oslo', 'NO')
  RETURNING id INTO v_location;

  -- 1. Mug, two colours, with a genuine price reduction in Norway ------------
  INSERT INTO commerce.products (store_id, handle, manufacturer_id, responsible_person_id, tax_code)
  VALUES (v_store, 'demo-keramikkopp', v_maker, v_rep, 'txcd_99999999')
  RETURNING id INTO v_product;

  INSERT INTO commerce.product_translations (store_id, product_id, locale, title, description, safety_information) VALUES
    (v_store, v_product, 'nb-NO', 'Demo: Keramikkopp',
     'Dreid keramikkopp på 350 ml. Tåler oppvaskmaskin og mikrobølgeovn.',
     'Kan bli varm ved bruk i mikrobølgeovn. Ikke bruk koppen hvis den har sprekker.'),
    (v_store, v_product, 'sv-SE', 'Demo: Keramikmugg',
     'Dreid keramikmugg på 350 ml. Tål diskmaskin och mikrovågsugn.',
     'Kan bli varm vid användning i mikrovågsugn. Använd inte muggen om den har sprickor.'),
    (v_store, v_product, 'da-DK', 'Demo: Keramikkrus',
     'Drejet keramikkrus på 350 ml. Tåler opvaskemaskine og mikrobølgeovn.',
     'Kan blive varm ved brug i mikrobølgeovn. Brug ikke kruset, hvis det har revner.');

  INSERT INTO commerce.product_media (store_id, product_id, url, position, alt) VALUES
    (v_store, v_product, '/demo/mug.svg', 0,
     '{"nb-NO": "Hvit keramikkopp", "sv-SE": "Vit keramikmugg", "da-DK": "Hvidt keramikkrus"}');

  INSERT INTO commerce.product_schemes (store_id, product_id, scheme) VALUES (v_store, v_product, 'packaging');

  INSERT INTO commerce.product_variants (store_id, product_id, sku, gtin, options, weight_grams, hs_code, origin_country)
  VALUES (v_store, v_product, 'DEMO-MUG-WHITE', '7090000000011', '{"colour": "white"}', 380, '691200', 'PT')
  RETURNING id INTO v_variant;
  PERFORM commerce.set_price(v_variant, 'NO', 29900, now() - interval '40 days');
  PERFORM commerce.set_price(v_variant, 'NO', 24900, now() - interval '1 day');
  PERFORM commerce.set_price(v_variant, 'SE', 24900, now() - interval '1 day');
  PERFORM commerce.set_price(v_variant, 'DK', 17900, now() - interval '1 day');
  INSERT INTO commerce.inventory_levels (store_id, variant_id, location_id, on_hand) VALUES (v_store, v_variant, v_location, 40);

  INSERT INTO commerce.product_variants (store_id, product_id, sku, gtin, options, weight_grams, hs_code, origin_country)
  VALUES (v_store, v_product, 'DEMO-MUG-BLACK', '7090000000028', '{"colour": "black"}', 380, '691200', 'PT')
  RETURNING id INTO v_variant;
  PERFORM commerce.set_price(v_variant, 'NO', 29900, now() - interval '40 days');
  PERFORM commerce.set_price(v_variant, 'NO', 24900, now() - interval '1 day');
  PERFORM commerce.set_price(v_variant, 'SE', 24900, now() - interval '1 day');
  PERFORM commerce.set_price(v_variant, 'DK', 17900, now() - interval '1 day');
  INSERT INTO commerce.inventory_levels (store_id, variant_id, location_id, on_hand) VALUES (v_store, v_variant, v_location, 3);

  UPDATE commerce.products SET status = 'active' WHERE id = v_product;

  -- 2. Tote bag ---------------------------------------------------------------
  INSERT INTO commerce.products (store_id, handle, manufacturer_id, responsible_person_id, tax_code)
  VALUES (v_store, 'demo-handlenett', v_maker, v_rep, 'txcd_99999999')
  RETURNING id INTO v_product;

  INSERT INTO commerce.product_translations (store_id, product_id, locale, title, description, safety_information) VALUES
    (v_store, v_product, 'nb-NO', 'Demo: Handlenett i lerret',
     'Solid handlenett i økologisk bomull med lange hanker. Bærer opptil 10 kg.',
     'Oppbevares utilgjengelig for små barn på grunn av kvelningsfare fra hankene.'),
    (v_store, v_product, 'sv-SE', 'Demo: Tygkasse i canvas',
     'Stadig tygkasse i ekologisk bomull med långa handtag. Bär upp till 10 kg.',
     'Förvaras oåtkomligt för små barn på grund av kvävningsrisk från handtagen.'),
    (v_store, v_product, 'da-DK', 'Demo: Mulepose i lærred',
     'Solid mulepose i økologisk bomuld med lange hanke. Bærer op til 10 kg.',
     'Opbevares utilgængeligt for små børn på grund af kvælningsfare fra hankene.');

  INSERT INTO commerce.product_media (store_id, product_id, url, position, alt) VALUES
    (v_store, v_product, '/demo/tote.svg', 0,
     '{"nb-NO": "Naturfarget handlenett", "sv-SE": "Naturfärgad tygkasse", "da-DK": "Naturfarvet mulepose"}');

  INSERT INTO commerce.product_schemes (store_id, product_id, scheme) VALUES
    (v_store, v_product, 'packaging'), (v_store, v_product, 'textiles');

  INSERT INTO commerce.product_variants (store_id, product_id, sku, gtin, options, weight_grams, hs_code, origin_country)
  VALUES (v_store, v_product, 'DEMO-TOTE', '7090000000035', '{}', 180, '420222', 'IN')
  RETURNING id INTO v_variant;
  PERFORM commerce.set_price(v_variant, 'NO', 19900, now() - interval '1 day');
  PERFORM commerce.set_price(v_variant, 'SE', 19900, now() - interval '1 day');
  PERFORM commerce.set_price(v_variant, 'DK', 14900, now() - interval '1 day');
  INSERT INTO commerce.inventory_levels (store_id, variant_id, location_id, on_hand) VALUES (v_store, v_variant, v_location, 120);

  UPDATE commerce.products SET status = 'active' WHERE id = v_product;

  -- 3. Notebook, two rulings --------------------------------------------------
  INSERT INTO commerce.products (store_id, handle, manufacturer_id, responsible_person_id, tax_code)
  VALUES (v_store, 'demo-notatbok', v_maker, v_rep, 'txcd_99999999')
  RETURNING id INTO v_product;

  INSERT INTO commerce.product_translations (store_id, product_id, locale, title, description, safety_information) VALUES
    (v_store, v_product, 'nb-NO', 'Demo: Notatbok A5',
     'Trådinnbundet notatbok i A5 med 160 sider i 100 g papir.',
     ''),
    (v_store, v_product, 'sv-SE', 'Demo: Anteckningsbok A5',
     'Trådbunden anteckningsbok i A5 med 160 sidor i 100 g papper.',
     ''),
    (v_store, v_product, 'da-DK', 'Demo: Notesbog A5',
     'Trådindbundet notesbog i A5 med 160 sider i 100 g papir.',
     '');

  INSERT INTO commerce.product_media (store_id, product_id, url, position, alt) VALUES
    (v_store, v_product, '/demo/notebook.svg', 0,
     '{"nb-NO": "Blå notatbok", "sv-SE": "Blå anteckningsbok", "da-DK": "Blå notesbog"}');

  INSERT INTO commerce.product_schemes (store_id, product_id, scheme) VALUES (v_store, v_product, 'packaging');

  INSERT INTO commerce.product_variants (store_id, product_id, sku, gtin, options, weight_grams, hs_code, origin_country)
  VALUES (v_store, v_product, 'DEMO-NOTEBOOK-LINED', '7090000000042', '{"ruling": "lined"}', 300, '482010', 'NO')
  RETURNING id INTO v_variant;
  PERFORM commerce.set_price(v_variant, 'NO', 12900, now() - interval '1 day');
  PERFORM commerce.set_price(v_variant, 'SE', 12900, now() - interval '1 day');
  PERFORM commerce.set_price(v_variant, 'DK', 9900, now() - interval '1 day');
  INSERT INTO commerce.inventory_levels (store_id, variant_id, location_id, on_hand) VALUES (v_store, v_variant, v_location, 60);

  INSERT INTO commerce.product_variants (store_id, product_id, sku, gtin, options, weight_grams, hs_code, origin_country)
  VALUES (v_store, v_product, 'DEMO-NOTEBOOK-DOTTED', '7090000000059', '{"ruling": "dotted"}', 300, '482010', 'NO')
  RETURNING id INTO v_variant;
  PERFORM commerce.set_price(v_variant, 'NO', 12900, now() - interval '1 day');
  PERFORM commerce.set_price(v_variant, 'SE', 12900, now() - interval '1 day');
  PERFORM commerce.set_price(v_variant, 'DK', 9900, now() - interval '1 day');
  INSERT INTO commerce.inventory_levels (store_id, variant_id, location_id, on_hand) VALUES (v_store, v_variant, v_location, 0);

  UPDATE commerce.products SET status = 'active' WHERE id = v_product;

  -- 4. Desk lamp, out of stock ------------------------------------------------
  INSERT INTO commerce.products (store_id, handle, manufacturer_id, responsible_person_id, tax_code)
  VALUES (v_store, 'demo-bordlampe', v_maker, v_rep, 'txcd_99999999')
  RETURNING id INTO v_product;

  INSERT INTO commerce.product_translations (store_id, product_id, locale, title, description, safety_information) VALUES
    (v_store, v_product, 'nb-NO', 'Demo: Bordlampe',
     'Bordlampe i pulverlakkert stål med E27-sokkel og 1,8 m tekstilledning.',
     'Kun for innendørs bruk. Koble fra strømmen før du bytter pære. Maks 40 W.'),
    (v_store, v_product, 'sv-SE', 'Demo: Bordslampa',
     'Bordslampa i pulverlackerat stål med E27-sockel och 1,8 m textilsladd.',
     'Endast för inomhusbruk. Koppla från strömmen innan du byter lampa. Max 40 W.'),
    (v_store, v_product, 'da-DK', 'Demo: Bordlampe',
     'Bordlampe i pulverlakeret stål med E27-fatning og 1,8 m tekstilledning.',
     'Kun til indendørs brug. Afbryd strømmen, før du skifter pære. Maks. 40 W.');

  INSERT INTO commerce.product_media (store_id, product_id, url, position, alt) VALUES
    (v_store, v_product, '/demo/lamp.svg', 0,
     '{"nb-NO": "Grønn bordlampe", "sv-SE": "Grön bordslampa", "da-DK": "Grøn bordlampe"}');

  INSERT INTO commerce.product_schemes (store_id, product_id, scheme) VALUES
    (v_store, v_product, 'packaging'), (v_store, v_product, 'electrical_equipment');

  INSERT INTO commerce.product_variants (store_id, product_id, sku, gtin, options, weight_grams, hs_code, origin_country)
  VALUES (v_store, v_product, 'DEMO-LAMP', '7090000000066', '{}', 1400, '940520', 'DK')
  RETURNING id INTO v_variant;
  PERFORM commerce.set_price(v_variant, 'NO', 89900, now() - interval '1 day');
  PERFORM commerce.set_price(v_variant, 'SE', 89900, now() - interval '1 day');
  PERFORM commerce.set_price(v_variant, 'DK', 64900, now() - interval '1 day');
  INSERT INTO commerce.inventory_levels (store_id, variant_id, location_id, on_hand) VALUES (v_store, v_variant, v_location, 0);

  UPDATE commerce.products SET status = 'active' WHERE id = v_product;
END;
$$;
