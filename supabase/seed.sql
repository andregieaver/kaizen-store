-- The template store (docs/platform.md, P4): the demo store every new store
-- is copied from, with clearly labelled sample products, one of each kind. Safe to run
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

  INSERT INTO commerce.product_variants (store_id, product_id, sku, gtin, options, weight_grams, hs_code, origin_country, image_url)
  VALUES (v_store, v_product, 'DEMO-MUG-WHITE', '7090000000011', '{"colour": "white"}', 380, '691200', 'PT', '/demo/mug.svg')
  RETURNING id INTO v_variant;
  PERFORM commerce.set_price(v_variant, 'NO', 29900, now() - interval '40 days');
  PERFORM commerce.set_price(v_variant, 'NO', 24900, now() - interval '1 day');
  PERFORM commerce.set_price(v_variant, 'SE', 24900, now() - interval '1 day');
  PERFORM commerce.set_price(v_variant, 'DK', 17900, now() - interval '1 day');
  INSERT INTO commerce.inventory_levels (store_id, variant_id, location_id, on_hand) VALUES (v_store, v_variant, v_location, 40);

  INSERT INTO commerce.product_variants (store_id, product_id, sku, gtin, options, weight_grams, hs_code, origin_country, image_url)
  VALUES (v_store, v_product, 'DEMO-MUG-BLACK', '7090000000028', '{"colour": "black"}', 380, '691200', 'PT', '/demo/mug-black.svg')
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
     '{"nb-NO": "Blå notatbok", "sv-SE": "Blå anteckningsbok", "da-DK": "Blå notesbog"}'),
    (v_store, v_product, '/demo/notebook-open.svg', 1,
     '{"nb-NO": "Notatboken slått opp, med linjerte sider", "sv-SE": "Anteckningsboken uppslagen, med linjerade sidor", "da-DK": "Notesbogen slået op, med linjerede sider"}'),
    (v_store, v_product, '/demo/notebook-back.svg', 2,
     '{"nb-NO": "Baksiden av notatboken", "sv-SE": "Baksidan av anteckningsboken", "da-DK": "Bagsiden af notesbogen"}');

  INSERT INTO commerce.product_schemes (store_id, product_id, scheme) VALUES (v_store, v_product, 'packaging');

  INSERT INTO commerce.product_variants (store_id, product_id, sku, gtin, options, weight_grams, hs_code, origin_country, image_url)
  VALUES (v_store, v_product, 'DEMO-NOTEBOOK-LINED', '7090000000042', '{"ruling": "lined"}', 300, '482010', 'NO', '/demo/notebook-open.svg')
  RETURNING id INTO v_variant;
  PERFORM commerce.set_price(v_variant, 'NO', 12900, now() - interval '1 day');
  PERFORM commerce.set_price(v_variant, 'SE', 12900, now() - interval '1 day');
  PERFORM commerce.set_price(v_variant, 'DK', 9900, now() - interval '1 day');
  INSERT INTO commerce.inventory_levels (store_id, variant_id, location_id, on_hand) VALUES (v_store, v_variant, v_location, 60);

  INSERT INTO commerce.product_variants (store_id, product_id, sku, gtin, options, weight_grams, hs_code, origin_country, image_url)
  VALUES (v_store, v_product, 'DEMO-NOTEBOOK-DOTTED', '7090000000059', '{"ruling": "dotted"}', 300, '482010', 'NO', '/demo/notebook-dotted.svg')
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

  -- 4b. A thermos that keeps selling at zero stock (wave 3, D172): nothing in stock, "expected to ship within 7 days", so the
  -- storefront's backorder wording and the cart have a fixture. Its stock is 0 and it may go below zero when it is sold.
  INSERT INTO commerce.products (store_id, handle, manufacturer_id, responsible_person_id, tax_code)
  VALUES (v_store, 'demo-termokopp', v_maker, v_rep, 'txcd_99999999')
  RETURNING id INTO v_product;

  INSERT INTO commerce.product_translations (store_id, product_id, locale, title, description, safety_information) VALUES
    (v_store, v_product, 'nb-NO', 'Demo: Termokopp på bestilling',
     'Termokopp i rustfritt stål på 400 ml. Bestilles hjem fra leverandøren når du kjøper den.',
     'Ikke fyll koppen med kokende væske til randen. Hold utilgjengelig for små barn når den er varm.'),
    (v_store, v_product, 'sv-SE', 'Demo: Termosmugg på beställning',
     'Termosmugg i rostfritt stål på 400 ml. Beställs hem från leverantören när du köper den.',
     'Fyll inte muggen med kokande vätska till kanten. Förvaras oåtkomligt för små barn när den är varm.'),
    (v_store, v_product, 'da-DK', 'Demo: Termokrus på bestilling',
     'Termokrus i rustfrit stål på 400 ml. Bestilles hjem fra leverandøren, når du køber det.',
     'Fyld ikke kruset med kogende væske til randen. Opbevares utilgængeligt for små børn, når det er varmt.');

  INSERT INTO commerce.product_media (store_id, product_id, url, position, alt) VALUES
    (v_store, v_product, '/demo/mug-black.svg', 0,
     '{"nb-NO": "Svart termokopp", "sv-SE": "Svart termosmugg", "da-DK": "Sort termokrus"}');

  INSERT INTO commerce.product_schemes (store_id, product_id, scheme) VALUES (v_store, v_product, 'packaging');

  INSERT INTO commerce.product_variants (store_id, product_id, sku, gtin, options, weight_grams, hs_code, origin_country, image_url, stock_policy, backorder_days)
  VALUES (v_store, v_product, 'DEMO-THERMOS', '7090000000073', '{}', 420, '961700', 'CN', '/demo/mug-black.svg', 'continue', 7)
  RETURNING id INTO v_variant;
  PERFORM commerce.set_price(v_variant, 'NO', 34900, now() - interval '1 day');
  PERFORM commerce.set_price(v_variant, 'SE', 34900, now() - interval '1 day');
  PERFORM commerce.set_price(v_variant, 'DK', 24900, now() - interval '1 day');
  INSERT INTO commerce.inventory_levels (store_id, variant_id, location_id, on_hand) VALUES (v_store, v_variant, v_location, 0);

  UPDATE commerce.products SET status = 'active' WHERE id = v_product;

  -- 5. An appointment (D65), with a member of staff to book: every kind of
  -- product has a demo, from the same function production's template used.
  PERFORM commerce.add_demo_appointment(v_store);
  -- 6. A stay and a rental (D67), with a cabin and bikes to book.
  PERFORM commerce.add_demo_stay(v_store);
  PERFORM commerce.add_demo_rental(v_store);

  -- Categories and tags (D50), with the demo's products in them; a lamp is
  -- in Belysning, inside Hjem, so it shows under Hjem too.
  INSERT INTO commerce.terms (store_id, content_type, kind, name, slug) VALUES
    (v_store, 'product', 'category', 'Papir', 'papir'),
    (v_store, 'product', 'category', 'Hjem', 'hjem'),
    (v_store, 'product', 'tag', 'Nyhet', 'nyhet');
  INSERT INTO commerce.terms (store_id, content_type, kind, parent_id, name, slug)
  SELECT v_store, 'product', 'category', id, 'Belysning', 'belysning'
    FROM commerce.terms WHERE store_id = v_store AND content_type = 'product' AND kind = 'category' AND slug = 'hjem';
  INSERT INTO commerce.product_terms (store_id, product_id, term_id)
  SELECT v_store, p.id, t.id
    FROM commerce.products p
    JOIN commerce.terms t ON t.store_id = v_store AND t.content_type = 'product'
   WHERE p.store_id = v_store
     AND (p.handle, t.kind, t.slug) IN (
       ('demo-notatbok', 'category', 'papir'),
       ('demo-keramikkopp', 'category', 'hjem'),
       ('demo-bordlampe', 'category', 'belysning'),
       ('demo-notatbok', 'tag', 'nyhet'),
       ('demo-handlenett', 'tag', 'nyhet')
     );

  -- A page of the store's own (D54), linked from its footer, with its texts in
  -- Swedish (D55); in Danish it reads in Norwegian.
  INSERT INTO commerce.pages (store_id, slug, draft, published, published_at)
  VALUES (v_store, 'om-oss', '{"title": "Om oss", "slug": "om-oss", "thumbnail": null, "seo": {"title": "", "description": "Kaizen Demo selger ting for hjem og kontor, laget for å vise hva Kaizen kan."}, "searchEngines": true, "aiAssistants": true, "categories": [], "tags": [], "translations": {"sv-SE": {"seo.description": "Kaizen Demo säljer saker för hem och kontor, gjord för att visa vad Kaizen kan.", "block.text-about.doc": {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Vi säljer saker för hem och kontor. Butiken finns för att visa vad Kaizen kan."}]}]}}}, "rows": [{"id": "row-about", "type": "row", "layout": "1", "columns": [{"id": "column-about", "blocks": [{"id": "heading-about", "type": "heading", "text": "Om Kaizen Demo", "level": 1}, {"id": "text-about", "type": "richText", "doc": {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Vi selger ting for hjem og kontor. Butikken er laget for å vise hva Kaizen kan."}]}]}}]}]}]}'::jsonb, '{"title": "Om oss", "slug": "om-oss", "thumbnail": null, "seo": {"title": "", "description": "Kaizen Demo selger ting for hjem og kontor, laget for å vise hva Kaizen kan."}, "searchEngines": true, "aiAssistants": true, "categories": [], "tags": [], "translations": {"sv-SE": {"seo.description": "Kaizen Demo säljer saker för hem och kontor, gjord för att visa vad Kaizen kan.", "block.text-about.doc": {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Vi säljer saker för hem och kontor. Butiken finns för att visa vad Kaizen kan."}]}]}}}, "rows": [{"id": "row-about", "type": "row", "layout": "1", "columns": [{"id": "column-about", "blocks": [{"id": "heading-about", "type": "heading", "text": "Om Kaizen Demo", "level": 1}, {"id": "text-about", "type": "richText", "doc": {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Vi selger ting for hjem og kontor. Butikken er laget for å vise hva Kaizen kan."}]}]}}]}]}]}'::jsonb, now());

  -- Its front page (D54): the products in a content grid, as in production
  -- (migration store_pages_copy); new stores start with a copy.
  INSERT INTO commerce.pages (store_id, slug, draft, published, published_at)
  VALUES (v_store, 'forside', '{"title": "Forside", "slug": "forside", "thumbnail": null, "seo": {"title": "", "description": ""}, "searchEngines": true, "aiAssistants": true, "categories": [], "tags": [], "translations": {"sv-SE": {"title": "Startsida"}}, "rows": [{"id": "front-row", "type": "row", "layout": "1", "columns": [{"id": "front-column", "blocks": [{"id": "front-heading", "type": "heading", "text": "Produkter", "level": 1}, {"id": "front-products", "type": "contentGrid", "source": {"type": "products"}, "categories": [], "tags": [], "sort": "oldest", "limit": 48, "columns": {"mobile": 2, "tablet": 3, "desktop": 4}, "show": {"image": true, "heading": true, "excerpt": false, "price": true, "button": false}, "buttonLabel": "", "emptyText": "", "headingLevel": 2, "excerptLines": 3, "gap": 24}]}]}]}'::jsonb, '{"title": "Forside", "slug": "forside", "thumbnail": null, "seo": {"title": "", "description": ""}, "searchEngines": true, "aiAssistants": true, "categories": [], "tags": [], "translations": {"sv-SE": {"title": "Startsida"}}, "rows": [{"id": "front-row", "type": "row", "layout": "1", "columns": [{"id": "front-column", "blocks": [{"id": "front-heading", "type": "heading", "text": "Produkter", "level": 1}, {"id": "front-products", "type": "contentGrid", "source": {"type": "products"}, "categories": [], "tags": [], "sort": "oldest", "limit": 48, "columns": {"mobile": 2, "tablet": 3, "desktop": 4}, "show": {"image": true, "heading": true, "excerpt": false, "price": true, "button": false}, "buttonLabel": "", "emptyText": "", "headingLevel": 2, "excerptLines": 3, "gap": 24}]}]}]}'::jsonb, now());
  UPDATE commerce.stores SET front_page_id = (SELECT id FROM commerce.pages WHERE store_id = v_store AND slug = 'forside')
   WHERE id = v_store;

  -- The All products page (D83), at /products: every product in a grid shoppers can filter and sort.
  INSERT INTO commerce.pages (store_id, slug, draft, published, published_at)
  VALUES (v_store, 'alle-produkter', '{"title": "Alle produkter", "slug": "alle-produkter", "thumbnail": null, "seo": {"title": "", "description": ""}, "searchEngines": true, "aiAssistants": true, "categories": [], "tags": [], "translations": {"sv-SE": {"title": "Alla produkter", "block.products-heading.text": "Alla produkter"}, "da-DK": {"title": "Alle produkter", "block.products-heading.text": "Alle produkter"}}, "rows": [{"id": "products-row", "type": "row", "layout": "1", "columns": [{"id": "products-column", "blocks": [{"id": "products-heading", "type": "heading", "text": "Alle produkter", "level": 1}, {"id": "products-grid", "type": "contentGrid", "source": {"type": "products"}, "categories": [], "tags": [], "sort": "oldest", "limit": 48, "columns": {"mobile": 2, "tablet": 3, "desktop": 4}, "show": {"image": true, "heading": true, "excerpt": false, "price": true, "button": false}, "buttonLabel": "", "emptyText": "", "filters": true, "headingLevel": 2, "excerptLines": 3, "gap": 24}]}]}]}'::jsonb, '{"title": "Alle produkter", "slug": "alle-produkter", "thumbnail": null, "seo": {"title": "", "description": ""}, "searchEngines": true, "aiAssistants": true, "categories": [], "tags": [], "translations": {"sv-SE": {"title": "Alla produkter", "block.products-heading.text": "Alla produkter"}, "da-DK": {"title": "Alle produkter", "block.products-heading.text": "Alle produkter"}}, "rows": [{"id": "products-row", "type": "row", "layout": "1", "columns": [{"id": "products-column", "blocks": [{"id": "products-heading", "type": "heading", "text": "Alle produkter", "level": 1}, {"id": "products-grid", "type": "contentGrid", "source": {"type": "products"}, "categories": [], "tags": [], "sort": "oldest", "limit": 48, "columns": {"mobile": 2, "tablet": 3, "desktop": 4}, "show": {"image": true, "heading": true, "excerpt": false, "price": true, "button": false}, "buttonLabel": "", "emptyText": "", "filters": true, "headingLevel": 2, "excerptLines": 3, "gap": 24}]}]}]}'::jsonb, now());
  UPDATE commerce.stores SET products_page_id = (SELECT id FROM commerce.pages WHERE store_id = v_store AND slug = 'alle-produkter')
   WHERE id = v_store;

  -- A blog article (D57) in an article category, as new stores' blogs start empty
  -- in production; locally it shows the blog.
  INSERT INTO commerce.terms (store_id, content_type, kind, name, slug) VALUES (v_store, 'article', 'category', 'Nyheter', 'nyheter');
  INSERT INTO commerce.pages (store_id, type, slug, draft, published, published_at, first_published_at)
  VALUES (v_store, 'article', 'nye-produkter', '{"title": "Nye produkter i høst", "slug": "nye-produkter", "thumbnail": null, "seo": {"title": "", "description": "Høstens nyheter i Kaizen Demo."}, "searchEngines": true, "aiAssistants": true, "categories": [], "tags": [], "author": "Kari Nordmann", "rows": [{"id": "row-autumn", "type": "row", "layout": "1", "columns": [{"id": "column-autumn", "blocks": [{"id": "text-autumn", "type": "richText", "doc": {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Denne høsten har vi fått inn nye notatbøker og handlenett."}]}]}}]}]}]}'::jsonb, '{"title": "Nye produkter i høst", "slug": "nye-produkter", "thumbnail": null, "seo": {"title": "", "description": "Høstens nyheter i Kaizen Demo."}, "searchEngines": true, "aiAssistants": true, "categories": [], "tags": [], "author": "Kari Nordmann", "rows": [{"id": "row-autumn", "type": "row", "layout": "1", "columns": [{"id": "column-autumn", "blocks": [{"id": "text-autumn", "type": "richText", "doc": {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Denne høsten har vi fått inn nye notatbøker og handlenett."}]}]}}]}]}]}'::jsonb, now(), now());
  UPDATE commerce.pages p
     SET draft = jsonb_set(p.draft, '{categories}', jsonb_build_array(t.id)),
         published = jsonb_set(p.published, '{categories}', jsonb_build_array(t.id))
    FROM commerce.terms t
   WHERE p.store_id = v_store AND p.type = 'article' AND p.slug = 'nye-produkter'
     AND t.store_id = v_store AND t.content_type = 'article' AND t.slug = 'nyheter';

  -- The demo's logo (D30), copied to new stores with the catalogue.
  UPDATE commerce.stores SET navigation = '{"logo": {"url": "/demo/logo.svg", "width": 180, "height": 40}}'::jsonb WHERE id = v_store;
  -- Its menus (D85), in the standard header and footer.
  INSERT INTO commerce.menus (store_id, name, items)
  VALUES (v_store, 'Main menu', '[{"label": {}, "link": {"kind": "home"}, "depth": 0}, {"label": {"nb-NO": "Notatbok", "sv-SE": "Anteckningsbok", "da-DK": "Notesbog"}, "link": {"kind": "product", "handle": "demo-notatbok"}, "depth": 0}, {"label": {"nb-NO": "Kopp", "sv-SE": "Kopp", "da-DK": "Krus"}, "link": {"kind": "product", "handle": "demo-keramikkopp"}, "depth": 0}, {"label": {"nb-NO": "Bordlampe", "sv-SE": "Bordslampa", "da-DK": "Bordlampe"}, "link": {"kind": "product", "handle": "demo-bordlampe"}, "depth": 0}]'::jsonb),
         (v_store, 'Footer menu', '[{"label": {}, "link": {"kind": "home"}, "depth": 0}, {"label": {"nb-NO": "Handlenett", "sv-SE": "Tygkasse", "da-DK": "Mulepose"}, "link": {"kind": "product", "handle": "demo-handlenett"}, "depth": 0}, {"label": {"nb-NO": "Hjem og kjøkken", "sv-SE": "Hem och kök", "da-DK": "Hjem og køkken"}, "link": {"kind": "category", "slug": "hjem"}, "depth": 0}, {"label": {}, "link": {"kind": "page", "slug": "om-oss"}, "depth": 0}, {"label": {}, "link": {"kind": "blog"}, "depth": 0}, {"label": {"nb-NO": "Laget med Kaizen", "sv-SE": "Byggd med Kaizen", "da-DK": "Lavet med Kaizen"}, "link": {"kind": "url", "url": "https://kaizenstore.cloud"}, "depth": 0}]'::jsonb);
  UPDATE commerce.stores s
     SET header_menu_id = (SELECT id FROM commerce.menus WHERE store_id = v_store AND name = 'Main menu'),
         footer_menu_id = (SELECT id FROM commerce.menus WHERE store_id = v_store AND name = 'Footer menu')
   WHERE s.id = v_store;

  -- Languages and currencies apart from its countries (D109): English, and
  -- euro at rates as of the seed, rounded to whole cents.
  UPDATE commerce.stores SET locales = ARRAY['nb-NO', 'sv-SE', 'da-DK', 'en-GB'] WHERE id = v_store;
  INSERT INTO commerce.store_currencies (store_id, currency, rate, round_to, position) VALUES
    (v_store, 'NOK', 11.6, 1, 0), (v_store, 'SEK', 11.0, 1, 1), (v_store, 'DKK', 7.46, 1, 2), (v_store, 'EUR', 1, 1, 3);
