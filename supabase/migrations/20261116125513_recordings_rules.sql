-- Recordings of visits (D656, docs/heatmaps-and-recordings.md 6.4, 10 and step 8): the private bucket (gzip only, 5 MB so a sealed
-- recording fits; fold it into baseline_4's bucket list at the next quarterly squash), row-level security, the retention rule, each
-- plan's monthly limit (the proposal of section 10, changed by the platform's admin under Usage and limits) and the plan comparison's row,
-- in no plan. Inserts only, each written so that running it again adds nothing.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'storage') THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES ('recordings', 'recordings', false, 5242880, ARRAY['application/gzip']::text[])
    ON CONFLICT (id) DO NOTHING;
  END IF;
END
$$;
--> statement-breakpoint
-- Row-level security, no policy: the commerce schema is private to the server.
ALTER TABLE "commerce"."recordings" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
INSERT INTO commerce.retention_rules (kind, country, period_value, period_unit, counts_from, source, source_url, basis, checked_on, valid_from, enforced_by, note)
SELECT 'recordings', NULL, 30, 'days', 'event',
   'Kaizen''s own choice under GDPR Art. 5(1)(e) (kept no longer than necessary), not a statute: a proportionality decision for review.',
   NULL, 'policy', '2026-11-16', '2000-01-01', 'pruneRecordings() (RECORDING_KEEP_DAYS)',
   'Recordings of visits and their files, counted from the recording''s start; the visitor''s browser can erase its own at once. RECORDING_KEEP_DAYS, a test holds them equal.'
 WHERE NOT EXISTS (SELECT 1 FROM commerce.retention_rules r WHERE r.kind = 'recordings' AND r.country IS NULL);
--> statement-breakpoint
INSERT INTO commerce.plan_limits (plan_id, key, value)
SELECT p.id, l.key, l.value
  FROM (VALUES
    ('Basic', 'recordings_month', 1000::bigint),
    ('Grow', 'recordings_month', 5000),
    ('Advanced', 'recordings_month', 20000),
    ('Plus', 'recordings_month', 50000)
  ) AS l(plan, key, value)
  JOIN commerce.plans p ON p.name = l.plan
ON CONFLICT (plan_id, key) DO NOTHING;
--> statement-breakpoint
INSERT INTO commerce.plan_features (category, name, description, position)
SELECT v.category, v.name, v.description, v.position
  FROM (VALUES
    ('Operations', 'Recordings and heatmaps', 'Heatmaps of where visitors click, how far they scroll and what they look at, page by page and per A/B version; recordings of visits, with private parts hidden, kept 30 days, for visitors who allow them.', 490)
  ) AS v(category, name, description, position)
 WHERE NOT EXISTS (SELECT 1 FROM commerce.plan_features f WHERE f.name = v.name);
