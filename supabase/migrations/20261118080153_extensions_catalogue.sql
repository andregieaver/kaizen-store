-- Paid extensions, step E2 (D748, docs/extensions.md 8.3 and 12): the catalogue as the owner chose it on 17 November 2026, at list
-- prices, excluding VAT (NOK is ten times the euro price, a year ten months, as for plans). Founding prices come with step E6, the price
-- for use beyond a size with step E11. Every number here is the platform admin's to change at Platform -> Plans -> Extensions.

-- RLS on, as on every commerce table: the Data API does not expose the schema, and server code reaches it through its own connection.
ALTER TABLE commerce.extensions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.extension_sizes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.extension_prices ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.extension_bundles ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.extension_bundle_members ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.extension_bundle_prices ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.plan_extension_grants ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.organisation_extensions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

DO $$
DECLARE
  v_size uuid;
  v_bundle uuid;
  v_currency text;
  v_rate int;
  r record;
BEGIN
  INSERT INTO commerce.extensions (id, name, description, standalone, store_only, position) VALUES
    ('ab_testing', 'A/B testing', 'Try two versions of a page on your visitors and keep the one that sells more.', false, true, 0),
    ('support_desk', 'AI support desk', 'Every customer email and chat in one inbox, answered by AI where it can and by you where it should.', true, false, 1),
    ('email_automation', 'Email automation', 'Newsletters, segments and flows that send themselves, from your own domain.', true, false, 2),
    ('work', 'Work', 'Clients, time, invoices and your books: the ledger, the VAT return, SAF-T and the year-end.', true, false, 3),
    ('deals', 'Deals and contracts', 'Leads, deals on a board, activities, and contracts signed online.', true, false, 4);

  -- Each size, and its price per currency and interval: (extension, label, allowances, position, euro cents a month).
  FOR r IN
    SELECT * FROM (VALUES
      ('ab_testing', 'Unlimited tests', '{}'::jsonb, 0, 2900),
      ('support_desk', '100 AI-handled conversations a month', '{"ai_conversations": 100}'::jsonb, 0, 3900),
      ('email_automation', 'Up to 2,500 contacts', '{"contacts": 2500, "emails_per_contact": 10}'::jsonb, 0, 2500),
      ('email_automation', 'Up to 10,000 contacts', '{"contacts": 10000, "emails_per_contact": 10}'::jsonb, 1, 5900),
      ('email_automation', 'Up to 25,000 contacts', '{"contacts": 25000, "emails_per_contact": 10}'::jsonb, 2, 11900),
      ('email_automation', 'Up to 50,000 contacts', '{"contacts": 50000, "emails_per_contact": 10}'::jsonb, 3, 19900),
      ('work', '3 people', '{"people": 3}'::jsonb, 0, 3500),
      ('deals', '3 people', '{"people": 3}'::jsonb, 0, 3500)
    ) AS t(extension_id, label, allowances, position, eur_month)
  LOOP
    INSERT INTO commerce.extension_sizes (extension_id, label, allowances, position)
    VALUES (r.extension_id, r.label, r.allowances, r.position)
    RETURNING id INTO v_size;
    FOREACH v_currency IN ARRAY ARRAY['EUR', 'NOK'] LOOP
      v_rate := CASE v_currency WHEN 'NOK' THEN 10 ELSE 1 END;
      INSERT INTO commerce.extension_prices (size_id, currency, interval, amount_minor) VALUES
        (v_size, v_currency, 'month', r.eur_month * v_rate),
        (v_size, v_currency, 'year', r.eur_month * v_rate * 10);
    END LOOP;
  END LOOP;

  -- The bundles: (name, line, members, position, euro cents a month).
  FOR r IN
    SELECT * FROM (VALUES
      ('Customers', 'The support desk, email automation and deals together.', ARRAY['support_desk', 'email_automation', 'deals'], 0, 8500),
      ('Everything', 'Every extension.', ARRAY['ab_testing', 'support_desk', 'email_automation', 'work', 'deals'], 1, 11900)
    ) AS t(name, description, members, position, eur_month)
  LOOP
    INSERT INTO commerce.extension_bundles (name, description, position)
    VALUES (r.name, r.description, r.position)
    RETURNING id INTO v_bundle;
    INSERT INTO commerce.extension_bundle_members (bundle_id, extension_id) SELECT v_bundle, unnest(r.members);
    FOREACH v_currency IN ARRAY ARRAY['EUR', 'NOK'] LOOP
      v_rate := CASE v_currency WHEN 'NOK' THEN 10 ELSE 1 END;
      INSERT INTO commerce.extension_bundle_prices (bundle_id, currency, interval, amount_minor) VALUES
        (v_bundle, v_currency, 'month', r.eur_month * v_rate),
        (v_bundle, v_currency, 'year', r.eur_month * v_rate * 10);
    END LOOP;
  END LOOP;

  -- What today's plans include, where a plan of that name is offered: (plan, extension, the size's position).
  INSERT INTO commerce.plan_extension_grants (plan_id, extension_id, size_id)
  SELECT p.id, g.extension_id, s.id
    FROM (VALUES
      ('Grow', 'ab_testing', 0),
      ('Advanced', 'ab_testing', 0),
      ('Advanced', 'email_automation', 1),
      ('Advanced', 'support_desk', 0),
      ('Plus', 'ab_testing', 0),
      ('Plus', 'support_desk', 0),
      ('Plus', 'email_automation', 2),
      ('Plus', 'work', 0),
      ('Plus', 'deals', 0)
    ) AS g(plan_name, extension_id, size_position)
    JOIN commerce.plans p ON p.name = g.plan_name AND p.active
    JOIN commerce.extension_sizes s ON s.extension_id = g.extension_id AND s.position = g.size_position
  ON CONFLICT DO NOTHING;
END
$$;
