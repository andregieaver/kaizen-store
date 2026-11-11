-- Alt texts in the media library (D89). Descriptions written before are staff's.
UPDATE commerce.media SET alt_source = 'staff', alt_written_at = updated_at WHERE alt <> '';
--> statement-breakpoint
-- A picture's alt text is by whoever wrote it, and only while there is one.
ALTER TABLE commerce.media ADD CONSTRAINT media_alt_written CHECK ((alt_source IS NULL) = (alt = '' AND alt_translations = '{}'::jsonb));
--> statement-breakpoint
-- The library's keyword search reads the alt text in every language.
ALTER TABLE commerce.media DROP COLUMN search;
--> statement-breakpoint
ALTER TABLE commerce.media ADD COLUMN search tsvector GENERATED ALWAYS AS (
  setweight(to_tsvector('simple', regexp_replace(file_name, '[._-]+', ' ', 'g')), 'A')
  || setweight(to_tsvector('simple', alt), 'B')
  || setweight(jsonb_to_tsvector('simple'::regconfig, alt_translations, '["string"]'), 'C')
) STORED;
--> statement-breakpoint
CREATE INDEX media_search_idx ON commerce.media USING gin (search);
--> statement-breakpoint
-- A picture's alt text on the site, in a language, by either of its
-- addresses (the file or its small copy): the library's text in that
-- language, else in the owner's main language, else null. Pages, products
-- and variants that give a picture no alt text of their own show this one.
-- By address alone: a store copied from the template shows the template's
-- pictures, and their words, until it changes them.
CREATE FUNCTION commerce.media_alt(p_url text, p_locale text) RETURNS text
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT coalesce(nullif(m.alt_translations ->> p_locale, ''), nullif(m.alt, ''))
    FROM commerce.media m
   WHERE p_url IS NOT NULL AND (m.url = p_url OR m.thumbnail_url = p_url)
   ORDER BY m.url = p_url DESC
   LIMIT 1
$$;
