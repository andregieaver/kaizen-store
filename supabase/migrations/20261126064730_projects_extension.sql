-- Projects as a paid extension (D904, docs/projects.md P8.1; the owner's answers of 26 November 2026): projects and checklists, their
-- statuses, labels, comments and routines. One size of five people at €25 a month and €19 founding (NOK ×10, a year ten months, as every
-- extension), €4 a person beyond (NOK 40), a member of the Everything bundle ("Every extension"), and included in Grow, Advanced and Plus.
-- It stands alone: an account with only Projects uses it in its workspace, so a workspace starts with the store feature `projects` on, as
-- it does `sales` for Deals. Every number here is the platform admin's to change at Platform -> Plans -> Extensions.
DO $$
DECLARE
  v_size uuid;
  v_currency text;
  v_rate int;
BEGIN
  INSERT INTO commerce.extensions (id, name, description, standalone, store_only, position)
  VALUES ('projects', 'Projects', 'Projects and checklists for the team: statuses, a board, who does what and when it is due, routines that repeat.', true, false,
    coalesce((SELECT max(position) + 1 FROM commerce.extensions), 6))
  ON CONFLICT (id) DO NOTHING;

  IF NOT EXISTS (SELECT 1 FROM commerce.extension_sizes WHERE extension_id = 'projects') THEN
    INSERT INTO commerce.extension_sizes (extension_id, label, allowances, position)
    VALUES ('projects', '5 people', '{"people": 5}'::jsonb, 0)
    RETURNING id INTO v_size;
    FOREACH v_currency IN ARRAY ARRAY['EUR', 'NOK'] LOOP
      v_rate := CASE v_currency WHEN 'NOK' THEN 10 ELSE 1 END;
      INSERT INTO commerce.extension_prices (size_id, currency, interval, amount_minor, founding_minor) VALUES
        (v_size, v_currency, 'month', 2500 * v_rate, 1900 * v_rate),
        (v_size, v_currency, 'year', 2500 * v_rate * 10, 1900 * v_rate * 10);
    END LOOP;
  END IF;

  INSERT INTO commerce.extension_extra_prices (extension_id, unit, currency, amount_minor)
  VALUES ('projects', 'person', 'EUR', 400), ('projects', 'person', 'NOK', 4000)
  ON CONFLICT DO NOTHING;

  INSERT INTO commerce.extension_bundle_members (bundle_id, extension_id)
  SELECT b.id, 'projects' FROM commerce.extension_bundles b WHERE b.name = 'Everything'
  ON CONFLICT DO NOTHING;

  INSERT INTO commerce.plan_extension_grants (plan_id, extension_id, size_id)
  SELECT p.id, 'projects', s.id
    FROM commerce.plans p
    JOIN commerce.extension_sizes s ON s.extension_id = 'projects' AND s.position = 0
   WHERE p.name IN ('Grow', 'Advanced', 'Plus')
  ON CONFLICT DO NOTHING;
END
$$;
--> statement-breakpoint
-- An account that already uses Projects (a checklist, or the feature on, in an open store that is not a template, demo, sandbox or
-- Kaizena Flow's own) and whose plan does not include it gets the trial the launch gave every extension in use (D748 E5: 60 days at its
-- smallest size, grace 14 days after). Before launch every account has every extension, so none is written. Before the workspaces below
-- are given the feature, so a workspace's switch is not counted as use.
INSERT INTO commerce.organisation_extensions (organisation_id, extension_id, source, size_id, trial_ends_at, grace_ends_at)
SELECT DISTINCT s.organisation_id, 'projects', 'trial', z.id, now() + interval '60 days', now() + interval '74 days'
  FROM commerce.stores s
  JOIN commerce.organisations o ON o.id = s.organisation_id AND NOT o.platform
  JOIN commerce.extension_sizes z ON z.extension_id = 'projects' AND z.position = 0
 WHERE (SELECT ps.extensions_launched_at FROM commerce.platform_settings ps) IS NOT NULL
   AND s.status <> 'closed' AND NOT (s.is_template OR s.starter OR s.sandbox OR s.house)
   AND ('projects' = ANY (s.features) OR EXISTS (SELECT 1 FROM commerce.checklists c WHERE c.store_id = s.id))
   AND NOT (commerce.organisation_extension_facts(s.organisation_id) -> 'included') @> '["projects"]'::jsonb
ON CONFLICT DO NOTHING;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION commerce.make_workspace(p_account uuid, p_name text, p_country text, p_currency text, p_locale text) RETURNS uuid
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
DECLARE
  v_organisation uuid := commerce.account_organisation(p_account, p_name);
  v_id uuid;
BEGIN
  SELECT s.id INTO v_id FROM commerce.stores s WHERE s.organisation_id = v_organisation AND s.workspace;
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;
  IF p_country IS NULL OR p_country !~ '^[A-Z]{2}$' OR p_currency IS NULL OR p_currency !~ '^[A-Z]{3}$' OR coalesce(btrim(p_locale), '') = '' THEN
    RAISE EXCEPTION 'workspaces.market: a workspace needs a country, a currency and a language' USING ERRCODE = 'check_violation';
  END IF;
  PERFORM set_config('commerce.workspace_change', 'make', true);
  INSERT INTO commerce.stores (slug, name, workspace, private_mode, country, locales, created_by, features, modules)
  VALUES ('ws-' || substr(md5(gen_random_uuid()::text), 1, 12), coalesce(nullif(btrim(p_name), ''), 'Workspace'), true, true, p_country,
          ARRAY[p_locale], p_account, ARRAY['sales', 'projects'], ARRAY['work'])
  RETURNING id INTO v_id;
  PERFORM set_config('commerce.workspace_change', '', true);
  INSERT INTO commerce.markets (store_id, code, currency, default_locale, locales, active)
  VALUES (v_id, p_country, p_currency, p_locale, ARRAY[p_locale], true);
  INSERT INTO commerce.store_members (store_id, account_id, role) VALUES (v_id, p_account, 'owner');
  RETURN v_id;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION commerce.make_workspace(uuid, text, text, text, text) FROM PUBLIC;
--> statement-breakpoint
UPDATE commerce.stores SET features = array_append(features, 'projects') WHERE workspace AND NOT ('projects' = ANY (features));
