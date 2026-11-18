-- Paid extensions, step E3 (D748, docs/extensions.md 4): what an account's standing is read from, in one place. The store read carries the
-- facts (cached, read against the clock by extensionOn() in src/lib/extensions.ts); jobs ask commerce.extension_on(), which repeats that
-- rule in SQL (src/db/extension-gates.test.ts holds the two together).

-- An account's facts: Kaizena Flow's own or not, when extensions started being sold, what the plans of its stores include, and its own rows.
CREATE OR REPLACE FUNCTION commerce.organisation_extension_facts(p_organisation uuid) RETURNS jsonb
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  SELECT jsonb_build_object(
    'platform', coalesce((SELECT o.platform FROM commerce.organisations o WHERE o.id = p_organisation), false),
    'launchedAt', (SELECT ps.extensions_launched_at FROM commerce.platform_settings ps),
    'included', coalesce((
      SELECT jsonb_agg(DISTINCT g.extension_id)
        FROM commerce.stores s
        JOIN commerce.store_billing b ON b.store_id = s.id
        JOIN commerce.plan_extension_grants g ON g.plan_id = b.plan_id
       WHERE s.organisation_id = p_organisation AND b.status IN ('trialing', 'active', 'past_due')
    ), '[]'::jsonb),
    'rows', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'extensionId', e.extension_id, 'source', e.source,
               'trialEndsAt', e.trial_ends_at, 'endedAt', e.ended_at, 'graceEndsAt', e.grace_ends_at))
        FROM commerce.organisation_extensions e
       WHERE e.organisation_id = p_organisation
    ), '[]'::jsonb)
  );
$$;
--> statement-breakpoint

-- A store's facts: its account's, or (a store nobody owns yet) none of its own.
CREATE OR REPLACE FUNCTION commerce.store_extension_facts(p_store uuid) RETURNS jsonb
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  SELECT CASE
    WHEN s.organisation_id IS NOT NULL THEN commerce.organisation_extension_facts(s.organisation_id)
    ELSE jsonb_build_object('platform', false, 'launchedAt', (SELECT ps.extensions_launched_at FROM commerce.platform_settings ps),
                            'included', '[]'::jsonb, 'rows', '[]'::jsonb)
  END
  FROM commerce.stores s WHERE s.id = p_store;
$$;
--> statement-breakpoint

-- The extension works for the store's account now (active, on trial, in its grace period, or Kaizena Flow's own): extensionOn() in SQL, for
-- jobs that skip accounts without it. Read-only after the grace period does not work: nothing that faces customers runs.
CREATE OR REPLACE FUNCTION commerce.extension_on(p_store uuid, p_extension text) RETURNS boolean
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  WITH f AS (SELECT commerce.store_extension_facts(p_store) AS j),
       r AS (
         SELECT x->>'source' AS source, (x->>'trialEndsAt')::timestamptz AS trial_ends_at,
                (x->>'endedAt')::timestamptz AS ended_at, (x->>'graceEndsAt')::timestamptz AS grace_ends_at
           FROM f, jsonb_array_elements(f.j->'rows') x
          WHERE x->>'extensionId' = p_extension
       )
  SELECT coalesce((f.j->>'platform')::boolean, false)
      OR (f.j->>'launchedAt') IS NULL OR (f.j->>'launchedAt')::timestamptz > now()
      OR (f.j->'included') ? p_extension
      OR EXISTS (
           SELECT 1 FROM r
            WHERE (r.source = 'trial' AND (now() < r.trial_ends_at OR now() < r.grace_ends_at))
               OR (r.source <> 'trial' AND (r.ended_at IS NULL OR now() < r.ended_at OR now() < r.grace_ends_at))
         )
    FROM f;
$$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION commerce.organisation_extension_facts(p_organisation uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION commerce.store_extension_facts(p_store uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION commerce.extension_on(p_store uuid, p_extension text) FROM PUBLIC;
