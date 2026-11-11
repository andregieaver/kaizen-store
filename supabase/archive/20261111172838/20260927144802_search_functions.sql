-- Keyword search (Phase 2, S1). Trigram matching for typos, in the
-- extensions schema as Supabase advises; and the text-search document of a
-- product's title and description in its own language, stemmed with that
-- language's dictionary (norwegian, swedish, danish, …, simple otherwise).
CREATE SCHEMA IF NOT EXISTS extensions;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;
--> statement-breakpoint

-- The text-search configuration for a locale (`nb-NO` → norwegian).
CREATE OR REPLACE FUNCTION commerce.search_config(p_locale text)
RETURNS regconfig
LANGUAGE sql
IMMUTABLE PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT (CASE split_part(lower(coalesce(p_locale, '')), '-', 1)
    WHEN 'nb' THEN 'pg_catalog.norwegian'
    WHEN 'nn' THEN 'pg_catalog.norwegian'
    WHEN 'no' THEN 'pg_catalog.norwegian'
    WHEN 'sv' THEN 'pg_catalog.swedish'
    WHEN 'da' THEN 'pg_catalog.danish'
    WHEN 'en' THEN 'pg_catalog.english'
    WHEN 'de' THEN 'pg_catalog.german'
    WHEN 'fi' THEN 'pg_catalog.finnish'
    WHEN 'nl' THEN 'pg_catalog.dutch'
    WHEN 'fr' THEN 'pg_catalog.french'
    WHEN 'es' THEN 'pg_catalog.spanish'
    WHEN 'it' THEN 'pg_catalog.italian'
    WHEN 'pt' THEN 'pg_catalog.portuguese'
    ELSE 'pg_catalog.simple'
  END)::regconfig
$$;
--> statement-breakpoint

-- A product translation's search document: the title weighs most (A), the
-- description least (C).
CREATE OR REPLACE FUNCTION commerce.product_search_doc(p_locale text, p_title text, p_description text)
RETURNS tsvector
LANGUAGE sql
IMMUTABLE PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT setweight(pg_catalog.to_tsvector(commerce.search_config(p_locale), coalesce(p_title, '')), 'A')
      || setweight(pg_catalog.to_tsvector(commerce.search_config(p_locale), coalesce(p_description, '')), 'C')
$$;
