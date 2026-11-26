-- Recordings of store owners' own use of the admin (D895 phase 3b, docs/dpia-admin-use.md): their own private bucket (gzip only, 1 MB a
-- segment; fold it into baseline_4's bucket list at the next quarterly squash) and the retention rule. Inserts only, each written so
-- that running it again adds nothing.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'storage') THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES ('admin-recordings', 'admin-recordings', false, 1048576, ARRAY['application/gzip']::text[])
    ON CONFLICT (id) DO NOTHING;
  END IF;
END
$$;
--> statement-breakpoint
INSERT INTO commerce.retention_rules (kind, country, period_value, period_unit, counts_from, source, source_url, basis, checked_on, valid_from, enforced_by, note)
SELECT 'admin_recordings', NULL, 30, 'days', 'event',
   'Kaizen''s own choice under GDPR Art. 5(1)(e) (kept no longer than necessary), not a statute: a proportionality decision for review.',
   NULL, 'policy', '2026-11-26', '2000-01-01', 'pruneAdminRecordings() (RECORDING_KEEP_DAYS)',
   'Recordings of store owners'' own use of the admin (D895 phase 3b) and their files, counted from the recording''s start; joined to no person, so they cannot be found for one. RECORDING_KEEP_DAYS, a test holds them equal.'
 WHERE NOT EXISTS (SELECT 1 FROM commerce.retention_rules r WHERE r.kind = 'admin_recordings' AND r.country IS NULL);
