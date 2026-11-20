-- The page of the sign-ups made before it was kept: a form's own sign-up is kept as a response with its page (D705) under the address it
-- signed up; a page's own sign-up form left its send for 30 days in form_submissions. The newest one for the address is taken.
UPDATE commerce.marketing_subscribers s SET source_path = r.path
FROM (
  SELECT DISTINCT ON (r.form_id, r.contact_email) r.form_id::text AS form_id, r.contact_email, r.path
  FROM commerce.form_responses r
  WHERE r.contact_email IS NOT NULL AND char_length(r.path) BETWEEN 1 AND 500
  ORDER BY r.form_id, r.contact_email, r.created_at DESC
) r
WHERE s.source = 'form' AND s.source_path IS NULL AND s.source_ref = r.form_id AND lower(s.email) = r.contact_email;
--> statement-breakpoint

UPDATE commerce.marketing_subscribers s SET source_path = f.path
FROM (
  SELECT DISTINCT ON (f.block_id, lower(f.email)) f.block_id, lower(f.email) AS email, f.path
  FROM commerce.form_submissions f
  WHERE f.kind = 'subscription' AND f.email IS NOT NULL AND char_length(f.path) BETWEEN 1 AND 500
  ORDER BY f.block_id, lower(f.email), f.created_at DESC
) f
WHERE s.source = 'form' AND s.source_path IS NULL AND s.source_ref = f.block_id AND lower(s.email) = f.email;
