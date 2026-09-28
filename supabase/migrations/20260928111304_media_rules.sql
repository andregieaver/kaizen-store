-- The media library (D88). Like every commerce table: row-level security on, no policies.
ALTER TABLE commerce.media ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Keyword search: the file's name in words (its dots, dashes and underscores
-- as spaces) and its description, in no one language; and the name by
-- trigram, for parts of words. Not in the Drizzle schema (generated).
ALTER TABLE commerce.media ADD COLUMN search tsvector GENERATED ALWAYS AS (
  setweight(to_tsvector('simple', regexp_replace(file_name, '[._-]+', ' ', 'g')), 'A')
  || setweight(to_tsvector('simple', alt), 'B')
) STORED;
--> statement-breakpoint
CREATE INDEX media_search_idx ON commerce.media USING gin (search);
--> statement-breakpoint
CREATE INDEX media_file_name_trgm_idx ON commerce.media USING gin (lower(file_name) extensions.gin_trgm_ops);
--> statement-breakpoint
-- A media item's vector for search by meaning, made by the site's AI (D73)
-- from its name, description and the names of what uses it; `space` names
-- the model (never compared across models), `content_hash` what was
-- embedded. SQL only, as product_embeddings.
CREATE TABLE commerce.media_embeddings (
  media_id uuid PRIMARY KEY REFERENCES commerce.media (id) ON DELETE CASCADE,
  store_id uuid REFERENCES commerce.stores (id) ON DELETE CASCADE,
  space text NOT NULL CHECK (length(space) BETWEEN 1 AND 400),
  content_hash text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{32}$'),
  embedding extensions.vector NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX media_embeddings_store_idx ON commerce.media_embeddings (store_id, space);
--> statement-breakpoint
ALTER TABLE commerce.media_embeddings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- The pictures and videos uploaded before the library, from Storage: each
-- site's folder (a store's id, or `platform` for Kaizen) of the public
-- buckets, their small copies (`-480`) with them. Their addresses start as
-- the ones already in use do; widths and heights are measured when the
-- library first shows them. Where there is no Storage (local and test
-- databases) nothing is found.
DO $$
DECLARE
  v_base text;
BEGIN
  IF to_regclass('storage.objects') IS NULL THEN
    RETURN;
  END IF;
  SELECT substring(u from '^(https?://[^/]+/storage/v1/object/public/)') INTO v_base
    FROM (
      SELECT url AS u FROM commerce.product_media
      UNION ALL SELECT image_url FROM commerce.product_variants WHERE image_url IS NOT NULL
      UNION ALL SELECT navigation::text FROM commerce.stores
      UNION ALL SELECT navigation::text FROM commerce.platform_settings
      UNION ALL SELECT published::text FROM commerce.pages WHERE published IS NOT NULL
    ) sources
   WHERE u ~ 'https?://[^/]+/storage/v1/object/public/'
   LIMIT 1;
  IF v_base IS NULL THEN
    RETURN;
  END IF;
  EXECUTE $sql$
    INSERT INTO commerce.media (
      store_id, kind, url, thumbnail_url, bucket, path, thumbnail_path, file_name, content_type, size_bytes, created_at
    )
    SELECT s.id,
           CASE WHEN o.bucket_id = 'page-videos' THEN 'video' ELSE 'image' END,
           $1 || o.bucket_id || '/' || o.name,
           CASE WHEN t.name IS NOT NULL THEN $1 || o.bucket_id || '/' || t.name END,
           o.bucket_id, o.name, t.name,
           regexp_replace(o.name, '^.*/', ''),
           coalesce(o.metadata ->> 'mimetype', 'application/octet-stream'),
           coalesce((o.metadata ->> 'size')::bigint, 0),
           o.created_at
      FROM storage.objects o
      LEFT JOIN commerce.stores s ON s.id::text = split_part(o.name, '/', 1)
      LEFT JOIN storage.objects t
        ON t.bucket_id = o.bucket_id AND t.name = regexp_replace(o.name, '\.([A-Za-z0-9]+)$', '-480.\1')
     WHERE o.bucket_id IN ('product-media', 'page-videos')
       AND o.name !~ '-480\.[A-Za-z0-9]+$'
       AND (split_part(o.name, '/', 1) = 'platform' OR s.id IS NOT NULL)
    ON CONFLICT (url) DO NOTHING
  $sql$ USING v_base;
END;
$$;