END;
$$;

-- Kaizen's own blog (D57): one article, so the blog is not empty locally.
INSERT INTO commerce.pages (store_id, type, slug, draft, published, published_at, first_published_at)
VALUES (NULL, 'article', 'welcome', '{"title": "Welcome to the Kaizen blog", "slug": "welcome", "thumbnail": null, "seo": {"title": "", "description": "News and guides from Kaizen."}, "searchEngines": true, "aiAssistants": true, "categories": [], "tags": [], "author": "Kaizen team", "rows": [{"id": "row-welcome", "type": "row", "layout": "1", "columns": [{"id": "column-welcome", "blocks": [{"id": "text-welcome", "type": "richText", "doc": {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "This is where we write about selling online across the EU."}]}]}}]}]}]}'::jsonb, '{"title": "Welcome to the Kaizen blog", "slug": "welcome", "thumbnail": null, "seo": {"title": "", "description": "News and guides from Kaizen."}, "searchEngines": true, "aiAssistants": true, "categories": [], "tags": [], "author": "Kaizen team", "rows": [{"id": "row-welcome", "type": "row", "layout": "1", "columns": [{"id": "column-welcome", "blocks": [{"id": "text-welcome", "type": "richText", "doc": {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "This is where we write about selling online across the EU."}]}]}}]}]}]}'::jsonb, now(), now())
ON CONFLICT ON CONSTRAINT pages_store_slug_key DO NOTHING;
