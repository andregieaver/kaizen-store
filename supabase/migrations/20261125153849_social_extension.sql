-- The social media manager as a paid extension (D870 S1.6, docs/social-manager.md 7): Social posts, its adviser, the Facebook Page and
-- Instagram figures, the weekly review and the AI manager's social tools. One size at €39 a month (NOK ×10, a year ten months, as every
-- extension), no founding price, a member of the Everything bundle ("Every extension"), and in no plan yet: the owner chooses at
-- Platform -> Plans -> Extensions, where every number here is theirs to change. Only with a store (it writes from the store's products,
-- pages and figures). Kaizena Flow's own account has every extension, so its store keeps it.
DO $$
DECLARE
  v_size uuid;
  v_currency text;
  v_rate int;
BEGIN
  INSERT INTO commerce.extensions (id, name, description, standalone, store_only, position)
  VALUES ('social', 'Social media manager', 'Posts and pictures for every channel in your brand, an adviser that reads your figures, and a weekly review.', false, true,
    coalesce((SELECT max(position) + 1 FROM commerce.extensions), 5))
  ON CONFLICT (id) DO NOTHING;

  IF NOT EXISTS (SELECT 1 FROM commerce.extension_sizes WHERE extension_id = 'social') THEN
    INSERT INTO commerce.extension_sizes (extension_id, label, allowances, position)
    VALUES ('social', 'Every channel', '{}'::jsonb, 0)
    RETURNING id INTO v_size;
    FOREACH v_currency IN ARRAY ARRAY['EUR', 'NOK'] LOOP
      v_rate := CASE v_currency WHEN 'NOK' THEN 10 ELSE 1 END;
      INSERT INTO commerce.extension_prices (size_id, currency, interval, amount_minor) VALUES
        (v_size, v_currency, 'month', 3900 * v_rate),
        (v_size, v_currency, 'year', 3900 * v_rate * 10);
    END LOOP;
  END IF;

  INSERT INTO commerce.extension_bundle_members (bundle_id, extension_id)
  SELECT b.id, 'social' FROM commerce.extension_bundles b WHERE b.name = 'Everything'
  ON CONFLICT DO NOTHING;
END
$$;
