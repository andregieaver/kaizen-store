-- A product translation's excerpt (a short text for content grids) travels with the product when a store is cloned or duplicated:
-- every function that copies product translations lists the new column, as it lists the others.
DO $$
DECLARE
  f record;
  def text;
  patched text;
BEGIN
  FOR f IN
    SELECT p.oid, p.proname
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'commerce' AND p.prosrc ~* 'insert\s+into\s+commerce\.product_translations\s*\([^)]*seo_description'
  LOOP
    def := pg_get_functiondef(f.oid);
    patched := regexp_replace(def, '(insert\s+into\s+commerce\.product_translations\s*\([^)]*seo_description)(\s*\))', '\1, excerpt\2', 'gi');
    patched := regexp_replace(patched, '(t\.seo_description)(\s+from\s+commerce\.product_translations\s+t)', '\1, t.excerpt\2', 'gi');
    IF patched = def THEN
      RAISE EXCEPTION 'function % copies product translations but was not patched', f.proname;
    END IF;
    EXECUTE patched;
  END LOOP;
END
$$;
