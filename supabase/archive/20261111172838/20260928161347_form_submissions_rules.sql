-- Forms (D93). Like every commerce table: row-level security on, no policies.
ALTER TABLE commerce.form_submissions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- A copied page's forms (a new store's, from the template) never keep the
-- template's recipients: the new store's forms send nowhere, and so do not
-- show, until its owner says where. Addresses hold no "]".
CREATE OR REPLACE FUNCTION commerce.clone_page_content(p_store uuid, p_template uuid, p_content jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  v_text text := p_content::text;
  v_id uuid;
BEGIN
  IF p_content IS NULL THEN
    RETURN NULL;
  END IF;
  FOR v_id IN
    SELECT id FROM commerce.terms WHERE store_id = p_template
    UNION ALL
    SELECT id FROM commerce.menus WHERE store_id = p_template
  LOOP
    v_text := replace(v_text, '"' || v_id::text || '"', '"' || commerce.clone_id(p_store, v_id)::text || '"');
  END LOOP;
  v_text := replace(v_text, '"' || p_template::text || '"', '"' || p_store::text || '"');
  v_text := regexp_replace(v_text, '"recipients": \[[^]]*\]', '"recipients": []', 'g');
  RETURN v_text::jsonb;
END;
$$;
